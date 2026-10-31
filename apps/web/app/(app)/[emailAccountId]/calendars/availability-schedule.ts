export type AvailabilityWindowInput = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
};

export type Range = { start: string; end: string };
export type DayState = { enabled: boolean; ranges: Range[] };

export const DAY_LABELS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

// 周一到周五，9:00 到 17:00。与创建预约链接时生成的默认时间表保持一致，
// 让独立编辑器开箱即用。
export const DEFAULT_WEEKDAY_WINDOWS: AvailabilityWindowInput[] = [
  1, 2, 3, 4, 5,
].map((weekday) => ({
  weekday,
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
}));

export function buildDayState(windows: AvailabilityWindowInput[]): DayState[] {
  const byDay = new Map<number, Range[]>();
  for (const window of windows) {
    const list = byDay.get(window.weekday) ?? [];
    list.push({
      start: minutesToTime(window.startMinutes),
      end: minutesToTime(window.endMinutes),
    });
    byDay.set(window.weekday, list);
  }
  return DAY_LABELS.map((_, weekday) => {
    const ranges = byDay.get(weekday) ?? [];
    return ranges.length
      ? { enabled: true, ranges }
      : { enabled: false, ranges: [] };
  });
}

export function collectWindows(
  days: DayState[],
):
  | { windows: AvailabilityWindowInput[]; error: null }
  | { windows: null; error: string } {
  const windows: AvailabilityWindowInput[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const day = days[weekday];
    if (!day.enabled) continue;
    const dayWindows: AvailabilityWindowInput[] = [];
    for (const range of day.ranges) {
      const start = parseTime(range.start);
      const end = parseTime(range.end);
      if (start === null || end === null || end <= start) {
        return {
          windows: null,
          error: `${DAY_LABELS[weekday]}：结束时间必须晚于开始时间。`,
        };
      }
      dayWindows.push({ weekday, startMinutes: start, endMinutes: end });
    }
    dayWindows.sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 1; i < dayWindows.length; i++) {
      if (dayWindows[i].startMinutes < dayWindows[i - 1].endMinutes) {
        return {
          windows: null,
          error: `${DAY_LABELS[weekday]}：时间段重叠。`,
        };
      }
    }
    windows.push(...dayWindows);
  }

  if (windows.length === 0) {
    return { windows: null, error: "至少添加一个可用时间段。" };
  }

  return { windows, error: null };
}

export function nextRangeAfter(previous?: Range): Range {
  if (!previous) return { start: "09:00", end: "17:00" };
  const previousEnd = parseTime(previous.end) ?? 17 * 60;
  const start = Math.min(previousEnd + 30, 23 * 60);
  const end = Math.min(start + 60, 24 * 60 - 1);
  return { start: minutesToTime(start), end: minutesToTime(end) };
}

export function parseTime(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
