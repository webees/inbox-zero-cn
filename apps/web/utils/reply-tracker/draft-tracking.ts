import { after } from "next/server";
import { ActionType, DraftEmailStatus } from "@/generated/prisma/enums";
import type { ParsedMessage } from "@/utils/types";
import prisma from "@/utils/prisma";
import { withPrismaRetry } from "@/utils/prisma-retry";
import { calculateSimilarity } from "@/utils/similarity-score";
import { isDraftUnmodified } from "@/utils/ai/choose-rule/draft-management";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import {
  isMeaningfulDraftEdit,
  saveDraftSendLogReplyMemory,
  syncReplyMemoriesFromDraftSendLogs,
} from "@/utils/ai/reply/reply-memory";
import { stripProviderSignatureFromParsedMessage } from "@/utils/email/signature-normalization";
import {
  replaceMessagingDraftNotificationsWithDraftSentState,
  replaceMessagingDraftNotificationsWithHandledOnWebState,
} from "@/utils/messaging/rule-notifications";
import { emailToContentForAI } from "@/utils/ai/content-sanitizer";
import { FIRST_TIME_EVENTS, trackFirstTimeEvent } from "@/utils/posthog";
import { messageRepliesToSourceSender } from "@/utils/email";
import { getDraftSendLogSimilarityFields } from "./draft-similarity";
import { logReplyTrackerError } from "./error-logging";

const DRAFT_SENT_SIMILARITY_THRESHOLD = 0.7;
/**
 * 检查已发送的邮件是否源自 AI 草稿，并记录其相似度。
 */
