import "server-only";
import { MobilePushTokenType } from "@/generated/prisma/enums";
import { isApnsConfigured, deliverApnsNotifications } from "@/utils/apns";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { publishLocalMailHint } from "@/utils/redis/local-mail-hints";
import { redis } from "@/utils/redis";

const MAILBOX_PUSH_COOLDOWN_SECONDS = 20;

export async function notifyMailboxChanged({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}) {
  try {
    await publishLocalMailHint(emailAccountId, logger);
    await sendMailboxPushes({ emailAccountId, logger });
  } catch (error) {
    logger.warn("通知原生邮箱客户端失败", { error });
  }
}

async function sendMailboxPushes({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}) {
  if (!isApnsConfigured()) return;

  const acquired = await reserveMailboxPush(emailAccountId, logger);
  if (!acquired) return;

  const account = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      user: {
        select: {
          mobilePushTokens: {
            where: { tokenType: MobilePushTokenType.APNS },
            select: { token: true },
          },
        },
      },
    },
  });
  const tokens = account?.user.mobilePushTokens.map((device) => device.token);
  if (!tokens || tokens.length === 0) return;

  const { unregisteredTokens } = await deliverApnsNotifications({
    tokens,
    notification: {
      pushType: "background",
      data: { emailAccountId, hint: "mailbox" },
    },
    logger,
  });

  const rejectedTokens = [...new Set(unregisteredTokens)];
  if (rejectedTokens.length === 0) return;
  await prisma.mobilePushToken.deleteMany({
    where: { token: { in: rejectedTokens } },
  });
  logger.info("已清理被拒绝的邮箱推送令牌", {
    count: rejectedTokens.length,
  });
}

async function reserveMailboxPush(emailAccountId: string, logger: Logger) {
  try {
    const acquired = await redis.set(
      `mailbox-push-cooldown:${emailAccountId}`,
      "1",
      { nx: true, ex: MAILBOX_PUSH_COOLDOWN_SECONDS },
    );
    return Boolean(acquired);
  } catch (error) {
    logger.warn("邮箱推送冷却检查失败", { error });
    return true;
  }
}
