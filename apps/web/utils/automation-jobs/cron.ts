import { addMinutes } from "date-fns";

const CRON_PART_COUNT = 5;
const MAX_SEARCH_MINUTES = 60 * 24 * 366;

type ParsedAutomationCron = {
  minutes: Set<number> | null;
  hours: Set<number> | null;
  weekdays: Set<number> | null;
};

export function validateAutomationCronExpression(cronExpression: string) {
  parseAutomationCronExpression(cronExpression);
}

export function getNextAutomationJobRunAt({
  cronExpression,
  fromDate,
}: {
  cronExpression: string;
  fromDate: Date;
}): Date {
  const parsed = parseAutomationCronExpression(cronExpression);

  const candidate = new Date(fromDate);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    if (matchesCronAtUtc(parsed, candidate)) {
      return candidate;
    }

    const nextMinute = addMinutes(candidate, 1);
    candidate.setTime(nextMinute.getTime());
  }

  throw new Error(
    `在 ${MAX_SEARCH_MINUTES} 分钟内找不到 cron 的下一次运行时间：${cronExpression}`,
  );
}

function parseAutomationCronExpression(
  cronExpression: string,
): ParsedAutomationCron {
  const parts = cronExpression.trim().split(/\s+/);

  if (parts.length !== CRON_PART_COUNT) {
    throw new Error(
      `无效的 cron 表达式：期望 ${CRON_PART_COUNT} 个字段，实际得到 ${parts.length} 个`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth !== "*" || month !== "*") {
    throw new Error("自动化 cron 仅支持通配符形式的日期和月份");
  }

  return {
    minutes: parseCronField({
      field: minute,
      min: 0,
      max: 59,
      label: "分钟",
      normalize: identity,
    }),
    hours: parseCronField({
      field: hour,
      min: 0,
      max: 23,
      label: "小时",
      normalize: identity,
    }),
    weekdays: parseCronField({
      field: dayOfWeek,
      min: 0,
      max: 7,
      label: "星期",
      normalize: normalizeDayOfWeek,
    }),
  };
}

function matchesCronAtUtc(parsed: ParsedAutomationCron, date: Date) {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const weekday = date.getUTCDay();

  const minuteMatches = !parsed.minutes || parsed.minutes.has(minute);
  const hourMatches = !parsed.hours || parsed.hours.has(hour);
  const weekdayMatches = !parsed.weekdays || parsed.weekdays.has(weekday);

  return minuteMatches && hourMatches && weekdayMatches;
}

function parseCronField({
  field,
  min,
  max,
  label,
  normalize,
}: {
  field: string;
  min: number;
  max: number;
  label: string;
  normalize: (value: number) => number;
}): Set<number> | null {
  if (field === "*") return null;

  const values = new Set<number>();
  const segments = field.split(",");

  for (const segment of segments) {
    const token = segment.trim();
    if (!token) {
      throw new Error(`${label}字段中存在无效的空片段`);
    }

    const stepParts = token.split("/");
    if (stepParts.length > 2) {
      throw new Error(`${label} 标记 ${token} 无效：步长分隔符过多`);
    }

    const [rangeToken, stepToken] = stepParts;
    const step = stepToken ? parseStep(stepToken, label) : 1;

    const [rangeStart, rangeEnd] = parseRangeToken({
      token: rangeToken,
      min,
      max,
      label,
    });

    for (let value = rangeStart; value <= rangeEnd; value += step) {
      const normalized = normalize(value);

      if (normalized < min || normalized > max) {
        throw new Error(
          `${label}字段中的值 ${normalized} 无效。期望 ${min}-${max}`,
        );
      }

      values.add(normalized);
    }
  }

  if (!values.size) {
    throw new Error(`${label}字段未解析出任何值`);
  }

  return values;
}

function parseRangeToken({
  token,
  min,
  max,
  label,
}: {
  token: string;
  min: number;
  max: number;
  label: string;
}): [number, number] {
  if (token === "*") return [min, max];

  if (token.includes("-")) {
    const rangeParts = token.split("-");
    if (rangeParts.length !== 2) {
      throw new Error(`${label} 标记 ${token} 无效：范围分隔符过多`);
    }

    const [startToken, endToken] = rangeParts;
    const start = parsePositiveInt(startToken, `${label}范围起点`);
    const end = parsePositiveInt(endToken, `${label}范围终点`);

    if (start > end) {
      throw new Error(`${label}范围 ${token} 无效：起点必须小于等于终点`);
    }

    if (start < min || end > max) {
      throw new Error(`${label}范围 ${token} 无效：期望 ${min}-${max}`);
    }

    return [start, end];
  }

  const value = parsePositiveInt(token, label);

  if (value < min || value > max) {
    throw new Error(`${label}值 ${value} 无效：期望 ${min}-${max}`);
  }

  return [value, value];
}

function parsePositiveInt(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label}无效：${value}`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label}无效：${value}`);
  }

  if (parsed <= 0 && value !== "0") {
    throw new Error(`${label}无效：${value}`);
  }

  return parsed;
}

function parseStep(value: string, label: string) {
  const step = parsePositiveInt(value, `${label}步长`);
  if (step <= 0) throw new Error(`${label}步长无效：${value}`);
  return step;
}

function normalizeDayOfWeek(value: number) {
  return value === 7 ? 0 : value;
}

function identity(value: number) {
  return value;
}
