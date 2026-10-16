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
  processThreadMessagesFallback,
  runThreadMessageMutation,
} from "@/utils/outlook/thread-helpers";
import { inboxZeroLabels, type InboxZeroLabel } from "@/utils/label";
import {
  normalizeOutlookCategoryName,
  sanitizeOutlookCategoryName,
} from "@/utils/outlook/label-validation";
import { findLabelByName } from "@/utils/label/find-label-by-name";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import { getFolderIds } from "@/utils/outlook/message";
import { isDefined } from "@/utils/types";
import type {
  OutlookCategory,
  Message,
} from "@microsoft/microsoft-graph-types";
import {
  OUTLOOK_CATEGORY_COLOR_IDS,
  OUTLOOK_CATEGORY_COLOR_MAP,
} from "@/utils/outlook/category-colors";

// Outlook 支持的颜色
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
    // 如果未提供颜色或提供的颜色不受支持，则使用随机的预设颜色
    const outlookColor =
      color && OUTLOOK_COLORS.includes(color)
        ? color
        : OUTLOOK_COLORS[Math.floor(Math.random() * OUTLOOK_COLORS.length)];

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
      throw new Error(`标签冲突但未找到：${sanitizedName}`);
    }
    throw new Error(
      `创建 Outlook 标签「${sanitizedName}」失败：${errorMessage}`,
    );
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
          `Ambiguous Outlook category match for "${rawName}". Please use a unique category name.`,
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

