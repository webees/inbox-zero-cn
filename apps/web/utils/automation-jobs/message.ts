import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import {
  aiGenerateAutomationCheckInMessage,
  type AutomationCheckInEmailAccount,
} from "@/utils/ai/automation-jobs/generate-check-in-message";

export async function getAutomationJobMessage({
  prompt,
  emailProvider,
  emailAccount,
  logger,
}: {
  prompt: string | null;
  emailProvider: EmailProvider;
  emailAccount: AutomationCheckInEmailAccount;
  logger: Logger;
}) {
  const trimmedPrompt = prompt?.trim();
  if (trimmedPrompt) {
    try {
      return await aiGenerateAutomationCheckInMessage({
        prompt: trimmedPrompt,
        emailProvider,
        emailAccount,
        logger,
      });
    } catch (error) {
      logger.warn("无法根据提示词生成自动化消息", {
        error,
      });
      return trimmedPrompt;
    }
  }

  try {
    const stats = await emailProvider.getInboxStats();

    if (stats.unread === 0) {
      return "你的收件箱现在看起来很清爽。需要我继续监控并在稍后再提醒你吗？";
    }

    return `你目前有 ${stats.unread} 封未读邮件。现在要处理它们吗？`;
  } catch (error) {
    logger.warn("无法读取收件箱统计以生成自动化消息", {
      error,
    });

    return "我看了一眼你的收件箱。现在要分类处理邮件吗？";
  }
}
