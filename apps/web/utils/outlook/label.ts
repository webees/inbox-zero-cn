import type { OutlookClient } from "@/utils/outlook/client";
import type { Logger } from "@/utils/logger";
import { publishArchive, type TinybirdEmailAction } from "@inboxzero/tinybird";
import { WELL_KNOWN_FOLDERS } from "./constants";
import {
  extractErrorInfo,
  isRetryableError,
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";
import { sleep } from "@/utils/sleep";
import {
  listThreadMessages,
  OutlookThreadPaginationError,
  processThreadMessagesFallback,
  runThreadMessageMutation,
} from "@/utils/outlook/thread-helpers";
import {
  getDefaultLabelColorName,
  inboxZeroLabels,
  type InboxZeroLabel,
} from "@/utils/label";
import {
  normalizeOutlookCategoryName,
  sanitizeOutlookCategoryName,
} from "@/utils/outlook/label-validation";
import { findLabelByName } from "@/utils/label/find-label-by-name";
import { getFolderIds } from "@/utils/outlook/message";
import type { OutlookCategory } from "@microsoft/microsoft-graph-types";
import {
  getDefaultOutlookCategoryColor,
  OUTLOOK_CATEGORY_COLOR_IDS,
  OUTLOOK_CATEGORY_COLOR_MAP,
} from "@/utils/outlook/category-colors";

// Outlook supported colors
export const OUTLOOK_COLORS: Array<string> = OUTLOOK_CATEGORY_COLOR_IDS.slice(
  0,
  10,
);
export const OUTLOOK_COLOR_MAP = OUTLOOK_CATEGORY_COLOR_MAP;

const MAX_CATEGORY_CONFLICT_ATTEMPTS = 3;
const CATEGORY_CONFLICT_RETRY_DELAY_MS = 250;

export async function getLabels(client: OutlookClient) {
  const response: { value: OutlookCategory[] } = await client
    .getClient()
    .api("/me/outlook/masterCategories")
    .get();
  return response.value.map((label) => ({
    ...label,
    name: label.displayName || label.id,
  }));
}

export async function getLabelById(options: {
  client: OutlookClient;
  id: string;
}) {
  const { client, id } = options;
  const response: OutlookCategory = await client
    .getClient()
    .api(`/me/outlook/masterCategories/${id}`)
    .get();
  return response;
}

export async function createLabel({
  client,
  name,
  color,
  logger,
}: {
  client: OutlookClient;
  name: string;
  color?: string;
  logger: Logger;
}) {
  const sanitizedName = sanitizeOutlookCategoryName(name);
  if (!sanitizedName) throw new Error("标签名称不能为空");

  try {
    const outlookColor =
      color && OUTLOOK_COLORS.includes(color)
        ? color
        : getDefaultOutlookColor(sanitizedName);

    const response: OutlookCategory = await withMicrosoftGraphWriteRetry(
      () =>
        client.getClient().api("/me/outlook/masterCategories").post({
          displayName: sanitizedName,
          color: outlookColor,
        }),
      logger,
    );

    client.invalidateCategoryMapCache();

    return response;
  } catch (error) {
    let { errorMessage } = extractErrorInfo(error);
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : "未知错误";
    }
    if (
      errorMessage.includes("already exists") ||
      errorMessage.includes("conflict with the current state")
    ) {
      logger.warn("标签已存在", { name: sanitizedName });
      const label = await getLabel({ client, name: sanitizedName });
      if (label) return label;
      throw new Error("标签冲突但未找到");
    }
    throw new Error(`创建 Outlook 类别失败：${errorMessage}`);
  }
}

export async function getLabel(options: {
  client: OutlookClient;
  name: string;
}) {
  const { client, name } = options;
  const labels = await getLabels(client);
  const normalizedSearch = normalizeOutlookCategoryName(name);
  if (!normalizedSearch) return null;

  return findLabelByName({
    labels,
    name,
    getLabelName: (label) => label.displayName,
    normalize: normalizeOutlookCategoryName,
  });
}