// 标签邮件/会话函数
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
 * 对邮件类别的读-改-写。如果另一个写入先落到该邮件上，
 * Graph 会以 412 冲突拒绝 PATCH；被拒绝的写入并未应用，
 * 因此应重新读取并重新计算，而不是直接覆盖。
 * 返回类别是否发生变化。
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
      // If-Match 会将并发变更之上的写入变为 412 并重试，
      // 而不是静默丢弃另一个写入方的类别。
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
      logger.warn("类别更新冲突，使用最新状态重试", {
        attempt,
      });
      await sleep(CATEGORY_CONFLICT_RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * 重命名主类别后，把已经打了旧类别名的邮件改写成新名称。
 * Outlook 把类别名存在每封邮件上（不是 id），只 PATCH
 * `/me/outlook/masterCategories/{id}` 会让邮件停留在旧名字上。
 */
export async function renameCategoryOnMessages({
  client,
  previousName,
  nextName,
  logger,
}: {
  client: OutlookClient;
  previousName: string;
  nextName: string;
  logger: Logger;
}): Promise<{ updated: number }> {
  const filter = `categories/any(c:c eq '${escapeODataString(previousName)}')`;
  let nextLink: string | undefined;
  let updated = 0;

  do {
    const requestPath = nextLink ?? "/me/messages";
    const page: {
      value: Array<{ id: string }>;
      "@odata.nextLink"?: string;
    } = await withMicrosoftGraphRetry(() => {
      const request = client.getClient().api(requestPath).select("id").top(999);
      return (nextLink ? request : request.filter(filter)).get();
    }, logger);

    for (const message of page.value) {
      const changed = await updateMessageCategories({
        client,
        messageId: message.id,
        update: (categories) =>
          categories.map((category) =>
            category === previousName ? nextName : category,
          ),
        logger,
      });
      if (changed) updated += 1;
    }

    nextLink = page["@odata.nextLink"];
  } while (nextLink);

  return { updated };
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
  // 在 Outlook 中，我们需要更新会话中的每封邮件
  // 为过滤器转义 threadId 中的单引号
  const escapedThreadId = threadId.replace(/'/g, "''");
  const messages: { value: Message[] } = await client
    .getClient()
    .api("/me/messages")
    .filter(`conversationId eq '${escapedThreadId}'`)
    .get();

  await runThreadMessageMutation({
    messageIds: messages.value
      .map((message) => message.id)
      .filter((messageId): messageId is string => Boolean(messageId)),
    threadId,
    logger,
    messageHandler: (messageId) =>
      labelMessage({ client, messageId, categories, logger }),
    failureMessage: "未能为会话中的邮件打标签",
  });
}

// 不使用分页。但该函数实际上并未真正使用。如需要可在将来添加。
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

  // 获取会话中的所有邮件
  const escapedThreadId = threadId.replace(/'/g, "''");
  const messages = await client
    .getClient()
    .api("/me/messages")
    .filter(`conversationId eq '${escapedThreadId}'`)
    .select("id,categories")
    .get();

  const messagesWithCategory: Array<{ id: string; categories?: string[] }> =
    messages.value.filter((message: { id: string; categories?: string[] }) =>
      message.categories?.includes(categoryName),
    );

  await runThreadMessageMutation({
    messageIds: messagesWithCategory.map(
      (message: { id: string }) => message.id,
    ),
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
    failureMessage: "未能从邮件中移除类别",
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

  // 检查目标文件夹是否存在（仅针对自定义文件夹；已知名称可直接信任并使用）
  const wellKnownFolders = Object.keys(WELL_KNOWN_FOLDERS);
  if (!wellKnownFolders.includes(folderId.toLowerCase())) {
    try {
      await client.getClient().api(`/me/mailFolders/${folderId}`).get();
    } catch (error) {
      logger.warn(
        "Custom destination folder not found, skipping archive operation",
        {
          folderId,
          threadId,
          error,
        },
      );
      return;
    }
  }

  // 在 Outlook 中，归档就是移动到某个文件夹
  // 我们需要逐个移动会话中的每封邮件
  const escapedThreadId = threadId.replace(/'/g, "''");
  let messages: { value: Array<{ id: string }> };
  try {
    messages = await client
      .getClient()
      .api("/me/messages")
      .filter(`conversationId eq '${escapedThreadId}'`) // 为过滤器转义 threadId 中的单引号
      .get();
  } catch (error) {
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
    messageIds: messages.value.map((message) => message.id),
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

  // 将发布错误视为非致命（仅记录日志）
  if (publishResult.status === "rejected") {
    logger.error("发布将会话移动到文件夹的操作失败", {
      folderId,
      threadId,
      error: publishResult.reason,
    });
  }

  // 处理归档错误
  if (archiveResult.status === "rejected") {
    const error = archiveResult.reason;
    if (error.message?.includes("Requested entity was not found")) {
      logger.warn("未找到会话", { threadId, userEmail: ownerEmail });
      return { status: 404, message: "未找到会话" };
    }
    logger.error("将会话移动到文件夹失败", {
      folderId,
      threadId,
      error,
    });
    throw error;
  }

  return { status: 200 };
}

// Graph 默认每页 10 封邮件，这会静默地让长会话的其余部分
// 保持已归档。后续页面通过 @odata.nextLink 跟进。
const THREAD_MESSAGE_PAGE_SIZE = 100;
const MAX_THREAD_MESSAGE_PAGES = 20;

const SOURCE_FOLDER_LABELS = {
  archive: "归档",
  deleteditems: "已删除邮件",
} as const;

/**
 * 将会话中的邮件从一个已知文件夹移动到
 * 收件箱。
 *
 * 限定源文件夹能保留同一会话中已发送和已删除邮件
 * 的原有位置。Outlook 没有会话级状态可
 * 恢复，因此源文件夹是判断用户实际意图
 * 的唯一信号。
 */
async function moveThreadFromFolderToInbox({
  client,
  threadId,
  sourceFolder,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  sourceFolder: keyof typeof SOURCE_FOLDER_LABELS;
  logger: Logger;
}) {
  const folderIds = await getFolderIds(client, logger, {
    includeDrafts: false,
  });
  const sourceFolderId = folderIds[WELL_KNOWN_FOLDERS[sourceFolder]];

  // 没有源文件夹，我们无法将邮件与同一会话中的已发送
  // 和已删除邮件区分开，而将它们移动到收件箱
  // 比直接失败更糟。
  if (!sourceFolderId) {
    throw new Error(
      `${SOURCE_FOLDER_LABELS[sourceFolder]} 文件夹未找到，无法将会话移动到收件箱`,
    );
  }

  const messageIds: string[] = [];
  let nextLink: string | undefined;

  for (let page = 0; page < MAX_THREAD_MESSAGE_PAGES; page++) {
    const response: {
      value: { id?: string | null }[];
      "@odata.nextLink"?: string;
    } = await withMicrosoftGraphRetry(
      () =>
        nextLink
          ? client.getClient().api(nextLink).get()
          : client
              .getClient()
              .api("/me/messages")
              .filter(
                `conversationId eq '${escapeODataString(threadId)}' and parentFolderId eq '${escapeODataString(sourceFolderId)}'`,
              )
              .select("id")
              .top(THREAD_MESSAGE_PAGE_SIZE)
              .get(),
      logger,
    );

    messageIds.push(
      ...response.value.map((message) => message.id).filter(isDefined),
    );

    nextLink = response["@odata.nextLink"];
    if (!nextLink) break;
  }

  if (nextLink) {
    logger.warn("在页数上限处停止分页会话邮件", {
      threadId,
      sourceFolder,
      messageCount: messageIds.length,
    });
  }

  await runThreadMessageMutation({
    messageIds,
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
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  logger: Logger;
}) {
  await moveThreadFromFolderToInbox({
    client,
    threadId,
    sourceFolder: "archive",
    logger,
  });
}

/**
 * 将已删除的会话移回收件箱。
 *
 * 与 Gmail 的取消删除不同，这无法将会话恢复到之前
 * 所在的位置，因为 Outlook 并不记录这些。从自定义
 * 文件夹删除的邮件会回到收件箱。
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
    // 在 Outlook 中，我们需要将会话中的每封邮件标记为已读
    // 为过滤器转义 threadId 中的单引号
    const escapedThreadId = threadId.replace(/'/g, "''");
    const messages = await client
      .getClient()
      .api("/me/messages")
      .filter(`conversationId eq '${escapedThreadId}'`)
      .get();

    // 更新会话中的每封邮件
    await runThreadMessageMutation({
      messageIds: messages.value.map((message: { id: string }) => message.id),
      threadId,
      logger,
      messageHandler: (messageId) =>
        withMicrosoftGraphWriteRetry(
          () =>
            client.getClient().api(`/me/messages/${messageId}`).patch({
              isRead: read,
            }),
          logger,
        ),
      failureMessage: "未能将邮件标记为已读",
    });
  } catch (error) {
    // 如果过滤器失败，尝试其他方法
    logger.warn("过滤器失败，尝试替代方法", {
      threadId,
      error,
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
                .api(`/me/messages/${messageId}`)
                .patch({ isRead: read }),
            logger,
          ),
        noMessagesMessage:
          "No messages found for conversationId, skipping mark read",
      });
    } catch (directError) {
      logger.error("将邮件标记为已读失败", {
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
  // 在 Outlook 中，我们使用 "Important" 标志
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
  await withMicrosoftGraphWriteRetry(
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
        `Ambiguous Outlook category names "${existingRawName}" and "${rawName}" normalize to the same value. Please keep category names unique.`,
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
  logger.warn("过滤器失败，尝试替代方法", {
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
      noMessagesMessage:
        "No messages found for conversationId, skipping folder move",
    });

    try {
      await publishArchive({
        ownerEmail,
        threadId,
        actionSource,
        timestamp: Date.now(),
      });
    } catch (publishError) {
      logger.error("发布将会话移动到文件夹的操作失败", {
        folderId,
        email: ownerEmail,
        threadId,
        error: publishError,
      });
    }

    return { status: 200 };
  } catch (directError) {
    logger.error("将会话移动到文件夹失败", {
      folderId,
      threadId,
      error: directError,
    });
    throw directError;
  }
}
