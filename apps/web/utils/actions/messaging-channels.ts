"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  updateSlackRouteBody,
  updateMessagingFeatureRouteBody,
  updateMeetingBriefsEmailDeliveryBody,
  updateDigestEmailDeliveryBody,
  disconnectChannelBody,
  linkSlackWorkspaceBody,
  createMessagingLinkCodeBody,
  toggleRuleChannelBody,
} from "@/utils/actions/messaging-channels.validation";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { RULE_MANAGED_BY_ORGANIZATION_ERROR } from "@/utils/organizations/rules";
import { isNotFoundError } from "@/utils/prisma-helpers";
import {
  ActionType,
  MessagingProvider,
  MessagingRoutePurpose,
  type MessagingRouteTargetType,
} from "@/generated/prisma/enums";
import { generateMessagingLinkCode } from "@/utils/messaging/chat-sdk/link-code";
import {
  DRAFT_REPLY_ACTION_TYPES,
  MESSAGING_CHANNEL_ACTION_TYPES,
} from "@/utils/actions/draft-reply";
import { env } from "@/env";
import {
  getMessagingChannelReconnectMessage,
  isOperationalSlackChannel,
  isMessagingChannelOperational,
} from "@/utils/messaging/channel-validity";
import {
  getMessagingRoute,
  hasMessagingRoute,
  type MessagingFeatureRoutePurpose,
} from "@/utils/messaging/routes";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";
import { upsertSlackRoute } from "@/utils/messaging/slack-routes";
import { sendSlackOnboardingDirectMessageWithLogging } from "@/utils/messaging/providers/slack/send-onboarding-direct-message";
import { lookupSlackUserByEmail } from "@/utils/messaging/providers/slack/users";
import { callTelegramBotApi } from "@/utils/messaging/providers/telegram/api";
import { isTeamsBotConfigured } from "@/utils/messaging/chat-sdk/teams-config";
import { assertCanUseDigests } from "@/utils/premium/server";

export const updateSlackRouteAction = actionClient
  .metadata({ name: "updateSlackRoute" })
  .inputSchema(updateSlackRouteBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { channelId, purpose, targetId },
    }) => {
      const where = {
        id_emailAccountId: { id: channelId, emailAccountId },
      };

      const channel = await prisma.messagingChannel.findUnique({
        where,
        select: {
          id: true,
          provider: true,
          isConnected: true,
          accessToken: true,
          providerUserId: true,
          botUserId: true,
        },
      });

      if (!channel) {
        throw new SafeError("未找到消息渠道");
      }

      if (channel.provider !== MessagingProvider.SLACK) {
        throw new SafeError("消息渠道不是 Slack");
      }

      if (!isOperationalSlackChannel(channel)) {
        throw new SafeError(
          getMessagingChannelReconnectMessage(channel.provider),
        );
      }

      await upsertSlackRoute({
        messagingChannelId: channelId,
        purpose,
        targetId,
        accessToken: channel.accessToken,
        providerUserId: channel.providerUserId,
        botUserId: channel.botUserId,
        logger,
      });
    },
  );

export const updateMessagingFeatureRouteAction = actionClient
  .metadata({ name: "updateMessagingFeatureRoute" })
  .inputSchema(updateMessagingFeatureRouteBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { channelId, purpose, enabled },
    }) => {
      if (enabled && purpose === MessagingRoutePurpose.DIGESTS) {
        await assertCanUseDigests(userId);
      }

      const where = {
        id_emailAccountId: { id: channelId, emailAccountId },
      };

      const channel = await prisma.messagingChannel.findUnique({
        where,
        select: {
          id: true,
          provider: true,
          isConnected: true,
          accessToken: true,
          providerUserId: true,
          routes: {
            select: {
              purpose: true,
              targetType: true,
              targetId: true,
            },
          },
        },
      });

      if (!channel) {
        throw new SafeError("未找到消息渠道");
      }

      if (!isMessagingChannelOperational(channel)) {
        throw new SafeError(
          getMessagingChannelReconnectMessage(channel.provider),
        );
      }

      await syncMessagingFeatureRoute({
        messagingChannelId: channel.id,
        routes: channel.routes,
        purpose,
        enabled,
      });
    },
  );

export const updateMeetingBriefsEmailDeliveryAction = actionClient
  .metadata({ name: "updateMeetingBriefsEmailDelivery" })
  .inputSchema(updateMeetingBriefsEmailDeliveryBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { sendEmail } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { meetingBriefsSendEmail: sendEmail },
    });
  });

