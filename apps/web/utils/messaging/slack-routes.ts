import { SafeError } from "@/utils/error";
import {
  MessagingRoutePurpose,
  MessagingRouteTargetType,
} from "@/generated/prisma/enums";
import prisma from "@/utils/prisma";
import {
  getChannelInfo,
  listPrivateChannelsForUser,
} from "./providers/slack/channels";
import { createSlackClient } from "./providers/slack/client";
import { sendChannelConfirmation } from "./providers/slack/send";
import type { Logger } from "@/utils/logger";

export async function upsertSlackRoute({
  messagingChannelId,
  purpose,
  targetId,
  accessToken,
  providerUserId,
  botUserId,
  logger,
}: {
  messagingChannelId: string;
  purpose: MessagingRoutePurpose;
  targetId: string;
  accessToken: string;
  providerUserId: string | null;
  botUserId: string | null;
  logger: Logger;
}) {
  const target = await resolveSlackRouteTarget({
    accessToken,
    providerUserId,
    targetId,
    logger,
  });

  await prisma.messagingRoute.upsert({
    where: {
      messagingChannelId_purpose: {
        messagingChannelId,
        purpose,
      },
    },
    update: target,
    create: {
      messagingChannelId,
      purpose,
      ...target,
    },
  });

  if (
    (purpose === MessagingRoutePurpose.RULE_NOTIFICATIONS ||
      purpose === MessagingRoutePurpose.SCHEDULED_CHECK_INS) &&
    target.targetType === MessagingRouteTargetType.CHANNEL
  ) {
    try {
      await sendChannelConfirmation({
        accessToken,
        channelId: target.targetId,
        botUserId,
      });
    } catch (error) {
      logger.error("发送渠道确认消息失败", { error });
    }
  }
}

export async function resolveSlackRouteTarget({
  accessToken,
  providerUserId,
  targetId,
  logger,
}: {
  accessToken: string;
  providerUserId: string | null;
  targetId: string;
  logger: Logger;
}) {
  if (targetId === "dm") {
    logger.trace("正在解析 Slack 私信目标", {
      hasProviderUserId: Boolean(providerUserId),
    });

    if (!providerUserId) {
      logger.error("Slack 私信目标不可用");
      throw new SafeError("此渠道不支持私信");
    }

    return {
      targetType: MessagingRouteTargetType.DIRECT_MESSAGE,
      targetId: providerUserId,
    };
  }

  const client = createSlackClient(accessToken);
  logger.trace("正在解析 Slack 渠道目标", { targetId });

  let channelInfo: Awaited<ReturnType<typeof getChannelInfo>> = null;
  try {
    channelInfo = await getChannelInfo(client, targetId);
  } catch (error) {
    logger.error("解析 Slack 渠道目标失败", { error, targetId });
    throw error;
  }

  if (!channelInfo) {
    logger.error("未找到 Slack 渠道目标", { targetId });
    throw new SafeError("找不到所选的 Slack 渠道");
  }

  if (!channelInfo.isPrivate) {
    logger.error("Slack 渠道目标不是私密渠道", { targetId });
    throw new SafeError("只允许使用私密渠道。请选择一个私密渠道。");
  }

  if (!providerUserId) {
    logger.error("缺少用户 ID，无法验证 Slack 渠道目标", {
      targetId,
    });
    throw new SafeError("请先重新连接 Slack，再选择私密渠道。");
  }

  const availablePrivateChannels = await listPrivateChannelsForUser(
    client,
    providerUserId,
  );
  const isAvailableToUser = availablePrivateChannels.some(
    (channel) => channel.id === targetId,
  );

  if (!isAvailableToUser) {
    logger.error("该用户无法访问此 Slack 渠道目标", {
      targetId,
    });
    throw new SafeError(
      "只允许使用你已加入的私密渠道。请选择你自己的某个私密渠道。",
    );
  }

  return {
    targetType: MessagingRouteTargetType.CHANNEL,
    targetId,
  };
}
