import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { ParsedMessage } from "@/utils/types";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { captureException } from "@/utils/error";
import { handleOutboundReply } from "./outbound";
import { cleanupThreadAIDrafts, trackSentDraftStatus } from "./draft-tracking";
import { clearFollowUpLabel } from "@/utils/follow-up/labels";
import { excludeRepliedSendersFromColdEmail } from "@/utils/cold-email/exclude-replied-sender";
import { logReplyTrackerError } from "./error-logging";
import {
  acquireOutboundMessageLock,
  clearOutboundMessageLock,
  markOutboundMessageProcessed,
} from "@/utils/redis/message-processing";

export async function handleOutboundMessage({
  emailAccount,
  message,
  provider,
  logger,
}: {
  emailAccount: EmailAccountWithAI;
  message: ParsedMessage;
  provider: EmailProvider;
  logger: Logger;
}) {
  logger = logger.with({
    email: emailAccount.email,
    messageId: message.id,
    threadId: message.threadId,
  });

  logger.info("Handling outbound message", {
    messageLabelIds: message.labelIds,
    messageInternalDate: message.internalDate,
  });
  logger.trace("Outbound message details", {
    messageFrom: message.headers.from,
    messageTo: message.headers.to,
    messageSubject: message.headers.subject,
  });
  const lockToken = await acquireOutboundMessageLock({
    emailAccountId: emailAccount.id,
    messageId: message.id,
  });
  if (!lockToken) {
    logger.info(
      "Outbound message already processed or currently processing, skipping.",
    );
    return;
  }

  // Before the slower tracking work below, so a fast reply from the other side is
  // classified against the corrected pattern. Best-effort: on failure the sender
  // just stays pinned, and the next reply to them tries again.
  try {
    await excludeRepliedSendersFromColdEmail({
      emailAccountId: emailAccount.id,
      message,
      provider,
      logger,
    });
  } catch (error) {
    logger.error("从冷邮件拦截中排除已回复发件人时出错", {
      error,
    });
    captureException(error, { emailAccountId: emailAccount.id });
  }

  let processedSuccessfully = false;

  try {
    const results = await Promise.allSettled([
      trackSentDraftStatus({
        emailAccountId: emailAccount.id,
        message,
        provider,
        logger,
      }),
      handleOutboundReply({
        emailAccount,
        message,
        provider,
        logger,
      }),
    ]);

    const [trackSentDraftStatusResult, handleOutboundReplyResult] = results;

    if (trackSentDraftStatusResult.status === "rejected") {
      await logReplyTrackerError({
        logger,
        emailAccountId: emailAccount.id,
        scope: "handle-outbound",
        message: "跟踪已发送草稿状态时出错",
        operation: "track-sent-draft-status",
        error: trackSentDraftStatusResult.reason,
        capture: true,
      });
    }

    if (handleOutboundReplyResult.status === "rejected") {
      await logReplyTrackerError({
        logger,
        emailAccountId: emailAccount.id,
        scope: "handle-outbound",
        message: "处理外发回复时出错",
        operation: "handle-outbound-reply",
        error: handleOutboundReplyResult.reason,
        capture: true,
      });
    }

    // 在耗时的回复跟踪工作完成后才持久化已处理标记，
    // 以免后续清理失败触发重复重放。
    processedSuccessfully = results.every(
      (result) => result.status === "fulfilled",
    );

    await cleanupThreadAIDrafts({
      threadId: message.threadId,
      emailAccountId: emailAccount.id,
      provider,
      logger,
      excludeMessageId: message.id,
    });
  } catch (error) {
    logger.error("清理会话草稿时出错", { error });
    captureException(error, { emailAccountId: emailAccount.id });
  }

  // 如果存在跟进标签则移除（用户已回复，因此不再需要跟进）
  try {
    await clearFollowUpLabel({
      emailAccountId: emailAccount.id,
      threadId: message.threadId,
      provider,
      logger,
    });
  } catch (error) {
    logger.error("Error removing follow-up label", { error });
    captureException(error, { emailAccountId: emailAccount.id });
  } finally {
    if (processedSuccessfully) {
      const markedAsProcessed = await markOutboundMessageProcessed({
        emailAccountId: emailAccount.id,
        messageId: message.id,
        lockToken,
      }).catch((error) => {
        logger.error("Failed to mark outbound message as processed", { error });
        return false;
      });
      if (!markedAsProcessed) {
        logger.warn(
          "Skipped marking outbound message as processed because lock was no longer owned.",
        );
      }
    } else {
      const lockCleared = await clearOutboundMessageLock({
        emailAccountId: emailAccount.id,
        messageId: message.id,
        lockToken,
      }).catch((error) => {
        logger.error("Failed to clear outbound message lock", { error });
        return false;
      });
      if (!lockCleared) {
        logger.warn(
          "Skipped clearing outbound message lock because lock was no longer owned.",
        );
      }
    }
  }
}
