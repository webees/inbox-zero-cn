import { subDays } from "date-fns/subDays";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { formatInUserTimezone } from "@/utils/date";
import { parseAttendeeSnapshot } from "@/utils/meeting-recorder/attendees";
import {
  parseMeetingSummary,
  type MeetingSummary,
} from "@/utils/ai/meeting-recorder/summarize-meeting";

const RECORDED_MEETING_LOOKBACK_DAYS = 30;
const MAX_RECORDED_MEETINGS = 3;
// 在 JS 中的参会者过滤运行之前抓取，因此这限制的是扫描范围，
// 而不是结果大小。
const FETCH_LIMIT = 25;

export interface RecordedMeetingContext {
  eventTitle: string;
  startTime: Date;
  summary: MeetingSummary;
}

/**
 * 抓取由邮件收件人参加过的、已录制会议的 AI 摘要（来自会议记录助手），
 * 用作起草上下文。
 *
 * 隐私：录制内容比日历元数据更敏感。仅当邮件的每一位收件人
 * 都是未拒绝的参会者时才包含该会议，
 * 因此通话中所说的内容绝不会暴露给不在场的人。
 */
export async function getRecordedMeetingContext({
  emailAccountId,
  recipientEmail,
  additionalRecipients = [],
  logger,
}: {
  emailAccountId: string;
  recipientEmail: string;
  additionalRecipients?: string[];
  logger: Logger;
}): Promise<RecordedMeetingContext[]> {
  try {
    const meetings = await prisma.meeting.findMany({
      where: {
        emailAccountId,
        summary: { not: Prisma.DbNull },
        startTime: { gte: subDays(new Date(), RECORDED_MEETING_LOOKBACK_DAYS) },
      },
      orderBy: { startTime: "desc" },
      take: FETCH_LIMIT,
      select: {
        eventTitle: true,
        startTime: true,
        attendees: true,
        summary: true,
      },
    });

    const requiredAttendees = [recipientEmail, ...additionalRecipients].map(
      (email) => email.trim().toLowerCase(),
    );

    const results: RecordedMeetingContext[] = [];

    for (const meeting of meetings) {
      if (results.length >= MAX_RECORDED_MEETINGS) break;

      const attendedEmails = new Set(
        parseAttendeeSnapshot(meeting.attendees)
          .filter((attendee) => !attendee.declined)
          .map((attendee) => attendee.email.trim().toLowerCase()),
      );
      if (!requiredAttendees.every((email) => attendedEmails.has(email))) {
        continue;
      }

      const summary = parseMeetingSummary(meeting.summary);
      if (!summary) continue;

      results.push({
        eventTitle: meeting.eventTitle,
        startTime: meeting.startTime,
        summary,
      });
    }

    return results;
  } catch (error) {
    logger.error("获取已录制会议的上下文失败", { error });
    return [];
  }
}

/**
 * 格式化已录制会议摘要，以便纳入回复起草
 * 提示词。
 */
export function formatRecordedMeetingContextForPrompt(
  meetings: RecordedMeetingContext[],
  timezone?: string | null,
): string | null {
  if (meetings.length === 0) return null;

  const notes = meetings
    .map((meeting) => formatRecordedMeeting(meeting, timezone))
    .join("\n\n");

  return `You have notes from recorded meetings that the recipients of this email attended:

<recorded_meeting_notes>
${notes}
</recorded_meeting_notes>

Treat these notes as factual context about what was discussed and agreed. Reference the conversation naturally when relevant (e.g. "as discussed on our call"). Do not mention recordings, transcripts, or notes, and do not recap the meeting unprompted.`;
}

function formatRecordedMeeting(
  meeting: RecordedMeetingContext,
  timezone?: string | null,
): string {
  const dateTime = formatInUserTimezone(
    meeting.startTime,
    timezone,
    "EEEE, MMMM d 'at' h:mm a",
  );
  const { summary } = meeting;

  const lines = [
    `- "${meeting.eventTitle}" on ${dateTime}`,
    `  Overview: ${summary.overview}`,
  ];

  if (summary.keyDecisions.length > 0) {
    lines.push(`  Decisions: ${summary.keyDecisions.join("; ")}`);
  }
  if (summary.actionItems.length > 0) {
    const items = summary.actionItems
      .map((item) =>
        item.owner
          ? `${item.description} (owner: ${item.owner})`
          : item.description,
      )
      .join("; ");
    lines.push(`  Action items: ${items}`);
  }
  if (summary.openQuestions?.length) {
    lines.push(`  Open questions: ${summary.openQuestions.join("; ")}`);
  }
  if (summary.nextSteps?.length) {
    lines.push(`  Next steps: ${summary.nextSteps.join("; ")}`);
  }

  return lines.join("\n");
}