export async function trackSentDraftStatus({
  emailAccountId,
  message,
  provider,
  logger,
}: {
  emailAccountId: string;
  message: ParsedMessage;
  provider: EmailProvider;
  logger: Logger;
}) {
  const { threadId, id: sentMessageId } = message;

  logger.info("检查已发送邮件是否对应某个 AI 草稿");

  if (!sentMessageId) {
    logger.warn("Sent message missing ID, cannot track draft status");
    return;
  }

  // 查找此会话中最近创建的草稿
  const executedAction = await prisma.executedAction.findFirst({
    where: {
      executedRule: {
        emailAccountId,
        threadId: threadId,
      },
      type: ActionType.DRAFT_EMAIL,
      draftId: { not: null },
      draftSendLog: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      content: true,
      draftId: true,
      executedRuleId: true,
      executedRule: {
        select: {
          messageId: true,
          emailAccount: {
            select: {
              signature: true,
            },
          },
        },
      },
    },
  });

  if (!executedAction?.draftId) {
    logger.info("未找到具有 draftId 的对应 AI 草稿操作");
    return;
  }

  const [draftExists, sourceMessage] = await Promise.all([
    provider.getDraft(executedAction.draftId),
    provider
      .getMessage(executedAction.executedRule.messageId)
      .catch((error) => {
        logger.warn("加载已发送草稿跟踪的来源邮件失败", {
          error,
          executedActionId: executedAction.id,
        });
        return null;
      }),
  ]);

  const executedActionId = executedAction.id;

  // 计算已发送邮件与 AI 草稿内容之间的相似度
  // 传入完整邮件以正确处理 Outlook 的 HTML 内容
  const accountSignature = executedAction.executedRule.emailAccount?.signature;
  const similarityScore = calculateSimilarity(executedAction.content, message, {
    excludedSignatures: accountSignature ? [accountSignature] : [],
  });
  const sentMessageRepliesToSource =
    sourceMessage &&
    messageRepliesToSourceSender({
      sentMessage: message,
      sourceMessage,
    });
  const sentText = getSentReplyText(message);
  const similarityFields = getDraftSendLogSimilarityFields({
    draftText: executedAction.content,
    sentMessage: message,
    sentText,
    accountSignature,
    draftExists: !!draftExists,
    sentMessageRepliesToSource,
  });
  const createDraftSendLogData = () => ({
    executedActionId: executedActionId,
    sentMessageId: sentMessageId,
    similarityScore: similarityScore,
    sentText,
    ...similarityFields,
  });

  logger.info("已计算相似度分数", {
    executedActionId,
    similarityScore,
    draftExists: !!draftExists,
    sentMessageRepliesToSource,
  });

  if (draftExists || sentMessageRepliesToSource === false) {
    logger.info("将 AI 草稿标记为未发送", {
      executedActionId: executedAction.id,
      draftId: executedAction.draftId,
      similarityScore,
      draftExists: !!draftExists,
      sentMessageRepliesToSource,
    });

    // 创建 DraftSendLog 以记录该比较。
    const [draftSendLog] = await withPrismaRetry(
      () =>
        prisma.$transaction([
          prisma.draftSendLog.create({
            data: createDraftSendLogData(),
          }),
          prisma.executedAction.update({
            where: { id: executedActionId },
            data: {
              draftStatus: DraftEmailStatus.REPLIED_WITHOUT_DRAFT,
            },
          }),
        ]),
      { logger },
    );

    logger.info("已创建草稿发送日志并将操作标记为未发送", {
      executedActionId,
      sentMessageRepliesToSource,
    });
    await replaceMessagingDraftNotificationsWithHandledOnWebState({
      executedRuleId: executedAction.executedRuleId,
      logger,
    });
    if (sentMessageRepliesToSource !== false) {
      queueReplyMemoryLearning({
        emailAccountId,
        executedActionId,
        draftSendLogId: draftSendLog.id,
        draftText: executedAction.content,
        sentText,
        similarityScore,
        provider,
        logger,
      });
    }
    return;
  }

  logger.info(
    "Original AI draft not found (likely sent or deleted), creating send log.",
    {
      executedActionId,
      draftId: executedAction.draftId,
      similarityScore,
    },
  );

  // Gmail 和 Outlook 都让「草稿缺失」具有歧义：它可能意味着已发送、
  // 已删除、已移动，或无法再通过存储的草稿 ID 访问。当
  // 已发送邮件的收件人是原始发件人时，将生命周期记录为很可能
  // 已发送，并将编辑强度留给 similarityScore。
  const draftStatus = getSentDraftStatus({
    similarityScore,
    sentMessageRepliesToSource,
  });
  const wasLikelyDraftSent = isDraftSentStatus(draftStatus);

  const [draftSendLog] = await withPrismaRetry(
    () =>
      prisma.$transaction([
        prisma.draftSendLog.create({
          data: createDraftSendLogData(),
        }),
        prisma.executedAction.update({
          where: { id: executedActionId },
          data: {
            draftStatus,
          },
        }),
      ]),
    { logger },
  );

  logger.info("已通过事务成功创建草稿发送日志并更新操作状态", {
    executedActionId,
  });

  if (wasLikelyDraftSent) {
    after(() =>
      trackFirstTimeEvent({
        emailAccountId,
        event: FIRST_TIME_EVENTS.FIRST_DRAFT_SENT,
      }),
    );
  }

  const replaceMessagingDraftNotifications = wasLikelyDraftSent
    ? replaceMessagingDraftNotificationsWithDraftSentState
    : replaceMessagingDraftNotificationsWithHandledOnWebState;
  await replaceMessagingDraftNotifications({
    executedRuleId: executedAction.executedRuleId,
    logger,
  });

  queueReplyMemoryLearning({
    emailAccountId,
    executedActionId,
    draftSendLogId: draftSendLog.id,
    draftText: executedAction.content,
    sentText,
    similarityScore,
    provider,
    logger,
  });
}

/**
 * 清理会话中旧的 AI 生成草稿。
 * 同时处理基于规则的草稿（ExecutedAction）和跟进草稿（ThreadTracker）。
 * 对于规则草稿：删除前检查是否未被修改。
 * 对于跟进草稿：无条件删除（若有新邮件到达则视为过期）。
 */
