// Define the steps of the flow
export enum CleanStep {
  INTRO = 0,
  ARCHIVE_OR_READ = 1,
  TIME_RANGE = 2,
  LABEL_OPTIONS = 3,
  FINAL_CONFIRMATION = 4,
}

export const timeRangeOptions = [
  { value: "0", label: "所有邮件" },
  { value: "1", label: "超过 1 天" },
  { value: "3", label: "超过 3 天" },
  { value: "7", label: "超过 1 周", recommended: true },
  { value: "14", label: "超过 2 周" },
  { value: "30", label: "超过 1 个月" },
  { value: "90", label: "超过 3 个月" },
  { value: "365", label: "超过 1 年" },
];
