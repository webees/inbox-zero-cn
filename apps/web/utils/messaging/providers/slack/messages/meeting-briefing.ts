import type { KnownBlock, Block } from "@slack/types";

import type { BriefingContent } from "@inboxzero/transactional-email/emails/meeting-briefing";

export type MeetingBriefingBlocksParams = {
  meetingTitle: string;
  formattedTime: string;
  videoConferenceLink?: string;
  eventUrl?: string;
  briefingContent: BriefingContent;
};

export function buildMeetingBriefingBlocks({
  meetingTitle,
  formattedTime,
  videoConferenceLink,
  eventUrl,
  briefingContent,
}: MeetingBriefingBlocksParams): (KnownBlock | Block)[] {
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📅 会议简报：${meetingTitle}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*开始时间* ${formattedTime}`,
      },
    },
  ];

  const links: string[] = [];
  if (videoConferenceLink) {
    links.push(`<${videoConferenceLink}|加入会议>`);
  }
  if (eventUrl) {
    links.push(`<${eventUrl}|查看日历事件>`);
  }

  if (links.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: links.join(" | "),
      },
    });
  }

  blocks.push({ type: "divider" });

  if (briefingContent.priorities.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*会议重点*" },
    });
    for (const priority of briefingContent.priorities) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• ${priority}` },
      });
    }
    blocks.push({ type: "divider" });
  }

  for (const guest of briefingContent.guests) {
    const bulletsText = guest.bullets.map((b) => `• ${b}`).join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${guest.name}* (${guest.email})\n${bulletsText}`,
      },
    });
  }

  if (
    briefingContent.internalTeamMembers &&
    briefingContent.internalTeamMembers.length > 0
  ) {
    const names = briefingContent.internalTeamMembers
      .map((m) => m.name || m.email)
      .join(", ");

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_共同参会：${names}（内部团队）_`,
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "_由 Inbox Zero 生成的 AI 会议简报 • 可能存在不准确之处_",
      },
    ],
  });

  return blocks;
}