export const updateDigestEmailDeliveryAction = actionClient
  .metadata({ name: "updateDigestEmailDelivery" })
  .inputSchema(updateDigestEmailDeliveryBody)
  .action(
    async ({ ctx: { emailAccountId, userId }, parsedInput: { sendEmail } }) => {
      if (sendEmail) {
        await assertCanUseDigests(userId);
      }

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { digestSendEmail: sendEmail },
      });
    },
  );

export const disconnectChannelAction = actionClient
  .metadata({ name: "disconnectChannel" })
  .inputSchema(disconnectChannelBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { channelId } }) => {
    try {
      await prisma.messagingChannel.update({
        where: {
          id_emailAccountId: {
            id: channelId,
            emailAccountId,
          },
        },
        data: {
          isConnected: false,
          routes: {
            deleteMany: {},
          },
        },
      });
    } catch (error) {
      if (isNotFoundError(error)) throw new SafeError("未找到消息渠道");
      throw error;
    }
  });

export const linkSlackWorkspaceAction = actionClient
  .metadata({ name: "linkSlackWorkspace" })
  .inputSchema(linkSlackWorkspaceBody)
  .action(
    async ({
      ctx: { emailAccountId, emailAccount, logger },
      parsedInput: { teamId },
    }) => {
      const existing = await prisma.messagingChannel.findUnique({
        where: {
          emailAccountId_provider_teamId: {
            emailAccountId,
            provider: MessagingProvider.SLACK,
            teamId,
          },
        },
      });
      if (existing?.isConnected) {
        throw new SafeError("工作区已连接");
      }

      const orgMateChannel = await prisma.messagingChannel.findFirst({
        where: {
          provider: MessagingProvider.SLACK,
          teamId,
          isConnected: true,
          accessToken: { not: null },
          NOT: { emailAccountId },
          emailAccount: {
            members: {
              some: {
                organization: {
                  members: { some: { emailAccountId } },
                },
              },
            },
          },
        },
        select: {
          accessToken: true,
          botUserId: true,
          teamName: true,
        },
      });

      if (!orgMateChannel?.accessToken) {
        throw new SafeError("在你的组织中未找到已连接的工作区");
      }

      const client = createSlackClient(orgMateChannel.accessToken);
      const slackUser = await lookupSlackUserByEmail(
        client,
        emailAccount.email,
      );

      if (!slackUser) {
        throw new SafeError(
          "找不到你的 Slack 账号。你的 Inbox Zero 邮箱可能与 Slack 个人资料邮箱不一致。",
        );
      }

      await prisma.messagingChannel.upsert({
        where: {
          emailAccountId_provider_teamId: {
            emailAccountId,
            provider: MessagingProvider.SLACK,
            teamId,
          },
        },
        update: {
          teamName: orgMateChannel.teamName,
          accessToken: orgMateChannel.accessToken,
          providerUserId: slackUser.id,
          botUserId: orgMateChannel.botUserId,
          isConnected: true,
        },
        create: {
          provider: MessagingProvider.SLACK,
          teamId,
          teamName: orgMateChannel.teamName,
          accessToken: orgMateChannel.accessToken,
          providerUserId: slackUser.id,
          botUserId: orgMateChannel.botUserId,
          emailAccountId,
          isConnected: true,
        },
      });

      await sendSlackOnboardingDirectMessageWithLogging({
        accessToken: orgMateChannel.accessToken,
        userId: slackUser.id,
        botUserId: orgMateChannel.botUserId,
        teamId,
        logger,
      });

      logger.info("已通过组织同事令牌关联 Slack 工作区", { teamId });
    },
  );

export const createMessagingLinkCodeAction = actionClient
  .metadata({ name: "createMessagingLinkCode" })
  .inputSchema(createMessagingLinkCodeBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { provider } }) => {
    if (provider === "TEAMS") {
      if (!isTeamsBotConfigured()) {
        throw new SafeError("未配置 Teams 集成");
      }
    } else if (!env.TELEGRAM_BOT_TOKEN) {
      throw new SafeError("未配置 Telegram 集成");
    }

    const code = generateMessagingLinkCode({
      emailAccountId,
      provider,
    });
    const botUrl =
      provider === "TELEGRAM" ? await getTelegramBotUrl() : getTeamsBotUrl();

    return {
      code,
      provider,
      expiresInSeconds: 10 * 60,
      ...(botUrl ? { botUrl } : {}),
    };
  });

