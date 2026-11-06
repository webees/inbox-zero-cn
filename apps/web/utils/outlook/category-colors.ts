export const OUTLOOK_CATEGORY_COLORS = [
  { id: "preset0", name: "红色", value: "#E74C3C" },
  { id: "preset1", name: "橙色", value: "#E67E22" },
  { id: "preset2", name: "棕色", value: "#795548" },
  { id: "preset3", name: "黄色", value: "#F1C40F" },
  { id: "preset4", name: "绿色", value: "#2ECC71" },
  { id: "preset5", name: "青色", value: "#1ABC9C" },
  { id: "preset6", name: "橄榄色", value: "#808000" },
  { id: "preset7", name: "蓝色", value: "#3498DB" },
  { id: "preset8", name: "紫色", value: "#9B59B6" },
  { id: "preset9", name: "蔓越莓色", value: "#E84393" },
  { id: "preset10", name: "钢灰色", value: "#AEB6BF" },
  { id: "preset11", name: "深钢灰色", value: "#5D6D7E" },
  { id: "preset12", name: "灰色", value: "#BDC3C7" },
  { id: "preset13", name: "深灰色", value: "#7F8C8D" },
  { id: "preset14", name: "黑色", value: "#2C3E50" },
  { id: "preset15", name: "深红色", value: "#922B21" },
  { id: "preset16", name: "深橙色", value: "#A04000" },
  { id: "preset17", name: "深棕色", value: "#6E2C00" },
  { id: "preset18", name: "深黄色", value: "#9A7D0A" },
  { id: "preset19", name: "深绿色", value: "#196F3D" },
  { id: "preset20", name: "深青色", value: "#0E6655" },
  { id: "preset21", name: "深橄榄色", value: "#556B2F" },
  { id: "preset22", name: "深蓝色", value: "#1A5276" },
  { id: "preset23", name: "深紫色", value: "#5B2C6F" },
  { id: "preset24", name: "深蔓越莓色", value: "#7B241C" },
] as const;

export type OutlookCategoryColor =
  (typeof OUTLOOK_CATEGORY_COLORS)[number]["id"];

export const OUTLOOK_CATEGORY_COLOR_IDS = OUTLOOK_CATEGORY_COLORS.map(
  ({ id }) => id,
) as [OutlookCategoryColor, ...OutlookCategoryColor[]];

export const OUTLOOK_CATEGORY_COLOR_MAP = Object.fromEntries(
  OUTLOOK_CATEGORY_COLORS.map(({ id, value }) => [id, value]),
) as Record<OutlookCategoryColor, string>;

export function getOutlookCategoryPreset(
  backgroundColor: string,
): OutlookCategoryColor | undefined {
  return OUTLOOK_CATEGORY_COLORS.find(
    (option) => option.value.toLowerCase() === backgroundColor.toLowerCase(),
  )?.id;
}
