export const DEFAULT_AUTOMATION_JOB_CRON = "0 9,14 * * 1-5";

export const AUTOMATION_CRON_PRESETS = [
  {
    id: "TWICE_DAILY",
    label: "每天两次",
    cronExpression: DEFAULT_AUTOMATION_JOB_CRON,
  },
  {
    id: "MORNING",
    label: "早晨",
    cronExpression: "0 9 * * 1-5",
  },
  {
    id: "EVENING",
    label: "晚上",
    cronExpression: "0 17 * * 1-5",
  },
] as const;

export function getDefaultAutomationJobName() {
  return "定时检查";
}
