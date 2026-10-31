import { sendConnectionOnboardingDirectMessage } from "./send";
import type { Logger } from "@/utils/logger";

export async function sendSlackOnboardingDirectMessageWithLogging({
  accessToken,
  userId,
  botUserId,
  teamId,
  logger,
}: {
  accessToken: string;
  userId: string;
  botUserId?: string | null;
  teamId: string;
  logger: Logger;
}): Promise<void> {
  try {
    await sendConnectionOnboardingDirectMessage({
      accessToken,
      userId,
      botUserId,
    });
  } catch (error) {
    logger.warn("发送 Slack 引导流程私信失败", {
      teamId,
      userId,
      error,
    });
  }
}
