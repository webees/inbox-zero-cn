import { addDays } from "date-fns/addDays";
import { subDays } from "date-fns/subDays";
import { createCalendarEventProviders } from "@/utils/calendar/event-provider";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import type { Logger } from "@/utils/logger";
import { formatInUserTimezone } from "@/utils/date";

const RECENT_MEETING_LOOKBACK_DAYS = 14;
const UPCOMING_MEETING_LOOKAHEAD_DAYS = 7;
const MAX_MEETINGS_PER_CATEGORY = 5;
const MAX_DESCRIPTION_LENGTH = 500;

export interface MeetingContext {
  eventDescription?: string;
  eventLocation?: string;
  eventTime: Date;
  eventTitle: string;
  isPast: boolean;
}

/**
 * 检查所有必需的邮箱是否为该事件的受邀者。
 */
function allRecipientsAreAttendees(
  event: CalendarEvent,
  requiredEmails: string[],
): boolean {
  const attendeeEmails = new Set(
    event.attendees.map((a) => a.email.toLowerCase()),
  );
  return requiredEmails.every((email) => attendeeEmails.has(email));
}

/**
 * 为特定收件人拉取会议上下文。
 * 包含最近的过往会议和即将到来的会议。
 * 用于在起草邮件时提供跨上下文感知。
 *
 * 隐私：当提供了 additionalRecipients（例如 CC 收件人）时，
 * 仅包含所有收件人都作为受邀者参加的会议。
 * 这可以防止将私有日历信息泄露给
 * 并未参与这些会议的人。
 */
export async function getMeetingContext({
  emailAccountId,
  recipientEmail,
  additionalRecipients = [],
  logger,
}: {
  emailAccountId: string;
  recipientEmail: string;
  additionalRecipients?: string[];
  logger: Logger;
}): Promise<MeetingContext[]> {
  try {
    const calendarProviders = await createCalendarEventProviders(
      emailAccountId,
      logger,
    );

    if (calendarProviders.length === 0) {
      return [];
    }

    const now = new Date();
    const pastLimit = subDays(now, RECENT_MEETING_LOOKBACK_DAYS);
    const futureLimit = addDays(now, UPCOMING_MEETING_LOOKAHEAD_DAYS);
    const normalizedRecipientEmail = recipientEmail.trim().toLowerCase();

    // 为隐私过滤规范化所有额外收件人
    const normalizedAdditionalRecipients = additionalRecipients.map((e) =>
      e.trim().toLowerCase(),
    );
    const allRequiredAttendees = [
      normalizedRecipientEmail,
      ...normalizedAdditionalRecipients,
    ];

    const pastMeetings: CalendarEvent[] = [];
    const upcomingMeetings: CalendarEvent[] = [];

    for (const provider of calendarProviders) {
      try {
        // 拉取最近的过往会议
        const pastEvents = await provider.fetchEventsWithAttendee({
          attendeeEmail: normalizedRecipientEmail,
          timeMin: pastLimit,
          timeMax: now,
          maxResults: MAX_MEETINGS_PER_CATEGORY,
        });
        pastMeetings.push(...pastEvents);

        // 拉取即将到来的会议
        const upcomingEvents = await provider.fetchEventsWithAttendee({
          attendeeEmail: normalizedRecipientEmail,
          timeMin: now,
          timeMax: futureLimit,
          maxResults: MAX_MEETINGS_PER_CATEGORY,
        });
        upcomingMeetings.push(...upcomingEvents);
      } catch (error) {
        logger.warn("从服务商拉取事件失败", { error });
      }
    }

    // 隐私过滤：仅包含所有收件人都作为受邀者参加的会议
    // 这可以防止将私有会议信息泄露给未被邀请的 CC 收件人
    const filterByAllAttendees = (events: CalendarEvent[]) =>
      normalizedAdditionalRecipients.length > 0
        ? events.filter((e) =>
            allRecipientsAreAttendees(e, allRequiredAttendees),
          )
        : events;

    const filteredPastMeetings = filterByAllAttendees(pastMeetings);
    const filteredUpcomingMeetings = filterByAllAttendees(upcomingMeetings);

    // 按开始时间降序排序过往会议（最近的在前）
    filteredPastMeetings.sort(
      (a, b) => b.startTime.getTime() - a.startTime.getTime(),
    );
    // 按开始时间升序排序即将到来的会议（最早的在前）
    filteredUpcomingMeetings.sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    // 每个类别只取前几个
    const limitedPastMeetings = filteredPastMeetings.slice(
      0,
      MAX_MEETINGS_PER_CATEGORY,
    );
    const limitedUpcomingMeetings = filteredUpcomingMeetings.slice(
      0,
      MAX_MEETINGS_PER_CATEGORY,
    );

    const mapToContext = (
      event: CalendarEvent,
      isPast: boolean,
    ): MeetingContext => ({
      eventTitle: event.title,
      eventTime: event.startTime,
      eventDescription: event.description,
      eventLocation: event.location,
      isPast,
    });

    return [
      ...limitedPastMeetings.map((e) => mapToContext(e, true)),
      ...limitedUpcomingMeetings.map((e) => mapToContext(e, false)),
    ];
  } catch (error) {
    logger.error("获取会议上下文失败", { error });
    return [];
  }
}

function truncateDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return;
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  return `${description.slice(0, MAX_DESCRIPTION_LENGTH)}...`;
}

function formatMeeting(
  meeting: MeetingContext,
  timezone?: string | null,
): string {
  const dateTime = formatInUserTimezone(
    meeting.eventTime,
    timezone,
    "EEEE, MMMM d 'at' h:mm a",
  );

  let details = `- "${meeting.eventTitle}" on ${dateTime}`;
  if (meeting.eventLocation) {
    details += ` (${meeting.eventLocation})`;
  }
  const truncatedDesc = truncateDescription(meeting.eventDescription);
  if (truncatedDesc) {
    details += `\n  Description: ${truncatedDesc}`;
  }
  return details;
}

/**
 * 格式化会议上下文以便包含在 AI 提示词中。
 */
export function formatMeetingContextForPrompt(
  meetings: MeetingContext[],
  timezone?: string | null,
): string | null {
  if (meetings.length === 0) {
    return null;
  }

  const pastMeetings = meetings.filter((m) => m.isPast);
  const upcomingMeetings = meetings.filter((m) => !m.isPast);

  const sections: string[] = [];

  if (pastMeetings.length > 0) {
    const pastList = pastMeetings
      .map((m) => formatMeeting(m, timezone))
      .join("\n");
    sections.push(`<recent_meetings>
${pastList}
</recent_meetings>`);
  }

  if (upcomingMeetings.length > 0) {
    const upcomingList = upcomingMeetings
      .map((m) => formatMeeting(m, timezone))
      .join("\n");
    sections.push(`<upcoming_meetings>
${upcomingList}
</upcoming_meetings>`);
  }

  const meetingsSection = sections.join("\n\n");

  const instructions: string[] = [];
  if (pastMeetings.length > 0) {
    instructions.push(
      "For past meetings, you might reference topics discussed.",
    );
  }
  if (upcomingMeetings.length > 0) {
    instructions.push(
      'For upcoming meetings, you might say "Looking forward to our call" or "We can discuss this further in our upcoming meeting."',
    );
  }

  return `You have meeting history with this person:

${meetingsSection}

Use this context naturally if relevant. ${instructions.join(" ")}`;
}
