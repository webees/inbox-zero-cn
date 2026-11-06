import type { OutlookClient } from "@/utils/outlook/client";
import type { MessageRule } from "@microsoft/microsoft-graph-types";
import type { Logger } from "@/utils/logger";
import { isAlreadyExistsError } from "./errors";
import { withMicrosoftGraphWriteRetry } from "@/utils/outlook/retry";
import { getLabelById, getOrCreateLabel } from "@/utils/outlook/label";

// Microsoft Graph API 没有与 Gmail 过滤器直接对应的功能
// 因此我们改用邮件规则，它们更复杂但能提供类似的功能
// 注意：Outlook 中的邮件规则限制更多，且需要不同的权限

export async function createFilter(options: {
  client: OutlookClient;
  from: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  logger: Logger;
}) {
  const { client, from, addLabelIds, removeLabelIds, logger } = options;

  try {
    const actions = await buildFilterActions({
      client,
      addLabelIds,
      removeLabelIds,
      context: { from },
      logger,
    });

    const rule: MessageRule = {
      displayName: `Filter for ${from}`,
      sequence: 1,
      isEnabled: true,
      conditions: {
        senderContains: [from],
      },
      actions,
    };

    const response: MessageRule = await withMicrosoftGraphWriteRetry(
      () =>
        client.getClient().api("/me/mailFolders/inbox/messageRules").post(rule),
      logger,
    );

    return { status: 201, data: response };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      logger.warn("过滤器已存在", { from });
      return { status: 200 };
    }
    throw error;
  }
}

export async function createAutoArchiveFilter({
  client,
  from,
  labelName,
  logger,
}: {
  client: OutlookClient;
  from: string;
  labelName?: string;
  logger: Logger;
}) {
  try {
    // 对于 Outlook，我们将创建一条将邮件移动到归档的规则
    const rule: MessageRule = {
      displayName: `Auto-archive filter for ${from}`,
      sequence: 1,
      isEnabled: true,
      conditions: {
        senderContains: [from],
      },
      actions: {
        moveToFolder: "archive",
        markAsRead: true,
        ...(labelName && { assignCategories: [labelName] }),
      },
    };

    const response: MessageRule = await withMicrosoftGraphWriteRetry(
      () =>
        client.getClient().api("/me/mailFolders/inbox/messageRules").post(rule),
      logger,
    );

    return { status: 201, data: response };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      logger.warn("自动归档过滤器已存在", { from });
      return { status: 200 };
    }
    throw error;
  }
}

export async function deleteFilter({
  client,
  id,
  logger,
}: {
  client: OutlookClient;
  id: string;
  logger: Logger;
}) {
  try {
    await withMicrosoftGraphWriteRetry(
      () =>
        client
          .getClient()
          .api(`/me/mailFolders/inbox/messageRules/${id}`)
          .delete(),
      logger,
    );

    return { status: 204 };
  } catch (error) {
    logger.error("删除 Outlook 过滤器时出错", { id, error });
    throw error;
  }
}

export async function getFiltersList({
  client,
  logger,
}: {
  client: OutlookClient;
  logger: Logger;
}) {
  try {
    const response: { value: MessageRule[] } = await client
      .getClient()
      .api("/me/mailFolders/inbox/messageRules")
      .get();

    return response;
  } catch (error) {
    logger.error("获取 Outlook 过滤器列表时出错", {
      error,
      errorMessage: error instanceof Error ? error.message : "未知错误",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// 针对 Outlook 专属操作的额外辅助函数

export async function createCategoryFilter({
  client,
  from,
  categoryName,
  logger,
}: {
  client: OutlookClient;
  from: string;
  categoryName: string;
  logger: Logger;
}) {
  const category = await getOrCreateLabel({
    client,
    name: categoryName,
    logger,
  });

  // 注意：Microsoft Graph API 不支持在邮件规则中直接应用类别
  // 该函数确保类别存在；实际分配在处理邮件时进行
  logger.info("已确保过滤器的类别", {
    categoryName: category.displayName,
    categoryId: category.id,
  });
  logger.trace("确保分类的筛选上下文", { from });

  return {
    status: 200,
    category,
    message: "已确保分类。注意：类别必须应用到单封邮件上。",
  };
}

export async function updateFilter({
  client,
  id,
  from,
  addLabelIds,
  removeLabelIds,
  logger,
}: {
  client: OutlookClient;
  id: string;
  from: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  logger: Logger;
}) {
  try {
    const actions = await buildFilterActions({
      client,
      addLabelIds,
      removeLabelIds,
      context: { id, from },
      logger,
    });

    const rule: MessageRule = {
      displayName: `Filter for ${from}`,
      sequence: 1,
      isEnabled: true,
      conditions: {
        senderContains: [from],
      },
      actions,
    };

    const response: MessageRule = await withMicrosoftGraphWriteRetry(
      () =>
        client
          .getClient()
          .api(`/me/mailFolders/inbox/messageRules/${id}`)
          .patch(rule),
      logger,
    );

    return response;
  } catch (error) {
    logger.error("更新 Outlook 过滤器时出错", { id, error });
    throw error;
  }
}

// 辅助函数

/**
 * 为 Outlook 规则将标签 ID 解析为类别名称。
 * Outlook 规则使用类别名称，而不是 ID。
 */
async function resolveCategoryNames(
  client: OutlookClient,
  labelIds: string[],
  logger: Logger,
): Promise<string[]> {
  const categoryNames: string[] = [];

  for (const labelId of labelIds) {
    try {
      const category = await getLabelById({ client, id: labelId });
      if (category?.displayName) {
        categoryNames.push(category.displayName);
      } else {
        logger.error("按 ID 未找到类别", { labelId });
      }
    } catch (error) {
      logger.error("解析类别 ID 失败", {
        labelId,
        error,
      });
    }
  }

  return categoryNames;
}

/**
 * 为 Outlook 邮件规则构建 actions 对象。
 * Microsoft API 至少需要一个 action。
 */
async function buildFilterActions(options: {
  client: OutlookClient;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  context?: Record<string, unknown>;
  logger: Logger;
}): Promise<{
  moveToFolder?: string;
  markAsRead?: boolean;
  assignCategories?: string[];
}> {
  const { client, addLabelIds, removeLabelIds, context = {}, logger } = options;
  const actions: {
    moveToFolder?: string;
    markAsRead?: boolean;
    assignCategories?: string[];
  } = {};

  // 处理标签新增（Outlook 中的类别）
  if (addLabelIds && addLabelIds.length > 0) {
    const categoryNames = await resolveCategoryNames(
      client,
      addLabelIds,
      logger,
    );
    if (categoryNames.length > 0) {
      actions.assignCategories = categoryNames;
    }
  }

  // 处理标签移除
  if (removeLabelIds?.includes("INBOX")) {
    actions.moveToFolder = "archive";
  }

  if (removeLabelIds?.includes("UNREAD")) {
    actions.markAsRead = true;
  }

  // 如果未指定任何 action，则默认标记为已读
  // (Microsoft API 至少需要一个 action)
  if (Object.keys(actions).length === 0) {
    logger.warn("过滤器未指定任何操作，默认标记为已读", {
      addLabelIds,
      removeLabelIds,
      ...context,
    });
    actions.markAsRead = true;
  }

  return actions;
}
