import { randomUUID } from "node:crypto";
import { Card, CardText, type CardElement } from "chat";
import { cardToBlockKit, cardToFallbackText } from "@chat-adapter/slack";
import prisma from "@/utils/prisma";
import { withPrismaRetry } from "@/utils/prisma-retry";
import type { EmailProvider, EmailLabel } from "@/utils/email/types";
import { FOLLOW_UP_LABEL } from "@/utils/label";
import type { Logger } from "@/utils/logger";
import { captureException } from "@/utils/error";
import { Prisma } from "@/generated/prisma/client";
import { MessagingProvider } from "@/generated/prisma/enums";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";
import { disableSlackLinkUnfurls } from "@/utils/messaging/providers/slack/send";
import { getMessagingAdapterRegistry } from "@/utils/messaging/chat-sdk/adapters";
import {
  parseFollowUpNotificationDeliveries,
  type FollowUpNotificationDelivery,
} from "./notification-deliveries";

export async function getOrCreateFollowUpLabel(
  provider: EmailProvider,
  existingLabels?: EmailLabel[],
): Promise<{ id: string; name: string }> {
  const existingFromLabels = existingLabels?.find(
    (label) => label.name === FOLLOW_UP_LABEL,
  );
  if (existingFromLabels) {
    return { id: existingFromLabels.id, name: existingFromLabels.name };
  }

  const existingLabel = await provider.getLabelByName(FOLLOW_UP_LABEL);
  if (existingLabel) {
    return { id: existingLabel.id, name: existingLabel.name };
  }

  const createdLabel = await provider.createLabel(FOLLOW_UP_LABEL);
  return { id: createdLabel.id, name: createdLabel.name };
}

export async function applyFollowUpLabel({
  provider,
  threadId,
  messageId,
  labelId,
  logger,
}: {
  provider: EmailProvider;
  threadId: string;
  messageId: string;
  labelId?: string;
  logger: Logger;
}): Promise<void> {
  logger.info("正在应用跟进标签", { threadId, messageId });

  const finalLabelId = labelId ?? (await getOrCreateFollowUpLabel(provider)).id;

  await provider.labelMessage({
    messageId,
    labelId: finalLabelId,
    labelName: FOLLOW_UP_LABEL,
  });

  logger.info("已应用跟进标签", { threadId, labelId: finalLabelId });
}

export async function removeFollowUpLabel({
  provider,
  threadId,
  labelId,
  logger,
}: {
  provider: EmailProvider;
  threadId: string;
  labelId?: string;
  logger: Logger;
}): Promise<void> {
  logger.info("正在移除跟进标签", { threadId });

  let finalLabelId = labelId;
  if (!finalLabelId) {
    const label = await provider.getLabelByName(FOLLOW_UP_LABEL);
    if (!label) {
      logger.info("跟进标签不存在，无需移除", {
        threadId,
      });
      return;
    }
    finalLabelId = label.id;
  }

  try {
    await provider.removeThreadLabel(threadId, finalLabelId);
    logger.info("已移除跟进标签", { threadId, labelId: finalLabelId });
  } catch (error) {
    logger.warn("移除跟进标签失败（会话上可能不存在该标签）", {
      threadId,
      error,
    });
  }
}

export async function hasFollowUpLabel({
  provider,
  threadId,
  logger,
}: {
  provider: EmailProvider;
  threadId: string;
  logger: Logger;
}): Promise<boolean> {
  const label = await provider.getLabelByName(FOLLOW_UP_LABEL);
  if (!label) return false;

  try {
    const thread = await provider.getThread(threadId);
    const messages = thread.messages;
    if (!messages?.length) return false;

    return messages.some((message) => message.labelIds?.includes(label.id));
  } catch (error) {
    logger.warn("检查跟进标签失败", { threadId, error });
    return false;
  }
}

