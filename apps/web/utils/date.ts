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
 * Formats a date into a short string.
 * - If the date is today, returns the time (e.g., "3:44 PM").
 * - If the date is this year, returns the date (e.g., "JUL 5").
 * - Otherwise includes the year (e.g., "JUL 5, 2024").
 * - Optionally returns the date part in lowercase (e.g., "jul 5").
 */
export function formatShortDate(
  date: Date,
  options: { lowercase?: boolean } = {},
) {
  const now = new Date();

  if (isSameDay(date, now)) return shortDateFormatter("time").format(date);

  const formattedDate = shortDateFormatter(
    isSameYear(date, now) ? "date" : "dateWithYear",
  ).format(date);

  return options.lowercase ? formattedDate : formattedDate.toUpperCase();
}

/**
 * 为日期打标签，以便将邮件列表分组为若干区块。这些区块刻意划分得较为
 * 粗略，因此列表最多只会包含少量标题。
 * - 今天和昨天各自成为单独区块。
 * - 过去一周的其余日期合并为一个「最近 7 天」区块。
 * - 当月更早的日期合并为一个「本月早些时候」区块。
 * - 更早的日期按月份标注（例如 "August" 或 "August 2024"）。
 * - 晚于今天的日期保留自身的日期，因此时钟偏差的发件人永远不会被归入
 *   已经过去的区块中。
 */
export function formatDateGroupLabel(date: Date, now: Date = new Date()) {
  if (isSameDay(date, now)) return "今天";
  if (isSameDay(date, subDays(now, 1))) return "昨天";
  if (date > now) return format(date, "MMMM do, yyyy");
  if (date >= startOfDay(subDays(now, 6))) return "最近 7 天";
  if (isSameMonth(date, now)) return "本月早些时候";
  if (isSameYear(date, now)) return format(date, "MMMM");
  return format(date, "MMMM yyyy");
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

  // 首先尝试按普通日期字符串解析（用于 "2025-06-19T21:46:31Z" 这类 ISO 字符串）
  let date = new Date(internalDate);
  if (!Number.isNaN(date.getTime())) return date;

  // 对数字时间戳回退到旧有行为
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

// 格式：Mar 18, 2025
export function formatDateSimple(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * 按 internalDate 对邮件排序的比较函数
 * @param direction - 'asc' 表示最旧在前（默认，按时间顺序），'desc' 表示最新在前
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
 * 在用户时区中格式化日期/时间。
 * 如果时区无效（损坏、旧版或非 IANA 值），则回退到 UTC。
 * @param date - 要格式化的日期（通常来自日历事件）
 * @param timezone - 用户的时区（例如 "America/Sao_Paulo"、"America/New_York"）
 * @param formatString - date-fns 格式字符串（例如 "h:mm a"、"MMM d, yyyy 'at' h:mm a"）
 * @returns 按用户时区格式化后的日期字符串
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
    // 时区无效（损坏、旧版或非 IANA）- 记录日志并回退到 UTC
    logger.error("时区无效，回退到 UTC", {
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
 * 在用户时区中格式化时间（不含日期）。
 * 示例输出："4:00 PM"
 */
export function formatTimeInUserTimezone(
  date: Date,
  timezone: string | null | undefined,
): string {
  return formatInUserTimezone(date, timezone, "h:mm a");
}

/**
 * 在用户时区中格式化日期和时间。
 * 示例输出："Dec 30, 2024 at 4:00 PM"
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
  // 数字小时避免前导零（3:44 PM，而非 03:44 PM）。
  time: { hour: "numeric", minute: "2-digit" },
  date: { month: "short", day: "numeric" },
  dateWithYear: { month: "short", day: "numeric", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
// 邮件列表每次渲染都会为每一行格式化日期，而每次都构建 Intl
// 格式化器会占据这项开销的主要部分。
const shortDateFormatters = new Map<
  keyof typeof shortDateFormats,
  Intl.DateTimeFormat
>();

function shortDateFormatter(kind: keyof typeof shortDateFormats) {
  let formatter = shortDateFormatters.get(kind);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, shortDateFormats[kind]);
    shortDateFormatters.set(kind, formatter);
  }
  return formatter;
}