export async function cleanupThreadAIDrafts({
  threadId,
  emailAccountId,
  provider,
  logger,
  excludeMessageId,
}: {
  threadId: string;
  emailAccountId: string;
  provider: EmailProvider;
  logger: Logger;
  excludeMessageId: string;
}) {
  logger.info("开始清理会话中旧的 AI 草稿");

  try {
    // 查找仍处于待处理状态的草稿操作，或用户已回复
    // 但未使用该草稿、旧草稿可能仍需清理的情况。
    // 排除当前邮件的草稿，以免删除刚创建的草稿
    const potentialDraftsToClean = await prisma.executedAction.findMany({
      where: {
        executedRule: {
          emailAccountId,
          threadId: threadId,
          messageId: { not: excludeMessageId },
        },
        type: ActionType.DRAFT_EMAIL,
        draftId: { not: null },
        draftStatus: {
          in: [
            DraftEmailStatus.PENDING,
            DraftEmailStatus.REPLIED_WITHOUT_DRAFT,
          ],
        },
      },
      select: {
        id: true,
        draftId: true,
        draftStatus: true,
        content: true,
      },
    });

    if (potentialDraftsToClean.length === 0) {
      logger.info("未找到需要清理的相关旧 AI 草稿");
      return;
    }

    logger.info("找到可能需要清理的潜在 AI 草稿", {
      potentialDraftsToCleanLength: potentialDraftsToClean.length,
    });

    for (const action of potentialDraftsToClean) {
      if (!action.draftId) continue; // Not expected to happen, but to fix TS error

      const actionLoggerOptions = {
        executedActionId: action.id,
        draftId: action.draftId,
      };
      try {
        const draftDetails = await provider.getDraft(action.draftId);

        logger.info("已拉取用于清理检查的草稿详情", {
          ...actionLoggerOptions,
          draftExists: !!draftDetails,
          draftEmbeddedMessageId: draftDetails?.id,
          draftThreadId: draftDetails?.threadId,
          hasTextPlain: !!draftDetails?.textPlain,
          hasTextHtml: !!draftDetails?.textHtml,
        });
        logger.trace("草稿内容预览", {
          ...actionLoggerOptions,
          draftTextPreview: (
            draftDetails?.textPlain || draftDetails?.textHtml
          )?.slice(0, 100),
        });

        if (draftDetails?.textPlain || draftDetails?.textHtml) {
          // 草稿存在，检查是否被修改
          // 传入完整的 draftDetails 以正确处理 Outlook 的 HTML 内容
          const similarityScore = calculateSimilarity(
            action.content,
            draftDetails,
          );
          const isUnmodified = action.content
            ? isDraftUnmodified({
                originalContent: action.content,
                currentDraft: draftDetails,
                logger,
              })
            : false;

          logger.info("已检查现有草稿是否被修改", {
            ...actionLoggerOptions,
            draftEmbeddedMessageId: draftDetails.id,
            similarityScore,
            isUnmodified,
          });
          logger.trace("用于相似度检查的原始内容预览", {
            ...actionLoggerOptions,
            originalContentPreview: action.content?.slice(0, 100),
          });

          if (isUnmodified) {
            logger.info("Draft is unmodified, proceeding with deletion", {
              ...actionLoggerOptions,
              draftEmbeddedMessageId: draftDetails.id,
              draftThreadId: draftDetails.threadId,
            });
            const statusData = getDraftCleanupStatusData({
              draftStatus: action.draftStatus,
              status: DraftEmailStatus.CLEANED_UP_UNUSED,
            });
            await Promise.all([
              provider.deleteDraft(action.draftId),
              statusData
                ? withPrismaRetry(
                    () =>
                      prisma.executedAction.update({
                        where: { id: action.id },
                        data: statusData,
                      }),
                    { logger },
                  )
                : Promise.resolve(),
            ]);
            logger.info("已删除未修改的草稿。", actionLoggerOptions);
          } else {
            logger.info(
              "Draft has been modified, skipping deletion.",
              actionLoggerOptions,
            );
          }
        } else {
          logger.info(
            "Draft no longer exists, tracking cleanup status.",
            actionLoggerOptions,
          );
          const statusData = getDraftCleanupStatusData({
            draftStatus: action.draftStatus,
            status: DraftEmailStatus.MISSING_FROM_PROVIDER,
          });
          if (statusData) {
            await withPrismaRetry(
              () =>
                prisma.executedAction.update({
                  where: { id: action.id },
                  data: statusData,
                }),
              { logger },
            );
          }
        }
      } catch (error) {
        await logReplyTrackerError({
          logger,
          emailAccountId,
          scope: "draft-tracking",
          message: "检查草稿以进行清理时出错",
          operation: "check-draft-for-cleanup",
          context: actionLoggerOptions,
          error,
        });
      }
    }

    // 同时清理此会话的跟进草稿（安全网）。
    // clearFollowUpLabel 已经同步处理了这一点，因此这里
    // 通常什么都找不到。保留作为非标准代码路径的回退。
    const followUpTrackers = await prisma.threadTracker.findMany({
      where: {
        emailAccountId,
        threadId,
        followUpDraftId: { not: null },
      },
      select: {
        id: true,
        followUpDraftId: true,
      },
    });

    if (followUpTrackers.length > 0) {
      logger.info("Found follow-up drafts to cleanup", {
        count: followUpTrackers.length,
      });

      for (const tracker of followUpTrackers) {
        if (!tracker.followUpDraftId) continue;

        try {
          await provider.deleteDraft(tracker.followUpDraftId);
          await prisma.threadTracker.update({
            where: { id: tracker.id },
            data: { followUpDraftId: null },
          });
          logger.info("Deleted follow-up draft", {
            trackerId: tracker.id,
            draftId: tracker.followUpDraftId,
          });
        } catch (error) {
          logger.error("Error deleting follow-up draft", {
            trackerId: tracker.id,
            draftId: tracker.followUpDraftId,
            error,
          });
        }
      }
    }

    logger.info("已完成会话 AI 草稿的清理");
  } catch (error) {
    logger.error("会话草稿清理过程中出错", { error });
  }
}

