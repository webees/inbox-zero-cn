import { CALENDAR_INVITATION_LIMITS } from "@/utils/calendar/invitations/constants";
import { findVideoConferenceLink } from "@/utils/calendar/video-conference-link";
import { TZDate } from "@date-fns/tz";
import ICAL from "ical.js";
import { z } from "zod";

export type InvitationEvent = { id: string; response: string | null };

export type InvitationResponse = "accepted" | "declined" | "tentative";
export type CalendarInvitation = NonNullable<
  ReturnType<typeof parseCalendarInvitation>
>;

export function parseCalendarInvitation(content: string, email: string) {
  if (content.length > CALENDAR_INVITATION_LIMITS.content) return null;
  try {
    const identity = getCalendarInvitationIdentity(content);
    if (identity?.method !== "REQUEST") return null;
    const { event, uid, organizer, sequence, recurrenceId } = identity;
    if (event.getFirstPropertyValue("status") === "CANCELLED") return null;
    const attendee = event
      .getAllProperties("attendee")
      .find(
        (property) =>
          getEmail(property.getFirstValue()) === email.toLowerCase(),
      );
    const start = event.getFirstPropertyValue("dtstart");
    if (
      !attendee ||
      !(start instanceof ICAL.Time) ||
      organizer === email.toLowerCase()
    )
      return null;
    const response = attendee
      .getParameter("partstat")
      ?.toString()
      .toLowerCase();
    return {
      uid,
      organizer,
      attendee: email.toLowerCase(),
      title: String(
        event.getFirstPropertyValue("summary") || "Calendar invitation",
      ),
      sequence,
      recurrenceId,
      recurring:
        event.hasProperty("rrule") || event.hasProperty("recurrence-id"),
      response:
        response === "accepted" ||
        response === "declined" ||
        response === "tentative"
          ? response
          : null,
      ...getInvitationDetails(event, start),
      content,
    };
  } catch {
    return null;
  }
}

// 对格式错误的 ICS 抛出错误；错误处理由调用方负责。
export function getCalendarInvitationIdentity(content: string) {
  const calendar = new ICAL.Component(ICAL.parse(content));
  if (calendar.name !== "vcalendar") return null;
  const events = calendar.getAllSubcomponents("vevent");
  // 多事件请求在被应答之前需要一个明确的事件选择器。
  if (events.length !== 1) return null;
  const event = events[0];
  const uid = event.getFirstPropertyValue("uid");
  const organizer = getEmail(event.getFirstPropertyValue("organizer"));
  const sequence = event.getFirstPropertyValue("sequence") ?? 0;
  if (
    typeof uid !== "string" ||
    !uid ||
    !organizer ||
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 0
  )
    return null;
  const recurrence = event.getFirstPropertyValue("recurrence-id");
  return {
    method: calendar.getFirstPropertyValue("method"),
    event,
    uid,
    organizer,
    sequence,
    recurrenceId:
      recurrence instanceof ICAL.Time ? recurrence.toString() : null,
  };
}

export function createCalendarReply(
  invitation: CalendarInvitation,
  response: InvitationResponse,
) {
  const original = new ICAL.Component(ICAL.parse(invitation.content));
  const source = original.getFirstSubcomponent("vevent")!;
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("prodid", "-//Inbox Zero//Calendar//EN");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("method", "REPLY");
  for (const zone of original.getAllSubcomponents("vtimezone")) {
    calendar.addSubcomponent(
      new ICAL.Component(structuredClone(zone.toJSON())),
    );
  }
  const event = new ICAL.Component("vevent");
  for (const name of [
    "uid",
    "organizer",
    "sequence",
    "dtstart",
    "dtend",
    "duration",
    "recurrence-id",
    "summary",
  ]) {
    const property = source.getFirstProperty(name);
    if (property)
      event.addProperty(new ICAL.Property(structuredClone(property.toJSON())));
  }
  event.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  const attendee = new ICAL.Property("attendee");
  attendee.setValue(`mailto:${invitation.attendee}`);
  attendee.setParameter("partstat", response.toUpperCase());
  event.addProperty(attendee);
  calendar.addSubcomponent(event);
  return `${calendar.toString()}\r\n`;
}

