import { MessagingProvider } from "@/generated/prisma/enums";

type MessagingChannelConnectionLike = {
  provider: MessagingProvider;
  isConnected?: boolean;
  accessToken?: string | null;
  providerUserId?: string | null;
};

type MessagingChannelWithRequiredFields =
  | (MessagingChannelConnectionLike & {
      provider: "SLACK";
      accessToken: string;
      providerUserId: string;
    })
  | (MessagingChannelConnectionLike & {
      provider: "TEAMS";
      providerUserId: string;
    })
  | (MessagingChannelConnectionLike & {
      provider: "TELEGRAM";
    });

type OperationalMessagingChannel = MessagingChannelWithRequiredFields & {
  isConnected: true;
};

export function hasRequiredMessagingConnectionFields(
  channel: MessagingChannelConnectionLike,
): channel is MessagingChannelWithRequiredFields {
  switch (channel.provider) {
    case MessagingProvider.SLACK:
      return Boolean(channel.accessToken && channel.providerUserId);
    case MessagingProvider.TEAMS:
      return Boolean(channel.providerUserId);
    case MessagingProvider.TELEGRAM:
      return true;
    default:
      return true;
  }
}

export function isMessagingChannelOperational(
  channel: MessagingChannelConnectionLike,
): channel is OperationalMessagingChannel {
  return (
    Boolean(channel.isConnected) &&
    hasRequiredMessagingConnectionFields(channel)
  );
}

export function isOperationalSlackChannel(
  channel: MessagingChannelConnectionLike,
): channel is Extract<OperationalMessagingChannel, { provider: "SLACK" }> {
  return (
    channel.provider === MessagingProvider.SLACK &&
    isMessagingChannelOperational(channel)
  );
}

export function isOperationalTeamsChannel(
  channel: MessagingChannelConnectionLike,
): channel is Extract<OperationalMessagingChannel, { provider: "TEAMS" }> {
  return (
    channel.provider === MessagingProvider.TEAMS &&
    isMessagingChannelOperational(channel)
  );
}

export function getMessagingChannelReconnectMessage(
  provider: MessagingProvider,
) {
  if (provider === MessagingProvider.SLACK) {
    return "请先重新连接 Slack，再配置通知。";
  }

  if (provider === MessagingProvider.TEAMS) {
    return "请先重新连接 Teams，再配置通知。";
  }

  return "请先重新连接消息推送服务商，再配置通知。";
}
