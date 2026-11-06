import type { KnownBlock, Block } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { MessagingRouteTargetType } from "@/generated/prisma/enums";
import { createSlackClient } from "./client";
import {
  buildMeetingBriefingBlocks,
  type MeetingBriefingBlocksParams,
} from "./messages/meeting-briefing";
import {
  buildDocumentFiledBlocks,
  buildDocumentAskBlocks,
  type DocumentFiledBlocksParams,
  type DocumentAskBlocksParams,
} from "./messages/document-filing";
import { buildDigestBlocks, type DigestBlocksParams } from "./messages/digest";
import {
  buildFollowUpReminderBlocks,
  type FollowUpReminderBlocksParams,
} from "./messages/follow-up-reminder";
import { getFollowUpCopy } from "@/utils/follow-up/copy";

export type SlackBriefingParams = MeetingBriefingBlocksParams & {
  accessToken: string;
  channelId: string;
};

export async function sendMeetingBriefingToSlack({
  accessToken,
  channelId,
  meetingTitle,
  formattedTime,
  videoConferenceLink,
  eventUrl,
  briefingContent,
}: SlackBriefingParams): Promise<void> {
  const client = createSlackClient(accessToken);

  const blocks = buildMeetingBriefingBlocks({
    meetingTitle,
    formattedTime,
    videoConferenceLink,
    eventUrl,
    briefingContent,
  });

  await postMessageWithJoin(client, channelId, {
    blocks,
    text: `📅 ${meetingTitle} 的会议简报，开始时间 ${formattedTime}`,
  });
}

export async function sendChannelConfirmation({
  accessToken,
  channelId,
  botUserId,
}: {
  accessToken: string;
  channelId: string;
  botUserId?: string | null;
}): Promise<void> {
  const client = createSlackClient(accessToken);

  await postMessageWithJoin(client, channelId, {
    text: `✅ 已连接 Inbox Zero！你可以在本渠道中 @提及 ${formatSlackAppMention(botUserId)}，聊聊你的邮件。如果你启用了会议简报或附件归档通知，我也可以把它们发送到这里。`,
  });
}

export async function sendConnectionOnboardingDirectMessage({
  accessToken,
  userId,
  botUserId,
}: {
  accessToken: string;
  userId: string;
  botUserId?: string | null;
}): Promise<void> {
  const client = createSlackClient(accessToken);

  await client.chat.postMessage(
    disableSlackLinkUnfurls({
      channel: userId,
      text: `✅ 已连接 Inbox Zero。接下来，请在 Inbox Zero 中打开“渠道”页面，选择消息的发送位置。如需使用私密渠道，请把 ${formatSlackAppMention(botUserId)} 邀请进去。你也可以随时私信我，聊聊你的邮件。`,
    }),
  );
}

export type SlackDocumentFiledParams = DocumentFiledBlocksParams & {
  accessToken: string;
  channelId: string;
};

export async function sendDocumentFiledToSlack({
  accessToken,
  channelId,
  filename,
  folderPath,
  driveProvider,
  senderEmail,
  fileId,
}: SlackDocumentFiledParams): Promise<void> {
  const client = createSlackClient(accessToken);
  const blocks = buildDocumentFiledBlocks({
    filename,
    folderPath,
    driveProvider,
    senderEmail,
    fileId,
  });

  await postMessageWithJoin(client, channelId, {
    blocks,
    text: `📨 已将 ${filename} 归档到 ${folderPath}`,
  });
}

export type SlackDocumentAskParams = DocumentAskBlocksParams & {
  accessToken: string;
  channelId: string;
};

export async function sendDocumentAskToSlack({
  accessToken,
  channelId,
  filename,
  reasoning,
  senderEmail,
}: SlackDocumentAskParams): Promise<void> {
  const client = createSlackClient(accessToken);
  const blocks = buildDocumentAskBlocks({ filename, reasoning, senderEmail });

  await postMessageWithJoin(client, channelId, {
    blocks,
    text: `📄 我该把 ${filename} 归档到哪里？`,
  });
}