function getEmail(value: unknown) {
  if (typeof value !== "string" || !value.toLowerCase().startsWith("mailto:"))
    return null;
  const result = z.email().safeParse(value.slice(7));
  return result.success ? result.data.toLowerCase() : null;
}

// 阅读器在 RSVP 按钮旁显示的详情。此处一切都仅用于
// 展示；响应依赖上方的字段。
function getInvitationDetails(event: ICAL.Component, start: ICAL.Time) {
  const timeZone = getParameter(event.getFirstProperty("dtstart"), "tzid");
  const location = getText(event, "location");
  return {
    start: toDisplayTime(start, timeZone),
    end: getEndTime(event, start, timeZone),
    allDay: start.isDate,
    location: location?.slice(0, 2000) ?? null,
    conferenceUrl:
      findVideoConferenceLink(
        // 每个厂商都用各自的 X- 属性命名加入 URL，因此扫描全部
        // 属性，而不是枚举不断增长的名称。
        ...getExtensionValues(event),
        location,
        // 完整读取而非截断：描述仅被扫描以查找加入链接，
        // 而邀请会将其埋在长长的议程中。
        getText(event, "description"),
      ) ?? null,
  };
}

// 事件结束的时区可能与开始时不同，因此 DTEND 携带自己的
// TZID。由 DURATION 推导的结束时间保持在开始时区。
function getEndTime(
  event: ICAL.Component,
  start: ICAL.Time,
  startTimeZone: string | null,
) {
  const end = event.getFirstPropertyValue("dtend");
  if (end instanceof ICAL.Time)
    return toDisplayTime(
      end,
      getParameter(event.getFirstProperty("dtend"), "tzid"),
    );
  const duration = event.getFirstPropertyValue("duration");
  if (!(duration instanceof ICAL.Duration)) return null;
  const derived = start.clone();
  // 日历天/周在 DST 期间保留挂钟时间；定时单位在日历天之后
  // 推进时刻（RFC 5545 第 3.3.6 节）。
  derived.addDuration(
    new ICAL.Duration({
      days: duration.days,
      weeks: duration.weeks,
      isNegative: duration.isNegative,
    }),
  );
  const dayEnd = toDisplayTime(derived, startTimeZone);
  const timedDuration = duration.clone();
  timedDuration.days = 0;
  timedDuration.weeks = 0;
  if (dayEnd.endsWith("Z"))
    return new Date(
      Date.parse(dayEnd) + timedDuration.toSeconds() * 1000,
    ).toISOString();
  derived.addDuration(timedDuration);
  return toDisplayTime(derived, startTimeZone);
}

/**
 * 为阅读器序列化时间：全天事件用纯日期，时区已知时用
 * 绝对时刻，否则用浮动挂钟时间。
 */
function toDisplayTime(time: ICAL.Time, timeZone: string | null) {
  if (time.isDate) return time.toString();
  if (time.zone !== ICAL.Timezone.localTimezone)
    return time.toJSDate().toISOString();
  // ical.js 只解析邀请定义为 VTIMEZONE 的 TZID。
  // 省略它的发件人仍会写出运行时能查找的时区名。
  return (timeZone && toInstant(time, timeZone)) ?? time.toString();
}

function toInstant(time: ICAL.Time, timeZone: string) {
  const zoned = new TZDate(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
    timeZone,
  );
  // 运行时无法解析的 TZID（Windows 时区名）会使其保持浮动。
  return Number.isNaN(zoned.getTime())
    ? null
    : new Date(zoned.getTime()).toISOString();
}

function getExtensionValues(event: ICAL.Component) {
  return event
    .getAllProperties()
    .filter((property) => property.name.startsWith("x-"))
    .map((property) => {
      const value = property.getFirstValue();
      return typeof value === "string" ? value : null;
    });
}

function getText(event: ICAL.Component, name: string) {
  const value = event.getFirstPropertyValue(name);
  if (typeof value !== "string" || !value) return null;
  return value;
}

function getParameter(property: ICAL.Property | null, name: string) {
  const value = property?.getParameter(name);
  if (typeof value !== "string" || !value) return null;
  return value;
}
