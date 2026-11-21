import { sendColdEmailNotification as sendColdEmailNotificationViaResend } from "@inboxzero/transactional-email";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import { formatReplySubject } from "@/utils/email/subject";

export async function sendColdEmailNotification({
  senderEmail,
  recipientEmail,
  originalSubject,
  originalMessageId,
  logger,
}: {
  senderEmail: string; // The cold emailer we're notifying
  recipientEmail: string; // The user who received the cold email
  originalSubject: string;
  originalMessageId?: string; // Message-ID of the original email for threading
  logger: Logger;
}): Promise<{ success: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) {
    logger.warn("未配置 Resend，跳过冷邮件通知");
    return { success: false, error: "未配置 Resend" };
  }

  const subject = formatReplySubject(originalSubject);
  logger.trace("正在发送冷邮件通知", { senderEmail });

  try {
    const result = await sendColdEmailNotificationViaResend({
      from: env.RESEND_FROM_EMAIL,
      to: senderEmail,
      replyTo: recipientEmail,
      subject,
      inReplyTo: originalMessageId,
      emailProps: {
        baseUrl: env.NEXT_PUBLIC_BASE_URL,
      },
    });

    logger.info("冷邮件通知已发送", {
      messageId: result.data?.id,
    });

    return { success: true };
  } catch (error) {
    logger.error("发送冷邮件通知时出错", {
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}
