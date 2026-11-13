import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { format } from "date-fns/format";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { isSameDay } from "date-fns/isSameDay";
import { isSameMonth } from "date-fns/isSameMonth";
import { isSameYear } from "date-fns/isSameYear";
import { isWeekend } from "date-fns/isWeekend";
import { startOfDay } from "date-fns/startOfDay";
import { subDays } from "date-fns/subDays";
import { TZDate } from "@date-fns/tz";
import { createScopedLogger } from "@/utils/logger";
import { captureException } from "@/utils/error";

export const ONE_MINUTE_MS = 1000 * 60;
export const ONE_HOUR_MS = ONE_MINUTE_MS * 60;
export const ONE_DAY_MS = ONE_HOUR_MS * 24;
export const ONE_MONTH_MS = ONE_DAY_MS * 30;
export const ONE_YEAR_MS = ONE_DAY_MS * 365;
export const TEN_YEARS_MS = ONE_YEAR_MS * 10;

export const ONE_HOUR_MINUTES = 60;
export const ONE_DAY_MINUTES = ONE_HOUR_MINUTES * 24;
export const ONE_WEEK_MINUTES = ONE_DAY_MINUTES * 7;
export const NINETY_DAYS_MINUTES = ONE_DAY_MINUTES * 90;

/**
 * 将日期格式化为短字符串。
 * - 如果日期是今天，则返回时间（例如 "3:44 PM"）。
 * - 如果日期在今年，则返回日期（例如 "JUL 5"）。
 * - 否则包含年份（例如 "JUL 5, 2024"）。
 * - 可选择以小写形式返回日期部分（例如 "jul 5"）。
 * - 除非提供了 `locale`，否则使用运行时区域设置（传入 UI 区域设置）。
 */
export function formatShortDate(
  date: Date,
  options: { lowercase?: boolean; locale?: string } = {},
) {
  const now = new Date();

  if (isSameDay(date, now))
    return shortDateFormatter("time", options.locale).format(date);

  const formattedDate = shortDateFormatter(
    isSameYear(date, now) ? "date" : "dateWithYear",
    options.locale,
  ).format(date);

  return options.lowercase ? formattedDate : formattedDate.toUpperCase();
}

/**
 * 为邮件列表分组的日期添加标签。分组刻意保持粗粒度，因此列表只会带有少量标题。
 * - 今天和昨天各自拥有独立分组。
 * - 过去一周的其余日期归入一个 "Last 7 days" 分组。
 * - 本月较早的日期归入一个 "Earlier this month" 分组。
 * - 更早的日期按月份添加标签（例如 "August" 或 "August 2024"）。
 * - 晚于今天的日期保留其自身的日期，因此时钟偏差的发件人永远不会被归入已经过去的分组。
 */
