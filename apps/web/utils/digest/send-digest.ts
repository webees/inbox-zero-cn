import { env } from "@/env";
import { sendDigestEmail } from "@inboxzero/transactional-email";
import {
  MessagingProvider,
  MessagingRoutePurpose,
  type MessagingRouteTargetType,
} from "@/generated/prisma/enums";
import { sendAutomationMessage } from "@/utils/automation-jobs/messaging";
import {
  DIGEST_MAX_ITEMS_PER_RULE,
  formatDigestDate,
} from "@/utils/digest/format";
import type { Logger } from "@/utils/logger";
import {
  resolveSlackRouteDestination,
  sendDigestToSlack,
} from "@/utils/messaging/providers/slack/send";
import {
  getMessagingRoute,
  getMessagingRouteWhere,
} from "@/utils/messaging/routes";
import { isMessagingChannelOperational } from "@/utils/messaging/channel-validity";
import prisma from "@/utils/prisma";

type DigestItem = { from: string; subject: string; content: string };
type ItemsByRule = Record<string, DigestItem[] | undefined>;

export async function sendDigest({
  emailAccountId,
  userEmail,
  unsubscribeToken,
  date,
  ruleNames,
  itemsByRule,
  logger,
}: {
  emailAccountId: string;
  userEmail: string;
  unsubscribeToken: string;
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: ItemsByRule;
  logger: Logger;
}): Promise<void> {
  logger = logger.with({ emailAccountId, userEmail });

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { digestSendEmail: true },
  });

  const sendEmail = emailAccount?.digestSendEmail ?? true;

  const channels = await prisma.messagingChannel.findMany({
    where: {
      emailAccountId,
      isConnected: true,
      ...getMessagingRouteWhere(MessagingRoutePurpose.DIGESTS),
    },
    select: {
      id: true,
      provider: true,
      isConnected: true,
      accessToken: true,
      teamId: true,
      providerUserId: true,
      routes: {
        select: { purpose: true, targetType: true, targetId: true },
      },
    },
  });

  const deliveryPromises: Promise<void>[] = [];

  if (sendEmail) {
    deliveryPromises.push(
      sendDigestViaEmail({
        emailAccountId,
        userEmail,
        unsubscribeToken,
        date,
        ruleNames,
        itemsByRule,
        logger,
      }),
    );
  }

  for (const channel of channels) {
    const route = getMessagingRoute(
      channel.routes,
      MessagingRoutePurpose.DIGESTS,
    );
    if (!route) continue;
    if (!isMessagingChannelOperational(channel)) {
      logger.warn("消息渠道无效，跳过邮件摘要投递", {
        messagingChannelId: channel.id,
        provider: channel.provider,
      });
      continue;
    }

    switch (channel.provider) {
      case MessagingProvider.SLACK:
        if (!channel.accessToken) continue;
        deliveryPromises.push(
          sendDigestViaSlack({
            accessToken: channel.accessToken,
            route,
            date,
            ruleNames,
            itemsByRule,
            logger,
          }),
        );
        break;
      case MessagingProvider.TEAMS:
      case MessagingProvider.TELEGRAM:
        deliveryPromises.push(
          sendDigestViaMessagingApp({
            channel,
            route,
            date,
            ruleNames,
            itemsByRule,
            logger,
          }),
        );
        break;
    }
  }

  if (deliveryPromises.length === 0) {
    if (channels.length > 0) {
      // 邮件已关闭，且每个已配置的消息渠道都被跳过
      //（不可用或缺少凭据）。抛出异常，以便调用方
      // 不会将邮件摘要标记为已发送并对其条目进行脱敏。
      throw new Error(
        "没有可投递的邮件摘要渠道：邮件投递已禁用，且所有已配置的消息渠道都不可用",
      );
    }
    logger.info("未配置投递渠道，跳过邮件摘要");
    return;
  }

  const results = await Promise.allSettled(deliveryPromises);
  const failures = results.filter((r) => r.status === "rejected");

  if (failures.length > 0) {
    for (const failure of failures) {
      logger.error("邮件摘要投递渠道失败", {
        reason: (failure as PromiseRejectedResult).reason,
      });
    }

    if (failures.length === results.length) {
      throw new Error("所有邮件摘要投递渠道都失败了");
    }
  }
}

async function sendDigestViaEmail({
  emailAccountId,
  userEmail,
  unsubscribeToken,
  date,
  ruleNames,
  itemsByRule,
  logger,
}: {
  emailAccountId: string;
  userEmail: string;
  unsubscribeToken: string;
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: ItemsByRule;
  logger: Logger;
}) {
  logger.info("正在通过邮件发送邮件摘要");
  await sendDigestEmail({
    from: env.RESEND_FROM_EMAIL,
    to: userEmail,
    emailProps: {
      baseUrl: env.NEXT_PUBLIC_BASE_URL,
      unsubscribeToken,
      date,
      ruleNames,
      ...itemsByRule,
      emailAccountId,
    },
  });
  logger.info("邮件摘要已发送");
}

async function sendDigestViaSlack({
  accessToken,
  route,
  date,
  ruleNames,
  itemsByRule,
  logger,
}: {
  accessToken: string;
  route: { targetId: string; targetType: MessagingRouteTargetType };
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: ItemsByRule;
  logger: Logger;
}) {
  const destination = await resolveSlackRouteDestination({
    accessToken,
    route,
  });

  if (!destination) {
    // 抛出异常，使其在 Promise.allSettled 中被计为渠道失败；
    // 否则仅通过 Slack 的邮件摘要可能在尚未实际发送的情况下就被标记为已发送。
    // delivering.
    throw new Error("未解析到邮件摘要的 Slack 目标");
  }

  logger.info("正在向 Slack 发送邮件摘要");
  await sendDigestToSlack({
    accessToken,
    channelId: destination,
    date,
    ruleNames,
    itemsByRule,
  });
  logger.info("邮件摘要已发送到 Slack");
}

async function sendDigestViaMessagingApp({
  channel,
  route,
  date,
  ruleNames,
  itemsByRule,
  logger,
}: {
  channel: {
    provider: MessagingProvider;
    accessToken: string | null;
    teamId: string | null;
    providerUserId: string | null;
  };
  route: { targetId: string; targetType: MessagingRouteTargetType };
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: ItemsByRule;
  logger: Logger;
}) {
  logger.info("正在向消息应用发送邮件摘要", {
    provider: channel.provider,
  });

  await sendAutomationMessage({
    channel,
    route,
    text: formatDigestText({ date, ruleNames, itemsByRule }),
    logger,
  });

  logger.info("邮件摘要已发送到消息应用", { provider: channel.provider });
}

function formatDigestText({
  date,
  ruleNames,
  itemsByRule,
}: {
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: ItemsByRule;
}): string {
  const sections: string[] = [
    `📋 你的 Inbox Zero 邮件摘要 — ${formatDigestDate(date)}`,
  ];

  for (const [ruleKey, items] of Object.entries(itemsByRule)) {
    if (!items?.length) continue;
    const displayName = ruleNames[ruleKey] ?? ruleKey;
    const visible = items.slice(0, DIGEST_MAX_ITEMS_PER_RULE);
    const overflow = items.length - visible.length;

    const lines = visible.map((item) => `- ${item.from} — ${item.subject}`);

    if (overflow > 0) lines.push(`+ 还有 ${overflow} 条`);

    sections.push(`${displayName} (${items.length})\n${lines.join("\n")}`);
  }

  sections.push("由 Inbox Zero 生成");
  return sections.join("\n\n");
}