export async function clearFollowUpLabel({
  emailAccountId,
  threadId,
  triggerMessageId,
  provider,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  triggerMessageId?: string;
  provider: EmailProvider;
  logger: Logger;
}): Promise<void> {
  if (!threadId) return;

  try {
    // 不加已解决过滤条件：追踪项可能已被 handleOutboundReply 标记为解决
    // 尽管该函数在其之前运行，我们仍需要删除它们的草稿。
    const activeTrackers = await prisma.threadTracker.findMany({
      where: {
        emailAccountId,
        threadId,
        OR: [
          { followUpAppliedAt: { not: null } },
          { followUpDraftId: { not: null } },
          { followUpNotifications: { not: Prisma.AnyNull } },
        ],
      },
      select: {
        id: true,
        messageId: true,
        followUpAppliedAt: true,
        followUpDraftId: true,
        followUpNotifications: true,
        resolved: true,
      },
    });

    if (activeTrackers.length === 0) {
      logger.info("没有需要清除的有效跟进状态", { threadId });
      return;
    }

    const triggerMatchesFollowUpTracker = Boolean(
      triggerMessageId &&
        activeTrackers.some(
          (tracker) =>
            tracker.messageId === triggerMessageId && tracker.followUpAppliedAt,
        ),
    );

    logger.info("已加载跟进清理状态", {
      threadId,
      triggerMessageId,
      trackerCount: activeTrackers.length,
      unresolvedFollowUpTrackerCount: activeTrackers.filter(
        (tracker) => !tracker.resolved && tracker.followUpAppliedAt,
      ).length,
      draftTrackerCount: activeTrackers.filter(
        (tracker) => tracker.followUpDraftId,
      ).length,
      notificationTrackerCount: activeTrackers.filter(
        (tracker) => tracker.followUpNotifications,
      ).length,
      triggerMatchesFollowUpTracker,
    });

    if (triggerMatchesFollowUpTracker) {
      logger.info("跳过被追踪消息 webhook 的跟进清理", {
        threadId,
        messageId: triggerMessageId,
      });
      return;
    }

    const trackersWithDrafts = activeTrackers.filter(
      (tracker) => tracker.followUpDraftId !== null,
    );

    const deletedDraftTrackerIds: string[] = [];

    for (const tracker of trackersWithDrafts) {
      if (tracker.followUpDraftId) {
        try {
          await provider.deleteDraft(tracker.followUpDraftId);
          deletedDraftTrackerIds.push(tracker.id);
          logger.info("已删除跟进草稿", {
            trackerId: tracker.id,
          });
        } catch (error) {
          // 保留 followUpDraftId，以便回退清理可以重试
          logger.error("删除跟进草稿失败", {
            trackerId: tracker.id,
            error,
          });
        }
      }
    }

    if (deletedDraftTrackerIds.length > 0) {
      await withPrismaRetry(
        () =>
          prisma.threadTracker.updateMany({
            where: {
              id: { in: deletedDraftTrackerIds },
            },
            data: {
              followUpDraftId: null,
            },
          }),
        { logger },
      );
    }

    const activeFollowUpTrackerIds = activeTrackers
      .filter((tracker) => !tracker.resolved && tracker.followUpAppliedAt)
      .map((tracker) => tracker.id);

    if (activeFollowUpTrackerIds.length > 0) {
      logger.info("在保留台账的同时解析跟进追踪项", {
        threadId,
        trackerCount: activeFollowUpTrackerIds.length,
      });

      await withPrismaRetry(
        () =>
          prisma.threadTracker.updateMany({
            where: {
              id: { in: activeFollowUpTrackerIds },
            },
            data: {
              resolved: true,
            },
          }),
        { logger },
      );
    }

    // 无论追踪项状态如何，始终移除标签
    await removeFollowUpLabel({ provider, threadId, logger });
    await replaceFollowUpNotificationsWithReplyReceivedState({
      emailAccountId,
      threadId,
      logger,
    });

    logger.info("已清除跟进标签并清理追踪项", {
      threadId,
      draftsDeleted: deletedDraftTrackerIds.length,
      resolvedFollowUpTrackers: activeFollowUpTrackerIds.length,
    });
  } catch (error) {
    logger.error("清除跟进标签失败", { threadId, error });
    captureException(error, { emailAccountId });
  }
}

type FollowUpNotificationChannelForCleanup = {
  id: string;
  provider: MessagingProvider;
  isConnected: boolean;
  accessToken: string | null;
};