export async function getOrCreateLabel({
  client,
  name,
  logger,
}: {
  client: OutlookClient;
  name: string;
  logger: Logger;
}) {
  const sanitizedName = sanitizeOutlookCategoryName(name);
  if (!sanitizedName) throw new Error("标签名称不能为空");

  const label = await getLabel({ client, name: sanitizedName });
  if (label) return label;
  const createdLabel = await createLabel({
    client,
    name: sanitizedName,
    logger,
  });
  return createdLabel;
}

export async function getOrCreateLabels({
  client,
  names,
  logger,
}: {
  client: OutlookClient;
  names: string[];
  logger: Logger;
}): Promise<OutlookCategory[]> {
  if (!names.length) return [];

  const entries = names.map((name) => ({
    rawName: name,
    sanitizedName: sanitizeOutlookCategoryName(name),
    normalizedName: normalizeOutlookCategoryName(name),
  }));

  const emptyNames = entries.filter((entry) => !entry.sanitizedName);
  if (emptyNames.length) throw new Error("标签名称不能为空");

  assertNoNormalizedInputCollisions(entries);

  const existingLabels = await getLabels(client);
  const labelMap = new Map<string, OutlookCategory[]>();
  existingLabels.forEach((label) => {
    if (label.displayName) {
      const normalizedLabelName = normalizeOutlookCategoryName(
        label.displayName,
      );
      const labelsForName = labelMap.get(normalizedLabelName) ?? [];
      labelsForName.push(label);
      labelMap.set(normalizedLabelName, labelsForName);
    }
  });

  const createLabelMap = new Map<string, Promise<OutlookCategory>>();

  const results = await Promise.all(
    entries.map(async ({ rawName, sanitizedName, normalizedName }) => {
      const existingLabelsForName = labelMap.get(normalizedName);
      if (existingLabelsForName?.length === 1) return existingLabelsForName[0];
      if (existingLabelsForName?.length)
        throw new Error(
          `Outlook 类别匹配存在歧义："${rawName}"。请使用唯一的类别名称。`,
        );

      const pendingCreate = createLabelMap.get(normalizedName);
      if (pendingCreate) return pendingCreate;

      const createPromise = createLabel({
        client,
        name: sanitizedName,
        logger,
      });
      createLabelMap.set(normalizedName, createPromise);
      return createPromise;
    }),
  );

  return results;
}

// Label message/thread functions
export async function labelMessage({
  client,
  messageId,
  categories,
  logger,
}: {
  client: OutlookClient;
  messageId: string;
  categories: string[];
  logger: Logger;
}) {
  return withMicrosoftGraphWriteRetry(
    () =>
      client.getClient().api(`/me/messages/${messageId}`).patch({
        categories,
      }),
    logger,
  );
}

/**
 * 对邮件类别进行读取—修改—写入。当另一写入先落到该邮件上时，Graph 会以
 * 412 冲突拒绝 PATCH；被拒绝的写入未生效，因此应重新读取并重新计算，而不是
 * 覆盖。返回类别是否发生变化。
 */
export async function updateMessageCategories({
  client,
  messageId,
  update,
  logger,
}: {
  client: OutlookClient;
  messageId: string;
  update: (categories: string[]) => string[];
  logger: Logger;
}): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    const message: { categories?: string[]; "@odata.etag"?: string } =
      await withMicrosoftGraphRetry(
        () =>
          client
            .getClient()
            .api(`/me/messages/${messageId}`)
            .select("categories")
            .get(),
        logger,
      );
    const currentCategories = message.categories ?? [];
    const categories = update(currentCategories);

    if (
      categories.length === currentCategories.length &&
      categories.every((category) => currentCategories.includes(category))
    ) {
      return false;
    }

    try {
      // If-Match 会把并发变更上的写入变成可重试的 412，
      // 而不是静默丢弃另一写入方的类别。
      const etag = message["@odata.etag"];
      await withMicrosoftGraphWriteRetry(() => {
        const request = client.getClient().api(`/me/messages/${messageId}`);
        if (etag) request.header("If-Match", etag);
        return request.patch({ categories });
      }, logger);
      return true;
    } catch (error) {
      const { isConflictError } = isRetryableError(extractErrorInfo(error));
      if (!isConflictError || attempt >= MAX_CATEGORY_CONFLICT_ATTEMPTS) {
        throw error;
      }
      logger.warn("类别更新发生冲突，使用最新状态重试", {
        attempt,
      });
      await sleep(CATEGORY_CONFLICT_RETRY_DELAY_MS * attempt);
    }
  }
}

