import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  describeCronExpression,
  type NamedCronWeekdays,
  parseCronSchedule,
} from "@/utils/automation-jobs/describe";

// utils/automation-jobs/describe 中的 describeCronSchedule 也会供 AI 助手使用，
// 因此它保持英文，界面使用这份已翻译的副本。
// 自定义星期组合和不常见的 cron 仍由 cronstrue 以英文提供。
export function describeCronScheduleText(
  cronExpression: string,
  i18n: I18n,
): string {
  const schedule = parseCronSchedule(cronExpression, i18n.locale);
  if (!schedule) return describeCronExpression(cronExpression);

  const days =
    schedule.weekdays.kind === "custom"
      ? schedule.weekdays.text
      : i18n._(WEEKDAY_MESSAGES[schedule.weekdays.kind]);
  const { localTimes, timeZoneName } = schedule;
  const lastTime = localTimes[localTimes.length - 1];
  const leadingTimes = localTimes.slice(0, -1).join(", ");
  const times =
    localTimes.length === 1
      ? lastTime
      : i18n._(msg`${leadingTimes} 和 ${lastTime}`);

  return i18n._(msg`${days} ${times} ${timeZoneName}`);
}

const WEEKDAY_MESSAGES: Record<NamedCronWeekdays, MessageDescriptor> = {
  everyDay: msg`每天`,
  weekdays: msg`工作日`,
  weekends: msg`周末`,
};