export const toggleRuleChannelAction = actionClient
  .metadata({ name: "toggleRuleChannel" })
  .inputSchema(toggleRuleChannelBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: {
        ruleId,
        messagingChannelId,
        enabled,
        actionType: requestedType,
      },
    }) => {
      const [rule, channel] = await Promise.all([
        prisma.rule.findUnique({
          where: {
            id_emailAccountId: {
              id: ruleId,
              emailAccountId,
            },
          },
          select: {
            organizationRuleId: true,
            actions: {
              where: { type: { in: [...DRAFT_REPLY_ACTION_TYPES] } },
              select: { id: true },
              take: 1,
            },
          },
        }),
        prisma.messagingChannel.findUnique({
          where: {
            id_emailAccountId: {
              id: messagingChannelId,
              emailAccountId,
            },
          },
          select: {
            isConnected: true,
            provider: true,
            accessToken: true,
            providerUserId: true,
            routes: {
              select: {
                purpose: true,
                targetType: true,
                targetId: true,
              },
            },
          },
        }),
      ]);

      if (!rule) {
        throw new SafeError("未找到规则");
      }
      if (rule.organizationRuleId) {
        throw new SafeError(RULE_MANAGED_BY_ORGANIZATION_ERROR);
      }
      if (!channel) {
        throw new SafeError("未找到消息渠道");
      }

      let actionType: ActionType =
        requestedType ?? ActionType.NOTIFY_MESSAGING_CHANNEL;
      const hasDraftReplyAction = (rule.actions?.length ?? 0) > 0;
      if (
        actionType === ActionType.DRAFT_MESSAGING_CHANNEL &&
        !hasDraftReplyAction
      ) {
        actionType = ActionType.NOTIFY_MESSAGING_CHANNEL;
      }

      if (enabled) {
        if (!isMessagingChannelOperational(channel)) {
          throw new SafeError(
            getMessagingChannelReconnectMessage(channel.provider),
          );
        }
        if (
          !hasMessagingRoute(
            channel.routes,
            MessagingRoutePurpose.RULE_NOTIFICATIONS,
          )
        ) {
          throw new SafeError("启用通知前请先选择目标渠道");
        }

        await prisma.action.deleteMany({
          where: {
            ruleId,
            messagingChannelId,
            type: { in: [...MESSAGING_CHANNEL_ACTION_TYPES] },
          },
        });

        await prisma.action.create({
          data: {
            type: actionType,
            ruleId,
            messagingChannelId,
            emailAccountId,
            messagingChannelEmailAccountId: emailAccountId,
          },
        });
      } else {
        await prisma.action.deleteMany({
          where: {
            ruleId,
            messagingChannelId,
            type: { in: [...MESSAGING_CHANNEL_ACTION_TYPES] },
          },
        });
      }
    },
  );

async function getTelegramBotUrl() {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  try {
    const result = await callTelegramBotApi<{ username?: string }>({
      botToken: env.TELEGRAM_BOT_TOKEN,
      apiMethod: "getMe",
      requestMethod: "GET",
    });

    const username = result.username?.trim().replace(/^@+/, "");
    if (!username) return;

    return `https://t.me/${username}`;
  } catch {
    return;
  }
}

function getTeamsBotUrl() {
  if (!env.TEAMS_BOT_APP_ID) return;

  const url = new URL(
    `https://teams.microsoft.com/l/app/${env.TEAMS_BOT_APP_ID}`,
  );

  if (env.TEAMS_BOT_APP_TENANT_ID) {
    url.searchParams.set("tenantId", env.TEAMS_BOT_APP_TENANT_ID);
  }

  return url.toString();
}

async function syncMessagingFeatureRoute({
  messagingChannelId,
  routes,
  purpose,
  enabled,
}: {
  messagingChannelId: string;
  routes: Array<{
    purpose: MessagingRoutePurpose;
    targetType: MessagingRouteTargetType;
    targetId: string;
  }>;
  purpose: MessagingFeatureRoutePurpose;
  enabled: boolean;
}) {
  if (!enabled) {
    await prisma.messagingRoute.deleteMany({
      where: {
        messagingChannelId,
        purpose,
      },
    });
    return;
  }

  const featureRoute = getMessagingRoute(routes, purpose);
  if (featureRoute) return;

  const rulesRoute = getMessagingRoute(
    routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  if (!rulesRoute) {
    throw new SafeError("启用功能前请先选择目标渠道");
  }

  await prisma.messagingRoute.create({
    data: {
      messagingChannelId,
      purpose,
      targetType: rulesRoute.targetType,
      targetId: rulesRoute.targetId,
    },
  });
}