export async function labelThread({
  client,
  threadId,
  categories,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  categories: string[];
  logger: Logger;
}) {
  // 在 Outlook 中，需要更新会话中的每封邮件
  const messages = await listThreadMessages({
    client,
    threadId,
    select: "id",
    logger,
  });

  await runThreadMessageMutation({
    messageIds: messages.map((message) => message.id),
    threadId,
    logger,
    messageHandler: (messageId) =>
      labelMessage({ client, messageId, categories, logger }),
    failureMessage: "未能为会话中的邮件添加标签",
  });
}

export async function removeThreadLabel({
  client,
  threadId,
  categoryName,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  categoryName: string;
  logger: Logger;
}) {
  if (!categoryName) {
    logger.warn("类别名称为空，跳过移除", { threadId });
    return;
  }

  const messages = await listThreadMessages<{
    id: string;
    categories?: string[];
  }>({ client, threadId, select: "id,categories", logger });

  await runThreadMessageMutation({
    messageIds: messages
      .filter((message) => message.categories?.includes(categoryName))
      .map((message) => message.id),
    threadId,
    logger,
    messageHandler: (messageId) =>
      updateMessageCategories({
        client,
        messageId,
        update: (categories) =>
          categories.filter((cat) => cat !== categoryName),
        logger,
      }),
    failureMessage: "未能从邮件移除类别",
    continueOnError: true,
  });
}

export async function archiveThread({
  client,
  threadId,
  ownerEmail,
  actionSource,
  folderId = "archive",
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  ownerEmail: string;
  actionSource: TinybirdEmailAction["actionSource"];
  folderId?: string;
  logger: Logger;
}) {
  if (!folderId) {
    logger.warn("未提供 folderId，跳过归档操作", {
      threadId,
      ownerEmail,
      actionSource,
    });
    return;
  }

  // 检查目标文件夹是否存在（仅限自定义文件夹，已知名称可直接信任使用）
  const wellKnownFolders = Object.keys(WELL_KNOWN_FOLDERS);
  if (!wellKnownFolders.includes(folderId.toLowerCase())) {
    try {
      await client.getClient().api(`/me/mailFolders/${folderId}`).get();
    } catch (error) {
      logger.warn("未找到自定义目标文件夹，跳过归档操作", {
        folderId,
        threadId,
        error,
      });
      return;
    }
  }

  // 在 Outlook 中，归档就是移动到文件夹
  // 需要逐封移动会话中的邮件
  let messages: { id: string }[];
  try {
    messages = await listThreadMessages({
      client,
      threadId,
      select: "id",
      logger,
    });
  } catch (error) {
    if (error instanceof OutlookThreadPaginationError) throw error;
    return archiveThreadWithFallback({
      client,
      threadId,
      ownerEmail,
      actionSource,
      folderId,
      logger,
      filterError: error,
    });
  }

  const archivePromise = runThreadMessageMutation({
    messageIds: messages.map((message) => message.id),
    threadId,
    logger,
    messageHandler: (messageId) =>
      withMicrosoftGraphWriteRetry(
        () =>
          client.getClient().api(`/me/messages/${messageId}/move`).post({
            destinationId: folderId,
          }),
        logger,
      ),
    failureMessage: "未能将邮件移动到文件夹",
    continueOnError: true,
  });

  const publishPromise = publishArchive({
    ownerEmail,
    threadId,
    actionSource,
    timestamp: Date.now(),
  });

  const [archiveResult, publishResult] = await Promise.allSettled([
    archivePromise,
    publishPromise,
  ]);

  // Handle publish errors as non-fatal (just log)
  if (publishResult.status === "rejected") {
    logger.error("发布将会话移动到文件夹的操作失败", {
      folderId,
      threadId,
      error: publishResult.reason,
    });
  }

  // Handle archive errors
  if (archiveResult.status === "rejected") {
    const error = archiveResult.reason;
    if (error.message?.includes("Requested entity was not found")) {
      logger.warn("未找到会话", { threadId, userEmail: ownerEmail });
      return { status: 404, message: "未找到会话" };
    }
    logger.error("未能将会话移动到文件夹", {
      folderId,
      threadId,
      error,
    });
    throw error;
  }

  return { status: 200 };
}