export type SlackDigestParams = DigestBlocksParams & {
  accessToken: string;
  channelId: string;
};

export async function sendDigestToSlack({
  accessToken,
  channelId,
  date,
  ruleNames,
  itemsByRule,
}: SlackDigestParams): Promise<void> {
  const client = createSlackClient(accessToken);
  const blocks = buildDigestBlocks({
    date,
    ruleNames,
    itemsByRule,
  });

  await postMessageWithJoin(client, channelId, {
    blocks,
    text: "📋 你的 Inbox Zero 邮件摘要",
  });
}

export type SlackFollowUpReminderParams = FollowUpReminderBlocksParams & {
  accessToken: string;
  channelId: string;
};

export async function sendFollowUpReminderToSlack({
  accessToken,
  channelId,
  ...blockParams
}: SlackFollowUpReminderParams): Promise<string | null> {
  const client = createSlackClient(accessToken);
  const blocks = buildFollowUpReminderBlocks(blockParams);
  const { emoji } = getFollowUpCopy(blockParams.trackerType);

  return postMessageWithJoin(client, channelId, {
    blocks,
    text: `${emoji} 跟进：${blockParams.subject}`,
  });
}

/**
 * `channelId` 的哨兵值，表示消息应作为私信发送给 `providerUserId`，
 * 而不是发送到某个渠道。
 */
export const SLACK_DM_CHANNEL_SENTINEL = "DM";

export function isSlackDmChannel(channelId: string | null): boolean {
  return channelId === SLACK_DM_CHANNEL_SENTINEL;
}

export async function resolveSlackDestination({
  accessToken,
  channelId,
  providerUserId,
}: {
  accessToken: string;
  channelId: string | null;
  providerUserId: string | null;
}): Promise<string | null> {
  if (channelId && !isSlackDmChannel(channelId)) return channelId;

  if (isSlackDmChannel(channelId) && providerUserId) {
    const client = createSlackClient(accessToken);
    const response = await client.conversations.open({
      users: providerUserId,
    });
    return response.channel?.id ?? null;
  }

  return null;
}

export async function resolveSlackRouteDestination({
  accessToken,
  route,
}: {
  accessToken: string;
  route:
    | {
        targetType: MessagingRouteTargetType;
        targetId: string;
      }
    | null
    | undefined;
}): Promise<string | null> {
  if (!route) return null;

  if (route.targetType === MessagingRouteTargetType.CHANNEL) {
    return route.targetId;
  }

  const client = createSlackClient(accessToken);
  const response = await client.conversations.open({
    users: route.targetId,
  });
  return response.channel?.id ?? null;
}

export function formatSlackAppMention(botUserId: string | null | undefined) {
  return botUserId ? `<@${botUserId}>` : "@Inbox Zero";
}

export function disableSlackLinkUnfurls<T extends object>(message: T) {
  return {
    ...message,
    unfurl_links: false,
    unfurl_media: false,
  };
}

type Blocks = (KnownBlock | Block)[];

async function postMessageWithJoin(
  client: WebClient,
  channelId: string,
  message: { text: string; blocks?: Blocks },
): Promise<string | null> {
  const args = disableSlackLinkUnfurls(
    message.blocks
      ? { channel: channelId, blocks: message.blocks, text: message.text }
      : { channel: channelId, text: message.text },
  );

  try {
    const response = await client.chat.postMessage(args);
    return response.ts ?? null;
  } catch (error: unknown) {
    if (isSlackError(error) && error.data?.error === "not_in_channel") {
      try {
        await client.conversations.join({ channel: channelId });
      } catch (joinError: unknown) {
        if (
          isSlackError(joinError) &&
          joinError.data?.error === "missing_scope"
        ) {
          throw new Error(
            "机器人缺少 channels:join 权限范围。请在设置中重新连接 Slack 以更新权限。",
          );
        }
        throw joinError;
      }
      const response = await client.chat.postMessage(args);
      return response.ts ?? null;
    }
    throw error;
  }
}

function isSlackError(
  error: unknown,
): error is Error & { data?: { error?: string } } {
  return error instanceof Error && "data" in error;
}
