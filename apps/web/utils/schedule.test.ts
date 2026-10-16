/**
 * 调度工具测试
 *
 * 本测试文件与时区无关，具体做法：
 * 1. 为所有测试设置 TZ=UTC
 * 2. 测试数据使用显式 UTC 日期
 * 3. 使用 createTestDate() 辅助函数保证日期创建一致
 *
 * 这确保测试在不同 CI 环境和本地开发机器上
 * 无论时区如何都能稳定通过。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  bitmaskToDayOfWeek,
  bitmaskToDaysOfWeek,
  calculateNextScheduleDate,
  createCanonicalTimeOfDay,
  DAYS,
  dayOfWeekToBitmask,
} from "./schedule";

const originalTimezone = process.env.TZ;
const DAY_CASES = [
  ["Sunday", 0, DAYS.SUNDAY, 0b100_0000],
  ["Monday", 1, DAYS.MONDAY, 0b010_0000],
  ["Tuesday", 2, DAYS.TUESDAY, 0b001_0000],
  ["Wednesday", 3, DAYS.WEDNESDAY, 0b000_1000],
  ["Thursday", 4, DAYS.THURSDAY, 0b000_0100],
  ["Friday", 5, DAYS.FRIDAY, 0b000_0010],
  ["Saturday", 6, DAYS.SATURDAY, 0b000_0001],
] as const;
const ALL_DAYS =
  DAYS.SUNDAY |
  DAYS.MONDAY |
  DAYS.TUESDAY |
  DAYS.WEDNESDAY |
  DAYS.THURSDAY |
  DAYS.FRIDAY |
  DAYS.SATURDAY;

beforeAll(() => {
  process.env.TZ = "UTC";
});

afterAll(() => {
  process.env.TZ = originalTimezone || "UTC";
});

function createTestDate(isoString: string): Date {
  return new Date(isoString);
}

describe("timezone setup", () => {
  it("should use UTC timezone for consistent test behavior", () => {
    const testDate = new Date("2024-01-15T10:00:00Z");
    expect(testDate.getTimezoneOffset()).toBe(0);
  });
});

describe("createCanonicalTimeOfDay", () => {
  it("should create a canonical date with specified time", () => {
    const result = createCanonicalTimeOfDay(9, 30);

    expect(result.getFullYear()).toBe(1970);
    expect(result.getMonth()).toBe(0); // 一月
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("should handle midnight", () => {
    const result = createCanonicalTimeOfDay(0, 0);

    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it("should handle end of day", () => {
    const result = createCanonicalTimeOfDay(23, 59);

    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
  });
});

describe("DAYS constant", () => {
  it.each(
    DAY_CASES,
  )("should have correct bitmask value for %s", (_, __, bitmask, expected) => {
    expect(bitmask).toBe(expected);
  });

  it("should allow combining days with bitwise OR", () => {
    const mondayWednesday = DAYS.MONDAY | DAYS.WEDNESDAY;
    expect(mondayWednesday).toBe(0b010_1000); // 40

    const weekends = DAYS.SATURDAY | DAYS.SUNDAY;
    expect(weekends).toBe(0b100_0001); // 65
  });
});

describe("dayOfWeekToBitmask", () => {
  it.each(
    DAY_CASES,
  )("should convert %s to the correct bitmask", (_, day, bitmask) => {
    expect(dayOfWeekToBitmask(day)).toBe(bitmask);
  });

  it("should throw error for invalid day values", () => {
    expect(() => dayOfWeekToBitmask(-1)).toThrow(
      "无效的星期几：-1。必须是 0 到 6 之间的整数。",
    );
    expect(() => dayOfWeekToBitmask(7)).toThrow(
      "无效的星期几：7。必须是 0 到 6 之间的整数。",
    );
    expect(() => dayOfWeekToBitmask(1.5)).toThrow(
      "无效的星期几：1.5。必须是 0 到 6 之间的整数。",
    );
  });
});

describe("bitmaskToDayOfWeek", () => {
  it.each(
    DAY_CASES,
  )("should convert %s bitmask to JavaScript day of week", (_, day, bitmask) => {
    expect(bitmaskToDayOfWeek(bitmask)).toBe(day);
  });

  it("should return null for empty bitmask", () => {
    expect(bitmaskToDayOfWeek(0)).toBeNull();
  });

  it("should return first day when multiple days are set", () => {
    // 星期日和星期三
    expect(bitmaskToDayOfWeek(DAYS.SUNDAY | DAYS.WEDNESDAY)).toBe(0);

    // 星期一和星期五
    expect(bitmaskToDayOfWeek(DAYS.MONDAY | DAYS.FRIDAY)).toBe(1);

    // 星期二、星期四、星期六
    expect(
      bitmaskToDayOfWeek(DAYS.TUESDAY | DAYS.THURSDAY | DAYS.SATURDAY),
    ).toBe(2);
  });

  it("should handle all days set", () => {
    expect(bitmaskToDayOfWeek(ALL_DAYS)).toBe(0);
  });
});

describe("bitmaskToDaysOfWeek", () => {
  it.each(
    DAY_CASES,
  )("should convert %s bitmask to array with single day", (_, day, bitmask) => {
    expect(bitmaskToDaysOfWeek(bitmask)).toEqual([day]);
  });

  it("should return empty array for empty bitmask", () => {
    expect(bitmaskToDaysOfWeek(0)).toEqual([]);
  });

  it("should return all days when multiple days are set", () => {
    // 星期日和星期三
    expect(bitmaskToDaysOfWeek(DAYS.SUNDAY | DAYS.WEDNESDAY)).toEqual([0, 3]);

    // 星期一、星期三、星期五
    expect(
      bitmaskToDaysOfWeek(DAYS.MONDAY | DAYS.WEDNESDAY | DAYS.FRIDAY),
    ).toEqual([1, 3, 5]);

    // 周末
    expect(bitmaskToDaysOfWeek(DAYS.SATURDAY | DAYS.SUNDAY)).toEqual([0, 6]);
  });

  it("should handle all days set", () => {
    expect(bitmaskToDaysOfWeek(ALL_DAYS)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("should return days in order from Sunday to Saturday", () => {
    // 混合顺序的输入应返回有序输出
    const mixedDays = DAYS.FRIDAY | DAYS.TUESDAY | DAYS.SUNDAY | DAYS.THURSDAY;
    expect(bitmaskToDaysOfWeek(mixedDays)).toEqual([0, 2, 4, 5]); // 星期日、星期二、星期四、星期五
  });
});

describe("calculateNextScheduleDate", () => {
  describe("null/undefined inputs", () => {
    it("should return null for null frequency", () => {
      const result = calculateNextScheduleDate(null as any);
      expect(result).toBeNull();
    });

    it("should return null for undefined frequency", () => {
      const result = calculateNextScheduleDate(undefined as any);
      expect(result).toBeNull();
    });

    it("should return null when no pattern is set", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z");
      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });
      expect(result).toBeNull();
    });
  });

  describe("interval days pattern", () => {
    it("should calculate next occurrence for daily schedule", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z");
      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为次日午夜
      expectScheduleDate(result, { date: 16, hours: 0, minutes: 0 });
    });

    it("should calculate next occurrence for weekly schedule", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 星期一
      const result = calculateNextScheduleDate({
        intervalDays: 7,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为下周同一天的午夜
      expectScheduleDate(result, { date: 22, hours: 0, minutes: 0 });
    });

    it("should handle multiple occurrences within interval", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z");
      const result = calculateNextScheduleDate({
        intervalDays: 7,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 2,
        lastOccurrenceAt: fromDate,
      });

      // 应为间隔开始后的 3.5 天
      expectScheduleDate(result, { date: 18, hours: 0, minutes: 0 });
    });

    it("should set specific time of day when provided", () => {
      const fromDate = new Date("2024-01-15T06:00:00Z");
      const timeOfDay = createCanonicalTimeOfDay(9, 30);

      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      expect(result?.getHours()).toBe(9);
      expect(result?.getMinutes()).toBe(30);
    });

    it("should move to next interval when current slots are past", () => {
      const fromDate = new Date("2024-01-15T23:00:00Z");
      const timeOfDay = createCanonicalTimeOfDay(9, 0);

      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为次日上午 9:00
      expectScheduleDate(result, { date: 16, hours: 9, minutes: 0 });
    });
  });

  describe("weekly pattern with specific days", () => {
    it("should find next occurrence on same day if time hasn't passed", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T08:00:00Z"); // UTC 星期一上午 8 点
      const timeOfDay = createCanonicalTimeOfDay(10, 0);

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.MONDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为当天上午 10:00
      expectScheduleDate(result, { date: 15, hours: 10, minutes: 0 });
    });

    it("should find next occurrence on next week when time has passed today", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T14:00:00Z"); // UTC 星期一下午 2 点
      const timeOfDay = createCanonicalTimeOfDay(10, 0); // 上午 10 点

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.MONDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 当前时间为 UTC 下午 2 点，但今天上午 10 点的调度时间已过，因此安排到下周一的上午 10:00
      expectScheduleDate(result, { date: 22, hours: 10, minutes: 0 });
    });

    it("should handle multiple days of week", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T12:00:00Z"); // 星期一
      const timeOfDay = createCanonicalTimeOfDay(9, 0);

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.MONDAY | DAYS.WEDNESDAY | DAYS.FRIDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为星期三上午 9:00
      expectScheduleDate(result, { date: 17, hours: 9, minutes: 0 });
    });

    it("should default to midnight when no timeOfDay is set", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T10:00:00Z"); // UTC 星期一上午 10 点

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.TUESDAY,
        timeOfDay: null,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为星期二午夜
      expectScheduleDate(result, { date: 16, hours: 0, minutes: 0 });
    });

    it("should skip to next week when current day midnight has passed", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T10:00:00Z"); // UTC 星期一上午 10 点

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.MONDAY,
        timeOfDay: null,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为下周一午夜（因为现在是上午 10 点，今天的午夜已经过去）
      expectScheduleDate(result, { date: 22, hours: 0, minutes: 0 });
    });

    it("should handle weekend schedule", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-15T10:00:00Z"); // 星期一
      const timeOfDay = createCanonicalTimeOfDay(11, 0);

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.SATURDAY | DAYS.SUNDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为星期六上午 11:00
      expectScheduleDate(result, { date: 20, hours: 11, minutes: 0 });
    });
  });

  describe("edge cases", () => {
    it("should handle leap year dates", () => {
      const fromDate = new Date("2024-02-28T10:00:00Z"); // 2024 年是闰年

      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为次日（2 月 29 日）午夜
      expectScheduleDate(result, {
        month: 1,
        date: 29,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle year boundary", () => {
      const fromDate = new Date("2024-12-31T10:00:00Z");

      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为次日（1 月 1 日）午夜
      expectScheduleDate(result, {
        year: 2025,
        month: 0,
        date: 1,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle daylight saving time transitions", () => {
      // 测试夏令时切换前后（随时区而异，但逻辑应保持一致）
      const fromDate = new Date("2024-03-10T10:00:00Z");
      const timeOfDay = createCanonicalTimeOfDay(14, 30);

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.SUNDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      expect(result?.getHours()).toBe(14);
      expect(result?.getMinutes()).toBe(30);
    });

    it("should prioritize intervalDays over daysOfWeek when both are set", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 星期一

      const result = calculateNextScheduleDate({
        intervalDays: 3,
        daysOfWeek: DAYS.TUESDAY, // 这应被忽略
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为 3 天后午夜
      expectScheduleDate(result, { date: 18, hours: 0, minutes: 0 });
    });
  });

  describe("real-world scenarios", () => {
    it("should handle daily digest at 9 AM", () => {
      const fromDate = new Date("2024-01-15T07:00:00Z");
      const timeOfDay = createCanonicalTimeOfDay(9, 0);

      const result = calculateNextScheduleDate({
        intervalDays: 1,
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为当天上午 9:00
      expectScheduleDate(result, { date: 15, hours: 9, minutes: 0 });
    });

    it("should handle weekly digest on Monday mornings", () => {
      const fromDate = new Date("2024-01-13T15:00:00Z"); // 星期六
      const timeOfDay = createCanonicalTimeOfDay(8, 0);

      const result = calculateNextScheduleDate({
        intervalDays: null,
        daysOfWeek: DAYS.MONDAY,
        timeOfDay,
        occurrences: null,
        lastOccurrenceAt: fromDate,
      });

      // 应为星期一上午 8:00
      expectScheduleDate(result, { date: 15, hours: 8, minutes: 0 });
    });

    it("should handle bi-weekly schedule with 2 occurrences", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z");

      const result = calculateNextScheduleDate({
        intervalDays: 14,
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 2,
        lastOccurrenceAt: fromDate,
      });

      // 应为 7 天后午夜
      expectScheduleDate(result, { date: 22, hours: 0, minutes: 0 });
    });

    it("should handle monthly schedule when time has passed today", () => {
      // 使用 UTC 日期以确保时区无关
      const fromDate = createTestDate("2024-01-10T16:00:00Z"); // UTC 1 月 10 日下午 4 点
      const timeOfDay = createCanonicalTimeOfDay(9, 0); // 上午 9 点

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 当前时间为 UTC 下午 4 点，但今天上午 9 点的调度时间已过，因此安排到下一个间隔（30 天后）
      expectScheduleDate(result, {
        month: 1,
        date: 9,
        hours: 9,
        minutes: 0,
      });
    });

    it("should handle monthly schedule when current day is past the 15th", () => {
      const fromDate = new Date("2024-01-20T10:00:00Z"); // 1 月 20 日
      const timeOfDay = createCanonicalTimeOfDay(15, 30);

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 当前时间为 UTC 上午 10 点，但下午 3:30 的调度时间尚未到，因此安排在当天下午 3:30
      expectScheduleDate(result, {
        month: 0,
        date: 20,
        hours: 15,
        minutes: 30,
      });
    });

    it("should handle monthly schedule with time that has passed today", () => {
      const fromDate = new Date("2024-01-15T16:00:00Z"); // 1 月 15 日下午 4 点
      const timeOfDay = createCanonicalTimeOfDay(10, 0); // 上午 10 点

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为 2 月 14 日上午 10:00（30 天后，因为今天的上午 10 点已过）
      expectScheduleDate(result, {
        month: 1,
        date: 14,
        hours: 10,
        minutes: 0,
      });
    });

    it("should handle monthly schedule across year boundary", () => {
      const fromDate = new Date("2024-12-15T10:00:00Z"); // 12 月 15 日

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为 1 月 14 日午夜（30 天后，跨年）
      expectScheduleDate(result, {
        year: 2025,
        month: 0,
        date: 14,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle monthly schedule with leap year", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 1 月 15 日，2024 年是闰年

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为 2 月 14 日午夜（30 天后，考虑闰年）
      expectScheduleDate(result, {
        month: 1,
        date: 14,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle monthly schedule with multiple occurrences", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 1 月 15 日

      const result = calculateNextScheduleDate({
        intervalDays: 30, // 约每月一次
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 2, // 30 天内的两次发生，
        lastOccurrenceAt: fromDate,
      });

      // 应为 1 月 30 日午夜（15 天后，第一次发生）
      expectScheduleDate(result, {
        month: 0,
        date: 30,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle very long intervals efficiently", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 1 月 15 日

      const result = calculateNextScheduleDate({
        intervalDays: 365, // 每年
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1,
        lastOccurrenceAt: fromDate,
      });

      // 应为明年午夜（365 天后，考虑闰年）
      expectScheduleDate(result, {
        year: 2025,
        month: 0,
        date: 14,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle very long intervals with many occurrences", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 1 月 15 日

      const result = calculateNextScheduleDate({
        intervalDays: 365, // 每年
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 365, // 一年内的每日发生，
        lastOccurrenceAt: fromDate,
      });

      // 应为次日午夜（一年内的第一次发生）
      expectScheduleDate(result, {
        month: 0,
        date: 16,
        hours: 0,
        minutes: 0,
      });
    });

    it("should handle extreme intervals efficiently", () => {
      const fromDate = new Date("2024-01-15T10:00:00Z"); // 1 月 15 日

      const result = calculateNextScheduleDate({
        intervalDays: 1000, // 很长的间隔
        daysOfWeek: null,
        timeOfDay: null,
        occurrences: 1000, // 多次发生，
        lastOccurrenceAt: fromDate,
      });

      // 应为次日午夜（间隔内的第一次发生）
      expectScheduleDate(result, {
        month: 0,
        date: 16,
        hours: 0,
        minutes: 0,
      });
    });
  });
});

describe("calculateNextScheduleDate - Bug Fix Tests", () => {
  describe("time drift bug fix", () => {
    it("should calculate next occurrence from lastOccurrenceAt, not current time", () => {
      // 本测试验证 30 分钟邮件摘要问题的修复
      // 该问题中每次处理都会让调度时间向前漂移

      const schedule = {
        intervalDays: 1, // 每天
        occurrences: 1,
        daysOfWeek: null,
        timeOfDay: createCanonicalTimeOfDay(0, 0), // 午夜
        lastOccurrenceAt: createTestDate("2024-01-15T00:00:00Z"), // 上次在午夜发送
      };

      // 修复后：应从 lastOccurrenceAt（午夜）计算
      const result = calculateNextScheduleDate(schedule);

      // 应为次日午夜（2024-01-16T00:00:00Z）
      expectScheduleDate(result, {
        date: 16,
        hours: 0,
        minutes: 0,
        seconds: 0,
      });
    });

    it("should handle missing lastOccurrenceAt by using current time", () => {
      // 测试 lastOccurrenceAt 为 null 时的回退行为
      const schedule = {
        intervalDays: 1,
        occurrences: 1,
        daysOfWeek: null,
        timeOfDay: createCanonicalTimeOfDay(9, 0), // 上午 9 点
        lastOccurrenceAt: null, // 没有上一次发生
      };

      const result = calculateNextScheduleDate(schedule);

      // 应从当前时间计算（回退行为）
      expect(result).not.toBeNull();
      // 确切时间取决于测试运行时刻，但应在未来
      expect(result!.getTime()).toBeGreaterThan(Date.now());
    });

    it("should maintain consistent daily schedule timing", () => {
      // 测试使用相同 lastOccurrenceAt 的多次调用产生相同结果
      const schedule = {
        intervalDays: 1,
        occurrences: 1,
        daysOfWeek: null,
        timeOfDay: createCanonicalTimeOfDay(14, 30), // 2:30 PM
        lastOccurrenceAt: createTestDate("2024-01-15T14:30:00Z"),
      };

      const result1 = calculateNextScheduleDate(schedule);
      const result2 = calculateNextScheduleDate(schedule);

      // 两次调用应产生相同结果
      expect(result1).toEqual(result2);
      expectScheduleDate(result1, { date: 16, hours: 14, minutes: 30 });
    });

    it("should prevent schedule drift in digest processing scenario", () => {
      // 模拟 bug 报告中的确切场景
      const originalScheduledTime = createTestDate("2024-01-15T00:00:00Z"); // 午夜

      const schedule = {
        intervalDays: 1,
        occurrences: 1,
        daysOfWeek: null,
        timeOfDay: createCanonicalTimeOfDay(0, 0), // 午夜
        lastOccurrenceAt: originalScheduledTime, // 使用原始调度时间
      };

      const result = calculateNextScheduleDate(schedule);

      // 应为次日午夜，而不是下午 12:36
      expectScheduleDate(result, { date: 16, hours: 0, minutes: 0 });

      // 这可防止 30 分钟的 cron 再次将该账号判定为“到期”
      // 因为下一次发生在午夜，而不是下午 12:36
    });
  });
});

function expectScheduleDate(
  result: Date | null | undefined,
  expected: {
    year?: number;
    month?: number;
    date?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  },
) {
  expect(result).not.toBeNull();
  expect(result).toBeDefined();

  if (expected.year !== undefined) {
    expect(result!.getFullYear()).toBe(expected.year);
  }
  if (expected.month !== undefined) {
    expect(result!.getMonth()).toBe(expected.month);
  }
  if (expected.date !== undefined) {
    expect(result!.getDate()).toBe(expected.date);
  }
  if (expected.hours !== undefined) {
    expect(result!.getHours()).toBe(expected.hours);
  }
  if (expected.minutes !== undefined) {
    expect(result!.getMinutes()).toBe(expected.minutes);
  }
  if (expected.seconds !== undefined) {
    expect(result!.getSeconds()).toBe(expected.seconds);
  }
}