const SOURCE_FOLDER_LABELS = {
  archive: "归档",
  deleteditems: "已删除邮件",
} as const;

/**
 * 将会话中的邮件从某个已知文件夹移回收件箱。
 *
 * 限定来源文件夹可以把同一会话中已发送和已删除的邮件留在原处。Outlook 没有
 * 会话级状态可供恢复，因此来源文件夹是判断用户实际所指邮件的唯一依据。
 */
async function moveThreadFromFolderToInbox({
  client,
  threadId,
  sourceFolder,
  fallbackSourceFolderId,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  sourceFolder: keyof typeof SOURCE_FOLDER_LABELS;
  fallbackSourceFolderId?: string;
  logger: Logger;
}) {
  const folderIds = await getFolderIds(client, logger, {
    includeDrafts: false,
  });
  const sourceFolderId =
    folderIds[WELL_KNOWN_FOLDERS[sourceFolder]] ?? fallbackSourceFolderId;

  // 没有来源文件夹，就无法区分同一会话中已发送和已删除的邮件，而把这些邮件
  // 一并移入收件箱比直接失败更糟。
  if (!sourceFolderId) {
    throw new Error(
      `未找到${SOURCE_FOLDER_LABELS[sourceFolder]}文件夹，无法将会话移入收件箱`,
    );
  }

  const messages = await listThreadMessages({
    client,
    threadId,
    select: "id",
    folderId: sourceFolderId,
    logger,
  });

  await runThreadMessageMutation({
    messageIds: messages.map((message) => message.id),
    threadId,
    logger,
    messageHandler: (messageId) =>
      withMicrosoftGraphWriteRetry(
        () =>
          client
            .getClient()
            .api(`/me/messages/${messageId}/move`)
            .post({ destinationId: WELL_KNOWN_FOLDERS.inbox }),
        logger,
      ),
    failureMessage: "未能将邮件移回收件箱",
  });
}

export async function unarchiveThread({
  client,
  threadId,
  archiveFolderId,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  archiveFolderId?: string;
  logger: Logger;
}) {
  await moveThreadFromFolderToInbox({
    client,
    threadId,
    sourceFolder: "archive",
    fallbackSourceFolderId: archiveFolderId,
    logger,
  });
}

/**
 * 将已移入垃圾箱的会话移回收件箱。
 *
 * 与 Gmail 的恢复不同，Outlook 不记录会话原先所在位置，因此无法恢复到原处。
 * 从自定义文件夹中删除的邮件会回到收件箱。
 */
export async function untrashThread({
  client,
  threadId,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  logger: Logger;
}) {
  await moveThreadFromFolderToInbox({
    client,
    threadId,
    sourceFolder: "deleteditems",
    logger,
  });
}

export async function markReadThread({
  client,
  threadId,
  read,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  read: boolean;
  logger: Logger;
}) {
  try {
    // 在 Outlook 中，需要将会话中的每封邮件标记为已读
    const messages = await listThreadMessages({
      client,
      threadId,
      select: "id",
      logger,
    });

    await runThreadMessageMutation({
      messageIds: messages.map((message) => message.id),
      threadId,
      logger,
      messageHandler: (messageId) =>
        // 幂等的绝对值写入：发生冲突和网络错误时可安全重试。
        withMicrosoftGraphRetry(
          () =>
            client.getClient().api(`/me/messages/${messageId}`).patch({
              isRead: read,
            }),
          logger,
        ),
      failureMessage: "未能将邮件标记为已读",
    });
  } catch (error) {
    if (error instanceof OutlookThreadPaginationError) throw error;
    // 如果筛选失败，尝试其他方式
    logger.warn("筛选失败，尝试其他方式", {
      threadId,
      error,
    });

    try {
      await processThreadMessagesFallback({
        client,
        threadId,
        logger,
        messageHandler: (messageId) =>
          withMicrosoftGraphRetry(
            () =>
              client
                .getClient()
                .api(`/me/messages/${messageId}`)
                .patch({ isRead: read }),
            logger,
          ),
        noMessagesMessage: "未找到该会话的消息，跳过标记已读",
      });
    } catch (directError) {
      logger.error("未能将邮件标记为已读", {
        threadId,
        error: directError,
      });
      throw directError;
    }
  }
}

