import type { Schedule } from "@/generated/prisma/client";
import { addDays } from "date-fns";

/**
 * 使用 Unix 纪元（1970-01-01）创建规范化的 timeOfDay Date 对象。
 * 这能确保所有 timeOfDay 用法保持一致，同时保留时区信息。
 *
 * @param hours - 24 小时制的小时（0-23）
 * @param minutes - 分钟（0-59）
 * @returns 带有规范化日期和指定时间的 Date 对象
 */
export function createCanonicalTimeOfDay(hours: number, minutes: number): Date {
  return new Date(1970, 0, 1, hours, minutes, 0, 0);
}

/**
 * 一周中各天的位掩码表示。
 * 每一位代表一天，从星期日（最高位）到星期六（最低位）。
 * 例如：0b1000000 (64) 表示星期日，0b0100000 (32) 表示星期一，依此类推。
 *
 * 要组合多天，使用按位或运算符（|）：
 * SUNDAY | WEDNESDAY = 0b1000000 | 0b0001000 = 0b1001000
 */
export const DAYS = {
  SUNDAY: 0b100_0000, // 64
  MONDAY: 0b010_0000, // 32
  TUESDAY: 0b001_0000, // 16
  WEDNESDAY: 0b000_1000, // 8
  THURSDAY: 0b000_0100, // 4
  FRIDAY: 0b000_0010, // 2
  SATURDAY: 0b000_0001, // 1
};

/**
 * 将 JavaScript 的星期几（0-6，星期日到星期六）转换为对应的位掩码。
 * @param jsDay - JavaScript 的星期几（0 = 星期日，6 = 星期六）
 * @returns 该天对应的位掩码
 */
const maskFor = (jsDay: number) => 1 << (6 - jsDay);

/**
 * 将 JavaScript 的星期几（0-6，星期日到星期六）转换为对应的位掩码。
 * 这是内部 maskFor 函数的公开版本。
 *
 * @param jsDay - JavaScript 的星期几（0 = 星期日，6 = 星期六）
 * @returns 该天对应的位掩码
 * @throws 如果 jsDay 不在 0 到 6 之间则抛出错误
 *
 * @example
 * // 将星期日（0）转换为位掩码
 * const sundayMask = dayOfWeekToBitmask(0); // 返回 64 (0b1000000)
 *
 * // 将星期三（3）转换为位掩码
 * const wednesdayMask = dayOfWeekToBitmask(3); // 返回 8 (0b0001000)
 */
export function dayOfWeekToBitmask(jsDay: number): number {
  if (jsDay < 0 || jsDay > 6 || !Number.isInteger(jsDay)) {
    throw new Error(`无效的星期几：${jsDay}。必须是 0 到 6 之间的整数。`);
  }
  return maskFor(jsDay);
}

/**
 * 将位掩码转换回它所表示的第一个 JavaScript 星期几（0-6，星期日到星期六）。
 * 如果位掩码中设置了多天，则返回找到的第一天（星期日优先）。
 *
 * @param bitmask - 星期几的位掩码
 * @returns 第一个 JavaScript 星期几（0-6）；如果未设置任何天则返回 null
 *
 * @example
 * // 将星期日位掩码转换为 JS 星期几
 * const day = bitmaskToDayOfWeek(64); // 返回 0（星期日）
 *
 * // 将星期三位掩码转换为 JS 星期几
 * const day = bitmaskToDayOfWeek(8); // 返回 3（星期三）
 *
 * // 设置了多天 - 返回第一个
 * const day = bitmaskToDayOfWeek(64 | 8); // 返回 0（星期日，找到的第一天）
 */
export function bitmaskToDayOfWeek(bitmask: number): number | null {
  if (bitmask === 0) return null;

  for (let jsDay = 0; jsDay < 7; jsDay++) {
    if (bitmask & maskFor(jsDay)) {
      return jsDay;
    }
  }
  return null;
}

/**
 * 获取位掩码中表示的所有 JavaScript 星期几（0-6，星期日到星期六）。
 *
 * @param bitmask - 星期几的位掩码
 * @returns 位掩码中设置的 JavaScript 星期几数字（0-6）数组
 *
 * @example
 * // 从包含多天的位掩码中获取所有天
 * const days = bitmaskToDaysOfWeek(64 | 8); // 返回 [0, 3]（星期日和星期三）
 */
