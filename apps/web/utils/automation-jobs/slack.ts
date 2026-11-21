import {
  MessagingProvider,
  MessagingRouteTargetType,
} from "@/generated/prisma/enums";
import type { Logger } from "@/utils/logger";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";
import {
  disableSlackLinkUnfurls,
  formatSlackAppMention,
  resolveSlackRouteDestination,
} from "@/utils/messaging/providers/slack/send";
import type { AutomationMessagingChannel } from "./messaging-channel";

type SlackMessagingChannel = Pick<
  AutomationMessagingChannel,
  "provider" | "accessToken" | "botUserId"
>;

export class AutomationJobConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationJobConfigurationError";
  }
}

export async function sendAutomationMessageToSlack({
  channel,
  route,
  text,
  logger,
}: {
  channel: SlackMessagingChannel;
  route?: {
    targetId: string;
    targetType: MessagingRouteTargetType;
  } | null;
  text: string;
  logger: Logger;
}) {
  const slackLogger = logger.with({
    component: "sendAutomationMessageToSlack",
    destination: route?.targetId ?? null,
  });

  if (channel.provider !== MessagingProvider.SLACK) {
    const error = new AutomationJobConfigurationError("仅支持 Slack 消息频道");
    slackLogger.error("自动化任务不支持该消息服务商", {
      provider: channel.provider,
      error,
    });
    throw error;
  }

  if (!channel.accessToken) {
    const error = new AutomationJobConfigurationError(
      "消息频道缺少 Slack 访问令牌",
    );
    slackLogger.error("Slack 频道缺少访问令牌", { error });
    throw error;
  }

  const client = createSlackClient(channel.accessToken);
  const formattedText =
    route?.targetType === MessagingRouteTargetType.DIRECT_MESSAGE
      ? text
      : `${text}\n\n_回复 ${formatSlackAppMention(channel.botUserId)} 即可聊聊你的邮件。_`;

  slackLogger.info("正在发送 Slack 自动化消息");

  const destinationChannelId = await resolveSlackRouteDestination({
    accessToken: channel.accessToken,
    route,
  });

  if (!destinationChannelId) {
    const error = new AutomationJobConfigurationError(
      "自动化任务没有可用的 Slack 目标",
    );
    slackLogger.error("自动化任务没有可用的 Slack 目标", {
      hasRoute: Boolean(route),
      error,
    });
    throw error;
  }

  try {
    const response = await client.chat.postMessage(
      disableSlackLinkUnfurls({
        channel: destinationChannelId,
        text: formattedText,
      }),
    );
    slackLogger.info("Slack 自动化消息已发送");

    return {
      channelId: destinationChannelId,
      messageId: response.ts ?? null,
    };
  } catch (error) {
    if (isSlackError(error) && error.data?.error === "not_in_channel") {
      if (!route || route.targetType !== MessagingRouteTargetType.CHANNEL) {
        slackLogger.error("Slack 目标不是可加入的频道", {
          slackError: error.data?.error,
          error,
        });
        throw error;
      }

      slackLogger.info("重试消息前先加入 Slack 频道");
      await client.conversations.join({ channel: route.targetId });
      const response = await client.chat.postMessage(
        disableSlackLinkUnfurls({
          channel: route.targetId,
          text: formattedText,
        }),
      );
      slackLogger.info("加入频道后 Slack 自动化消息已发送");

      return {
        channelId: route.targetId,
        messageId: response.ts ?? null,
      };
    }

    slackLogger.error("发送 Slack 自动化消息失败", {
      error,
      slackError: isSlackError(error) ? error.data?.error : null,
    });
    throw error;
  }
}

function isSlackError(
  error: unknown,
): error is Error & { data?: { error?: string } } {
  return error instanceof Error && "data" in error;
}