async function replaceFollowUpNotificationsWithReplyReceivedState({
  emailAccountId,
  threadId,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  logger: Logger;
}) {
  try {
    const trackers = await prisma.threadTracker.findMany({
      where: {
        emailAccountId,
        threadId,
        followUpNotifications: { not: Prisma.AnyNull },
      },
      select: {
        id: true,
        followUpNotifications: true,
      },
    });

    const claimId = randomUUID();
    const claimedAt = new Date();
    const claimedTrackers: {
      id: string;
      notifications: FollowUpNotificationDelivery[];
    }[] = [];

    for (const tracker of trackers) {
      const notifications = getClaimableFollowUpNotifications(
        tracker.followUpNotifications,
        claimedAt,
      );
      if (notifications.length === 0) continue;

      const claimed = await prisma.threadTracker.updateMany({
        where: {
          id: tracker.id,
          followUpNotifications: {
            equals: tracker.followUpNotifications as Prisma.InputJsonValue,
          },
        },
        data: {
          followUpNotifications: buildFollowUpNotificationCleanupClaim({
            claimId,
            claimedAt,
            notifications,
          }),
        },
      });

      if (claimed.count === 1) {
        claimedTrackers.push({ id: tracker.id, notifications });
      }
    }

    if (claimedTrackers.length === 0) {
      logger.info("跟进通知清理已被认领", {
        threadId,
      });
      return;
    }

    const notifications = claimedTrackers.flatMap(
      (tracker) => tracker.notifications,
    );
    const messagingChannelIds = [
      ...new Set(
        notifications.map((notification) => notification.messagingChannelId),
      ),
    ];
    const channels = await prisma.messagingChannel.findMany({
      where: {
        id: { in: messagingChannelIds },
        isConnected: true,
      },
      select: {
        id: true,
        provider: true,
        isConnected: true,
        accessToken: true,
      },
    });
    const channelsById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );

    const card = buildReplyReceivedFollowUpCard();
    const results = await Promise.all(
      notifications.map((notification) =>
        replaceFollowUpNotification({
          notification,
          channel: channelsById.get(notification.messagingChannelId),
          card,
          logger,
        }),
      ),
    );

    if (!results.every(Boolean)) return;

    await prisma.threadTracker.updateMany({
      where: {
        id: { in: claimedTrackers.map((tracker) => tracker.id) },
        followUpNotifications: {
          path: ["claimId"],
          equals: claimId,
        },
      },
      data: {
        followUpNotifications: Prisma.JsonNull,
      },
    });
  } catch (error) {
    logger.warn("回复后更新跟进通知失败", {
      threadId,
      error,
    });
  }
}

async function replaceFollowUpNotification({
  notification,
  channel,
  card,
  logger,
}: {
  notification: FollowUpNotificationDelivery;
  channel: FollowUpNotificationChannelForCleanup | undefined;
  card: CardElement;
  logger: Logger;
}): Promise<boolean> {
  if (!channel) return true;

  try {
    switch (notification.provider) {
      case MessagingProvider.SLACK: {
        if (!channel.accessToken) return true;

        await createSlackClient(channel.accessToken).chat.update(
          disableSlackLinkUnfurls({
            channel: notification.providerThreadId,
            ts: notification.providerMessageId,
            text: cardToFallbackText(card),
            blocks: cardToBlockKit(card),
          }),
        );
        break;
      }
      case MessagingProvider.TEAMS: {
        const teamsAdapter = getMessagingAdapterRegistry().typedAdapters.teams;
        if (!teamsAdapter) return true;

        await teamsAdapter.editMessage(
          notification.providerThreadId,
          notification.providerMessageId,
          REPLY_RECEIVED_TEXT,
        );
        break;
      }
      case MessagingProvider.TELEGRAM: {
        const telegramAdapter =
          getMessagingAdapterRegistry().typedAdapters.telegram;
        if (!telegramAdapter) return true;

        await telegramAdapter.editMessage(
          notification.providerThreadId,
          notification.providerMessageId,
          REPLY_RECEIVED_TEXT,
        );
        break;
      }
    }
    return true;
  } catch (error) {
    logger.warn("回复后更新跟进通知失败", {
      provider: notification.provider,
      error,
    });
    return false;
  }
}

const REPLY_RECEIVED_TEXT = "已收到回复。不再需要跟进。";
const FOLLOW_UP_NOTIFICATION_CLEANUP_CLAIM_TYPE =
  "reply-received-cleanup-claim";
const FOLLOW_UP_NOTIFICATION_CLEANUP_CLAIM_TTL_MS = 5 * 60 * 1000;

function buildReplyReceivedFollowUpCard() {
  return Card({
    title: "已收到回复",
    children: [CardText("不再需要跟进。")],
  });
}

function buildFollowUpNotificationCleanupClaim({
  claimId,
  claimedAt,
  notifications,
}: {
  claimId: string;
  claimedAt: Date;
  notifications: FollowUpNotificationDelivery[];
}): Prisma.InputJsonObject {
  return {
    type: FOLLOW_UP_NOTIFICATION_CLEANUP_CLAIM_TYPE,
    claimId,
    claimedAt: claimedAt.toISOString(),
    notifications,
  };
}

function getClaimableFollowUpNotifications(
  value: unknown,
  now: Date,
): FollowUpNotificationDelivery[] {
  const notifications = parseFollowUpNotificationDeliveries(value);
  if (notifications.length > 0) return notifications;

  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  const claim = value as {
    type?: unknown;
    claimedAt?: unknown;
    notifications?: unknown;
  };
  if (claim.type !== FOLLOW_UP_NOTIFICATION_CLEANUP_CLAIM_TYPE) return [];
  if (typeof claim.claimedAt !== "string") return [];

  const claimedAt = new Date(claim.claimedAt).getTime();
  if (!Number.isFinite(claimedAt)) return [];
  if (now.getTime() - claimedAt < FOLLOW_UP_NOTIFICATION_CLEANUP_CLAIM_TTL_MS) {
    return [];
  }

  return parseFollowUpNotificationDeliveries(claim.notifications);
}
