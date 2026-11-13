import type { EmailProvider, EmailLabel } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { ActionType } from "@/generated/prisma/enums";
import {
  CONVERSATION_STATUS_TYPES,
  type ConversationStatus,
} from "./conversation-status-config";
import { getRuleLabel } from "@/utils/rule/consts";
import { labelMessageAndSync } from "@/utils/label.server";
import { logReplyTrackerError } from "./error-logging";
import { isThreadNotFoundError } from "@/utils/email/thread-not-found";

export type LabelIds = Record<
  ConversationStatus,
  {
    labelId: string | null;
    label: string | null;
  }
>;

export async function removeConflictingThreadStatusLabels({
  emailAccountId,
  threadId,
  systemType,
  provider,
  dbLabels: providedDbLabels,
  providerLabels: providedProviderLabels,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  systemType: ConversationStatus;
  provider: EmailProvider;
  dbLabels?: LabelIds;
  providerLabels?: EmailLabel[];
  logger: Logger;
}): Promise<boolean> {
  const [dbLabels, providerLabels] = await fetchThreadStatusLabels({
    emailAccountId,
    provider,
    dbLabels: providedDbLabels,
    providerLabels: providedProviderLabels,
  });

  const removeLabelIds: string[] = [];
  const providerLabelIds = new Set(providerLabels.map((l) => l.id));

  for (const type of CONVERSATION_STATUS_TYPES) {
    if (type === systemType) continue;

    let label = dbLabels[type as ConversationStatus];

    // provider.getLabels() may omit hidden Gmail labels, so verify by ID before
    // treating a DB label as stale.
    if (label.labelId && !providerLabelIds.has(label.labelId)) {
      const labelById = await provider.getLabelById(label.labelId);
      if (labelById?.id) {
        label = {
          labelId: labelById.id,
          label: labelById.name,
        };
      } else {
        logger.warn("DB label ID not found in provider, looking up by name", {
          type,
          staleId: label.labelId,
        });
        label = { labelId: null, label: null };
      }
    }

    if (!label.labelId && !label.label) {
      const l =
        providerLabels.find((l) => l.name === getRuleLabel(type)) ||
        (await provider.getLabelByName(getRuleLabel(type)));
      if (!l?.id) {
        continue;
      }
      label = {
        labelId: l.id,
        label: l.name,
      };
    }
    if (!label.labelId) {
      continue;
    }
    removeLabelIds.push(label.labelId);
  }

  if (removeLabelIds.length === 0) {
    logger.info("没有需要移除的冲突标签");
    return true;
  }

  try {
    await provider.removeThreadLabels(threadId, removeLabelIds);
  } catch (error) {
    await logReplyTrackerError({
      logger,
      emailAccountId,
      scope: "label-helpers",
      message: "无法移除冲突的会话标签",
      operation: "remove-conflicting-thread-status-labels",
      error,
      context: {
        removeLabelCount: removeLabelIds.length,
      },
    });
    return false;
  }

  logger.info("已移除冲突的会话状态标签", {
    removedCount: removeLabelIds.length,
  });
  return true;
}

/**
 * 为邮件/会话应用会话状态标签。
 * 1. 从会话中移除其他互斥的会话状态标签
 * 2. 添加新标签
 *
 * 主要用于出站回复跟踪，该场景需要同时移除和添加标签。
 */
export async function applyThreadStatusLabel({
  emailAccountId,
  threadId,
  messageId,
  systemType,
  provider,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  messageId: string;
  systemType: ConversationStatus;
  provider: EmailProvider;
  logger: Logger;
}): Promise<void> {
  const [dbLabels, providerLabels] = await fetchThreadStatusLabels({
    emailAccountId,
    provider,
  });

  const addLabel = async (): Promise<boolean> => {
    let targetLabel = dbLabels[systemType];

    // If we don't have labelId from DB, fetch/create it
    if (!targetLabel.labelId) {
      const label =
        providerLabels.find((l) => l.name === getRuleLabel(systemType)) ||
        (await provider.createLabel(getRuleLabel(systemType)));
      if (label) {
        targetLabel = {
          labelId: label.id,
          label: label.name,
        };
      }
    }

    // Must have labelId to proceed
    if (!targetLabel.labelId) {
      logger.error("Failed to get or create target label", {
        systemType,
        labelName: getRuleLabel(systemType),
      });
      return false;
    }

    try {
      await labelMessageAndSync({
        provider,
        messageId,
        labelId: targetLabel.labelId,
        labelName: targetLabel.label,
        emailAccountId,
        logger,
      });
      return true;
    } catch (error) {
      // 实体缺失也可能是过期标签；在将其视为预期的删除竞争前，先确认邮件状态。
      if (
        isThreadNotFoundError(error) &&
        (await isMessageMissing(provider, messageId))
      ) {
        logger.warn("邮件已不存在，跳过会话状态标签");
        return false;
      }

      await logReplyTrackerError({
        logger,
        emailAccountId,
        scope: "label-helpers",
        message: "无法应用会话状态标签",
        operation: "apply-thread-status-label",
        error,
        context: {
          labelId: targetLabel.labelId,
          labelName: targetLabel.label,
        },
      });
      return false;
    }
  };

  // 串行执行：Outlook 会重写每封邮件的完整类别列表，因此对同一邮件的重叠写入
  // 会发生冲突或丢失更改。
  const removedConflicts = await removeConflictingThreadStatusLabels({
    emailAccountId,
    threadId,
    systemType,
    provider,
    dbLabels,
    providerLabels,
    logger,
  });
  const addedTargetLabel = await addLabel();

  if (!removedConflicts || !addedTargetLabel) {
    logger.warn("会话状态标签应用完成，但存在错误", {
      removedConflicts,
      addedTargetLabel,
    });
    return;
  }

  logger.info("Thread status label applied successfully");
}

export async function getLabelsFromDb(
  emailAccountId: string,
): Promise<LabelIds> {
  const rules = await prisma.rule.findMany({
    where: {
      emailAccountId,
      systemType: { in: CONVERSATION_STATUS_TYPES },
    },
    select: {
      systemType: true,
      actions: {
        where: { type: ActionType.LABEL },
        select: { type: true, labelId: true, label: true },
      },
    },
  });

  const dbLabels: LabelIds = {
    TO_REPLY: { labelId: null, label: null },
    AWAITING_REPLY: { labelId: null, label: null },
    FYI: { labelId: null, label: null },
    ACTIONED: { labelId: null, label: null },
  };

  for (const rule of rules) {
    if (!rule.systemType) continue;
    const labelAction = rule.actions.find((a) => a.type === ActionType.LABEL);
    if (labelAction?.labelId || labelAction?.label) {
      dbLabels[rule.systemType as ConversationStatus] = {
        labelId: labelAction.labelId,
        label: labelAction.label,
      };
    }
  }

  return dbLabels;
}

async function fetchThreadStatusLabels({
  emailAccountId,
  provider,
  dbLabels,
  providerLabels,
}: {
  emailAccountId: string;
  provider: EmailProvider;
  dbLabels?: LabelIds;
  providerLabels?: EmailLabel[];
}): Promise<[LabelIds, EmailLabel[]]> {
  return Promise.all([
    dbLabels ?? getLabelsFromDb(emailAccountId),
    providerLabels ?? provider.getLabels({ includeHidden: true }),
  ]);
}

async function isMessageMissing(provider: EmailProvider, messageId: string) {
  try {
    await provider.getMessage(messageId);
    return false;
  } catch (error) {
    return isThreadNotFoundError(error);
  }
}