function queueReplyMemoryLearning({
  emailAccountId,
  executedActionId,
  draftSendLogId,
  draftText,
  sentText,
  similarityScore,
  provider,
  logger,
}: {
  emailAccountId: string;
  executedActionId: string;
  draftSendLogId: string;
  draftText?: string | null;
  sentText: string | null;
  similarityScore: number;
  provider: EmailProvider;
  logger: Logger;
}) {
  if (!draftText || !sentText) return;

  const replyMemorySentText = sentText.slice(0, 4000);

  if (
    !isMeaningfulDraftEdit({
      draftText,
      sentText: replyMemorySentText,
      similarityScore,
    })
  ) {
    return;
  }

  after(async () => {
    try {
      await saveDraftSendLogReplyMemory({
        draftSendLogId,
        sentText: replyMemorySentText,
      });
      await syncReplyMemoriesFromDraftSendLogs({
        emailAccountId,
        provider,
        logger,
      });
    } catch (error) {
      logger.error("从草稿编辑中学习回复记忆失败", {
        error,
        executedActionId,
      });
    }
  });
}

function getSentReplyText(message: ParsedMessage): string | null {
  const sentText = emailToContentForAI(
    stripProviderSignatureFromParsedMessage(message),
    {
      maxLength: 0,
      extractReply: true,
      removeForwarded: true,
    },
  ).trim();

  return sentText || null;
}

function getSentDraftStatus({
  similarityScore,
  sentMessageRepliesToSource,
}: {
  similarityScore: number;
  sentMessageRepliesToSource: boolean | null;
}): DraftEmailStatus {
  if (
    sentMessageRepliesToSource ||
    similarityScore >= DRAFT_SENT_SIMILARITY_THRESHOLD
  ) {
    return DraftEmailStatus.LIKELY_SENT;
  }
  return DraftEmailStatus.REPLIED_WITHOUT_DRAFT;
}

function isDraftSentStatus(status: DraftEmailStatus): boolean {
  return status === DraftEmailStatus.LIKELY_SENT;
}

function getDraftCleanupStatusData({
  draftStatus,
  status,
}: {
  draftStatus?: DraftEmailStatus | null;
  status: DraftEmailStatus;
}): { draftStatus: DraftEmailStatus } | null {
  if (
    draftStatus &&
    draftStatus !== DraftEmailStatus.PENDING &&
    draftStatus !== DraftEmailStatus.REPLIED_WITHOUT_DRAFT
  ) {
    return null;
  }
  return { draftStatus: status };
}