export function formatDateGroupLabel(
  date: Date,
  i18n: I18n,
  now: Date = new Date(),
) {
  if (isSameDay(date, now)) return i18n._(msg`今天`);
  if (isSameDay(date, subDays(now, 1))) return i18n._(msg`昨天`);
  if (date > now)
    return formatGroupDate(date, i18n, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  if (date >= startOfDay(subDays(now, 6))) return i18n._(msg`过去 7 天`);
  if (isSameMonth(date, now)) return i18n._(msg`本月早些时候`);
  if (isSameYear(date, now))
    return formatGroupDate(date, i18n, { month: "long" });
  return formatGroupDate(date, i18n, { month: "long", year: "numeric" });
}

export function formatDayAtTime(date: Date, i18n: I18n) {
  const day = i18n.date(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = i18n.date(date, { hour: "numeric", minute: "2-digit" });
  return i18n._(msg`${day} ${time}`);
}

export function dateToSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

export function internalDateToDate(
  internalDate?: string | null,
  options?: { fallbackToNow?: boolean },
): Date {
  const fallbackToNow = options?.fallbackToNow ?? true;
  if (!internalDate?.trim()) {
    return fallbackToNow ? new Date() : new Date(Number.NaN);
  }

  // 首先尝试按普通日期字符串解析（例如 "2025-06-19T21:46:31Z" 这样的 ISO 字符串）
  let date = new Date(internalDate);
  if (!Number.isNaN(date.getTime())) return date;

  // 对于数字时间戳，回退到旧行为
  date = new Date(+internalDate);
  if (Number.isNaN(date.getTime())) {
    return fallbackToNow ? new Date() : new Date(Number.NaN);
  }

  return date;
}

export function formatDateForLLM(date: Date) {
  return format(date, "EEEE, yyyy-MM-dd HH:mm:ss 'UTC'");
}

export function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatRelativeTimeForLLM(date: Date) {
  return formatDistanceToNow(date, { addSuffix: true });
}

// Format: Mar 18, 2025
export function formatDateSimple(date: Date, locale = "en-US") {
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Comparator function for sorting messages by internalDate
 * @param direction - 'asc' for oldest first (default, chronological), 'desc' for newest first
 */
export function sortByInternalDate<T extends { internalDate?: string | null }>(
  direction: "asc" | "desc" = "asc",
) {
  return (a: T, b: T): number => {
    const aTime = a.internalDate
      ? internalDateToDate(a.internalDate).getTime()
      : 0;
    const bTime = b.internalDate
      ? internalDateToDate(b.internalDate).getTime()
      : 0;
    return direction === "asc" ? aTime - bTime : bTime - aTime;
  };
}

const DEFAULT_TIMEZONE = "UTC";
const logger = createScopedLogger("date-utils");

/**
 * Formats a date/time in the user's timezone.
 * Falls back to UTC if the timezone is invalid (corrupted/legacy/non-IANA values).
 * @param date - The date to format (typically from a calendar event)
 * @param timezone - The user's timezone (e.g., "America/Sao_Paulo", "America/New_York")
 * @param formatString - The date-fns format string (e.g., "h:mm a", "MMM d, yyyy 'at' h:mm a")
 * @returns The formatted date string in the user's timezone
 */
export function formatInUserTimezone(
  date: Date,
  timezone: string | null | undefined,
  formatString: string,
): string {
  const tz = timezone || DEFAULT_TIMEZONE;
  try {
    const dateInTZ = new TZDate(date, tz);
    return format(dateInTZ, formatString);
  } catch (error) {
    // Invalid timezone (corrupted/legacy/non-IANA) - log and fall back to UTC
    logger.error("Invalid timezone, falling back to UTC", {
      timezone: tz,
      error,
    });
    captureException(error, {
      extra: { timezone: tz, context: "formatInUserTimezone" },
    });
    const dateInUTC = new TZDate(date, DEFAULT_TIMEZONE);
    return format(dateInUTC, formatString);
  }
}

/**
 * Formats a time (without date) in the user's timezone.
 * Example output: "4:00 PM"
 */
export function formatTimeInUserTimezone(
  date: Date,
  timezone: string | null | undefined,
): string {
  return formatInUserTimezone(date, timezone, "h:mm a");
}

/**
 * Formats a date and time in the user's timezone.
 * Example output: "Dec 30, 2024 at 4:00 PM"
 */
export function formatDateTimeInUserTimezone(
  date: Date,
  timezone: string | null | undefined,
): string {
  return formatInUserTimezone(date, timezone, "MMM d, yyyy 'at' h:mm a");
}

export function hasElapsedBusinessDays({
  start,
  end,
  days,
  windowMinutes = 0,
  timezone,
}: {
  start: Date;
  end: Date;
  days: number;
  windowMinutes?: number;
  timezone: string | null | undefined;
}) {
  const elapsedMs = getBusinessElapsedMs(start, end, timezone);
  const thresholdWithWindowMs =
    days * ONE_DAY_MS - windowMinutes * ONE_MINUTE_MS;
  return elapsedMs > thresholdWithWindowMs;
}

export function getElapsedBusinessDaysForDisplay({
  start,
  end,
  timezone,
}: {
  start: Date;
  end: Date;
  timezone: string | null | undefined;
}) {
  const elapsedMs = getBusinessElapsedMs(start, end, timezone);
  return Math.max(1, Math.ceil(elapsedMs / ONE_DAY_MS));
}

function getBusinessElapsedMs(
  start: Date,
  end: Date,
  timezone: string | null | undefined,
) {
  if (end <= start) return 0;

  const safeTimezone = getSafeTimezone(timezone);
  let cursor = start;
  let elapsedMs = 0;

  while (cursor < end) {
    const nextBoundary = getNextZonedMidnight(cursor, safeTimezone);
    const segmentEnd = nextBoundary < end ? nextBoundary : end;

    if (!isWeekend(new TZDate(cursor, safeTimezone))) {
      elapsedMs += segmentEnd.getTime() - cursor.getTime();
    }

    if (segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }

  return elapsedMs;
}

function getSafeTimezone(timezone: string | null | undefined) {
  if (!timezone) return DEFAULT_TIMEZONE;

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getNextZonedMidnight(date: Date, timezone: string) {
  const zonedDate = new TZDate(date, timezone);
  return new TZDate(
    zonedDate.getFullYear(),
    zonedDate.getMonth(),
    zonedDate.getDate() + 1,
    0,
    0,
    0,
    0,
    timezone,
  );
}

const shortDateFormats = {
  // Numeric hours avoid leading zeros (3:44 PM, not 03:44 PM).
  time: { hour: "numeric", minute: "2-digit" },
  date: { month: "short", day: "numeric" },
  dateWithYear: { month: "short", day: "numeric", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
// Mail lists format a date per row on every render, and building an Intl
// formatter each time dominated that cost.
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

function shortDateFormatter(
  kind: keyof typeof shortDateFormats,
  locale: string | undefined,
) {
  const key = `${locale ?? ""}:${kind}`;
  let formatter = shortDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, shortDateFormats[kind]);
    shortDateFormatters.set(key, formatter);
  }
  return formatter;
}

// Some locales write month names in lowercase, which reads oddly as a heading.
function formatGroupDate(
  date: Date,
  i18n: I18n,
  options: Intl.DateTimeFormatOptions,
) {
  const text = i18n.date(date, options);
  return text.charAt(0).toLocaleUpperCase(i18n.locale) + text.slice(1);
}
