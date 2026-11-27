import { env } from "@/env";
import { createEmailProvider } from "@/utils/email/provider";
import type { Logger } from "@/utils/logger";

export async function sendNotificationEmail({
  emailAccountId,
  userEmail,
  provider,
  subject,
  sendViaResend,
  renderHtml,
  logger,
}: {
  emailAccountId: string;
  userEmail: string;
  provider: string;
  subject: string;
  sendViaResend: () => Promise<unknown>;
  renderHtml: () => Promise<string>;
  logger: Logger;
}): Promise<void> {
  if (env.RESEND_API_KEY) {
    try {
      await sendViaResend();
      logger.info("已通过 Resend 发送通知邮件");
      return;
    } catch (error) {
      logger.error("通过 Resend 发送通知邮件失败，回退为自发自收", { error });
    }
  }

  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider,
    logger,
  });

  await emailProvider.sendEmailWithHtml({
    to: userEmail,
    subject,
    messageHtml: await renderHtml(),
  });

  logger.info("已通过用户自己的邮箱发送通知邮件");
}
