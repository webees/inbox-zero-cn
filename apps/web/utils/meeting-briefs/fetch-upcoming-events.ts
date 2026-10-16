import { addMinutes } from "date-fns/addMinutes";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import { fetchCalendarEventsInWindow } from "@/utils/calendar/fetch-events-in-window";
import type { Logger } from "@/utils/logger";
import { partitionAttendeesForBriefing } from "./attendees";

const MAX_EVENTS_PER_PROVIDER = 20;

// 必须与 vercel.json 中 /api/meeting-briefs 的 cron 计划一致。
// 预看窗口会延长一个 cron 间隔，这样即使某个事件的提前
// 窗口在两次 cron 触发之间开合，也能在它开始前的
// 最后一次触发时被拾取。重复发送由 process.ts 中的
// meetingBriefing 唯一约束占用机制防止。
const CRON_INTERVAL_MINUTES = 15;

export async function fetchUpcomingEvents({
  emailAccountId,
  minutesBefore,
  logger,
}: {
  emailAccountId: string;
  minutesBefore: number;
  logger: Logger;
}): Promise<CalendarEvent[]> {
  const timeMin = new Date();

  // 简报只会作用于它能看见的事件，因此部分拉取
  // 在这里无害。
  const { events } = await fetchCalendarEventsInWindow({
    emailAccountId,
    timeMin,
    timeMax: addMinutes(timeMin, minutesBefore + CRON_INTERVAL_MINUTES),
    maxResultsPerProvider: MAX_EVENTS_PER_PROVIDER,
    logger,
  });

  return events;
}

export function filterEventsWithExternalGuests(
  events: CalendarEvent[],
  userEmail: string,
): CalendarEvent[] {
  return events.filter(
    (event) =>
      partitionAttendeesForBriefing(event, userEmail).external.length > 0,
  );
}
