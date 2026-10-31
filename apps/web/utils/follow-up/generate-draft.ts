import type { EmailProvider } from "@/utils/email/types";
import { buildDraftReplyBody } from "@/utils/email/reply-body";
import type { Logger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { aiDraftFollowUp } from "@/utils/ai/reply/draft-follow-up";
import { getWritingStyle } from "@/utils/user/get";
import { internalDateToDate, sortByInternalDate } from "@/utils/date";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { isSameEmailAddress } from "@/utils/email";
import prisma from "@/utils/prisma";
import { withPrismaRetry } from "@/utils/prisma-retry";
import { captureException } from "@/utils/error";
import { shouldSkipAutoDraft } from "@/utils/auto-draft";

/**
 * 为等待回复的会话生成跟进草稿。
 * 当定时任务检测到会话超过跟进阈值时使用。
 */
export async function generateFollowUpDraft({
  emailAccount,
  threadId,
  messageId,
  trackerId,
  provider,
  logger,
}: {
  emailAccount: EmailAccountWithAI;
  threadId: string;
  messageId: string;
  trackerId: string;
  provider: EmailProvider;
  logger: Logger;
}): Promise<void> {
  if (shouldSkipAutoDraft({ logger, source: "follow-up" })) return;

  logger.info("正在生成跟进草稿", { threadId, messageId });

  try {
    const thread = await provider.getThread(threadId);
    if (!thread.messages?.length) {
      logger.warn("会话中没有邮件", { threadId });
      return;
    }

    const threadMessages = [...thread.messages].sort(sortByInternalDate());
    const trackedMessage = threadMessages.find((msg) => msg.id === messageId);
    if (!trackedMessage) {
      logger.warn("跳过跟进草稿：会话中找不到被追踪的邮件", {
        threadId,
        messageId,
      });
      return;
    }

    const latestMessage = threadMessages.at(-1);
    if (latestMessage?.id !== trackedMessage.id) {
      logger.info("跳过跟进草稿：被追踪的邮件已不再是会话中最新的邮件", {
        threadId,
        messageId,
        latestMessageId: latestMessage?.id,
      });
      return;
    }

    if (!isMessageFromUser(trackedMessage, emailAccount.email)) {
      logger.info("跳过跟进草稿：被追踪的邮件不是用户发送的", {
        threadId,
        messageId,
      });
      return;
    }

    const recipientOverride = trackedMessage.headers.to || undefined;

    // 将消息转换为 LLM 格式
    const messages = threadMessages.map((msg, index) => ({
      date: internalDateToDate(msg.internalDate),
      ...getEmailForLLM(msg, {
        maxLength: index === threadMessages.length - 1 ? 2000 : 500,
        extractReply: true,
        removeForwarded: false,
        includeLinkUrls: true,
        includeImageAltText: true,
      }),
    }));

    const writingStyle = await getWritingStyle({
      emailAccountId: emailAccount.id,
    });

    const result = await aiDraftFollowUp({
      messages,
      emailAccount,
      writingStyle,
    });

    if (typeof result !== "string") {
      throw new Error("跟进草稿结果不是字符串");
    }

    const draftContent = await buildDraftReplyBody({
      text: result,
      emailAccountId: emailAccount.id,
      userId: emailAccount.userId,
    });

    const { draftId } = await provider.draftEmail(
      trackedMessage,
      {
        to: recipientOverride,
        content: draftContent,
      },
      emailAccount.email,
      undefined,
    );

    // 将 draftId 存入跟踪器，以便去重时检测已有草稿。
    // 使用重试以尽量提高成功率。包裹在独立的 try-catch 中
    // 因此持续失败也不会阻止返回（草稿已创建）。
    try {
      await withPrismaRetry(
        () =>
          prisma.threadTracker.update({
            where: { id: trackerId },
            data: { followUpDraftId: draftId },
          }),
        { logger },
      );
    } catch (updateError) {
      logger.error("用 draftId 更新追踪项失败，正在删除孤立草稿", {
        threadId,
        draftId,
        trackerId,
        error: updateError,
      });
      captureException(updateError);
      try {
        await provider.deleteDraft(draftId);
      } catch (deleteError) {
        logger.error("删除孤立草稿失败", {
          threadId,
          draftId,
          error: deleteError,
        });
      }
    }

    logger.info("已创建跟进草稿", { threadId, draftId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 跳过不支持回复的邮件的草稿生成
    // （例如日历邀请、会议请求、送达报告）
    if (errorMessage.includes("Item type is invalid for creating a Reply")) {
      logger.info("跳过草稿生成——邮件类型不支持回复", { threadId });
      return;
    }

    logger.error("生成跟进草稿失败", { threadId, error });
    throw error;
  }
}

function isMessageFromUser(
  message: { headers: { from: string } },
  userEmail: string,
) {
  return isSameEmailAddress(message.headers.from, userEmail);
}