export function bitmaskToDaysOfWeek(bitmask: number): number[] {
  const days: number[] = [];
  for (let jsDay = 0; jsDay < 7; jsDay++) {
    if (bitmask & maskFor(jsDay)) {
      days.push(jsDay);
    }
  }
  return days;
}

/**
 * 根据调度设置计算下一次发生日期。
 *
 * @param schedule - 调度配置
 * @param schedule.daysOfWeek - 一周中各天的位掩码（参见 DAYS 常量）
 * @param schedule.intervalDays - 两次发生之间的天数
 * @param schedule.timeOfDay - 发生的时间（如果未设置，默认为午夜）
 * @param schedule.occurrences - 间隔内的发生次数
 * @param schedule.lastOccurrenceAt - 上次发生时间（用作参考点）
 * @returns 下一次发生日期；如果找不到有效模式则返回 null
 */
export function calculateNextScheduleDate(
  frequency: Pick<
    Schedule,
    "intervalDays" | "daysOfWeek" | "timeOfDay" | "occurrences"
  > &
    Partial<Pick<Schedule, "lastOccurrenceAt">>,
): Date | null {
  if (!frequency) return null;

  const { intervalDays, daysOfWeek, timeOfDay, occurrences, lastOccurrenceAt } =
    frequency;

  const fromDate = lastOccurrenceAt || new Date();

  // 设置一天中时间的辅助函数
  function setTime(date: Date) {
    if (timeOfDay) {
      // 从规范化日期中提取时间（1970-01-01T00:00:00Z + 时间）
      // timeOfDay 应始终使用规范化日期以保持一致
      const hours = timeOfDay.getHours();
      const minutes = timeOfDay.getMinutes();
      date.setHours(hours, minutes, 0, 0);
    } else {
      // 未设置具体时间时重置为午夜
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  // 针对间隔天数模式（例如每 7 天）
  if (intervalDays) {
    const occ = occurrences && occurrences > 1 ? occurrences : 1;
    const slotLength = intervalDays / occ;

    // 找到当前间隔的起点
    const intervalStart = new Date(fromDate);
    intervalStart.setHours(0, 0, 0, 0);

    // 找到下一个时间槽
    for (let i = 0; i < occ; i++) {
      // 计算以天为单位的时间槽偏移（保留小数间隔）
      const dayOffset = i * slotLength;
      const slotDate = addDays(intervalStart, dayOffset);
      setTime(slotDate);

      if (slotDate > fromDate) {
        return slotDate;
      }
    }
    // 如果该间隔的所有时间槽都在过去，则返回下一个间隔的第一个时间槽
    const nextIntervalStart = addDays(intervalStart, intervalDays);
    setTime(nextIntervalStart);
    return nextIntervalStart;
  }

  // 针对指定星期几的每周模式
  if (daysOfWeek) {
    const currentDayOfWeek = fromDate.getDay();

    // 从今天开始，找到匹配该模式的下一天
    let daysToAdd = 0;
    while (daysToAdd < 14) {
      // 最多允许 2 周来找到下一次发生
      const nextDayOfWeek = (currentDayOfWeek + daysToAdd) % 7;
      const nextDayMask = maskFor(nextDayOfWeek);

      if (daysOfWeek & nextDayMask) {
        const nextDate = addDays(fromDate, daysToAdd);

        // 如果设置了 timeOfDay，则设置时间
        if (timeOfDay) {
          // 从规范化日期中提取时间（1970-01-01T00:00:00Z + 时间）
          const hours = timeOfDay.getHours();
          const minutes = timeOfDay.getMinutes();
          nextDate.setHours(hours, minutes, 0, 0);

          // 如果这是今天（daysToAdd === 0）且时间已经过去，
          // 则继续到下一天
          if (daysToAdd === 0 && nextDate <= fromDate) {
            daysToAdd++;
            continue;
          }
          return nextDate;
        }

        // 未设置 timeOfDay 时将时间重置为 00:00:00，以防止时间漂移
        nextDate.setHours(0, 0, 0, 0);

        // 如果这是今天（daysToAdd === 0）且午夜已经过去，
        // 则继续到下一天
        if (daysToAdd === 0 && nextDate <= fromDate) {
          daysToAdd++;
          continue;
        }
        return nextDate;
      }

      daysToAdd++;
    }
  }

  // 如果找不到有效模式
  return null;
}
