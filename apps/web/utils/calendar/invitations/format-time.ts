import { TZDate } from "@date-fns/tz";
import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { parseISO } from "date-fns/parseISO";
import { subDays } from "date-fns/subDays";

const DAY = "EEEE, MMMM d, yyyy";
const TIME = "h:mm a";
const DAY_AND_TIME = "EEE, MMM d, yyyy, h:mm a";

/**
 * 为 `timeZone` 中的查看者渲染邀请的时间范围。
 *
 * `start` 和 `end` 来自解析器，可能是绝对时刻
 * ("2026-09-29T16:00:00.000Z")、浮动的墙上时钟时间
 * ("2026-09-29T13:00:00")，或全天事件的纯日期。
 */
export function formatInvitationTime(
  {
    start,
    end,
    allDay,
  }: { start: string; end: string | null; allDay: boolean },
  timeZone: string,
) {
  const startDate = toViewerDate(start, timeZone);
  const endDate = end ? toViewerDate(end, timeZone) : null;

  if (allDay) {
    // 对于全天事件 DTEND 是排他的，因此它指向次日早晨。
    const lastDay = endDate ? subDays(endDate, 1) : startDate;
    if (lastDay.getTime() <= startDate.getTime()) return format(startDate, DAY);
    return `${format(startDate, DAY)} – ${format(lastDay, DAY)}`;
  }

  if (!endDate) return `${format(startDate, DAY)} · ${format(startDate, TIME)}`;
  if (isSameDay(startDate, endDate))
    return `${format(startDate, DAY)} · ${format(startDate, TIME)} – ${format(endDate, TIME)}`;
  return `${format(startDate, DAY_AND_TIME)} – ${format(endDate, DAY_AND_TIME)}`;
}

function toViewerDate(value: string, timeZone: string) {
  // 浮动时间或纯日期不携带时区，因此其挂钟时间才是
  // 每个查看者应读取的；parseISO 不会改动这些组成部分。
  if (!value.endsWith("Z")) return parseISO(value);
  return new TZDate(new Date(value), timeZone);
}