export async function markImportantMessage({
  client,
  messageId,
  important,
  logger,
}: {
  client: OutlookClient;
  messageId: string;
  important: boolean;
  logger: Logger;
}) {
  // 在 Outlook 中，使用“重要”标记
  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${messageId}`)
        .patch({
          importance: important ? "high" : "normal",
        }),
    logger,
  );
}

export async function markStarredMessage({
  starred = true,
  client,
  messageId,
  logger,
}: {
  client: OutlookClient;
  messageId: string;
  logger: Logger;
  starred?: boolean;
}) {
  // 将标记设为绝对值是幂等的，因此可以安全使用完整重试策略，包括另一写入
  // （如标签操作）先落到该邮件时 Graph 返回的 412。
  await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${messageId}`)
        .patch({ flag: { flagStatus: starred ? "flagged" : "notFlagged" } }),
    logger,
  );
}

export async function getOrCreateInboxZeroLabel({
  client,
  key,
  logger,
}: {
  client: OutlookClient;
  key: InboxZeroLabel;
  logger: Logger;
}) {
  const { name } = inboxZeroLabels[key];
  const labels = await getLabels(client);

  // 如果标签存在则返回
  const label = labels?.find((label) => label.displayName === name);
  if (label) return label;

  // 如果标签不存在则创建
  const createdLabel = await createLabel({ client, name, logger });
  return createdLabel;
}

function assertNoNormalizedInputCollisions(
  entries: {
    rawName: string;
    normalizedName: string;
  }[],
) {
  const normalizedMap = new Map<string, string>();

  entries.forEach(({ rawName, normalizedName }) => {
    const existingRawName = normalizedMap.get(normalizedName);
    if (existingRawName && existingRawName !== rawName) {
      throw new Error(
        `Outlook 类别名称“${existingRawName}”和“${rawName}”规范化后相同。请保持类别名称唯一。`,
      );
    }

    if (!existingRawName) normalizedMap.set(normalizedName, rawName);
  });
}

async function archiveThreadWithFallback({
  client,
  threadId,
  ownerEmail,
  actionSource,
  folderId,
  logger,
  filterError,
}: {
  client: OutlookClient;
  threadId: string;
  ownerEmail: string;
  actionSource: TinybirdEmailAction["actionSource"];
  folderId: string;
  logger: Logger;
  filterError: unknown;
}) {
  logger.warn("筛选失败，尝试其他方式", {
    threadId,
    error: filterError,
  });

  try {
    await processThreadMessagesFallback({
      client,
      threadId,
      logger,
      messageHandler: (messageId) =>
        withMicrosoftGraphWriteRetry(
          () =>
            client
              .getClient()
              .api(`/me/messages/${messageId}/move`)
              .post({ destinationId: folderId }),
          logger,
        ),
      noMessagesMessage: "未找到该会话的消息，跳过文件夹移动",
    });

    try {
      await publishArchive({
        ownerEmail,
        threadId,
        actionSource,
        timestamp: Date.now(),
      });
    } catch (publishError) {
      logger.error("Failed to publish action to move thread to folder", {
        folderId,
        email: ownerEmail,
        threadId,
        error: publishError,
      });
    }

    return { status: 200 };
  } catch (directError) {
    logger.error("Failed to move thread to folder", {
      folderId,
      threadId,
      error: directError,
    });
    throw directError;
  }
}

function getDefaultOutlookColor(name: string) {
  const colorName = getDefaultLabelColorName(name);
  if (colorName) return getDefaultOutlookCategoryColor(colorName);
  return OUTLOOK_COLORS[Math.floor(Math.random() * OUTLOOK_COLORS.length)];
}
