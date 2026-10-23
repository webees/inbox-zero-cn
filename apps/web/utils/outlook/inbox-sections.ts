export const OUTLOOK_INBOX_SECTIONS = [
  { name: "重点", type: "focused" },
  { name: "其他", type: "other" },
] as const;

export type OutlookInboxSection =
  (typeof OUTLOOK_INBOX_SECTIONS)[number]["type"];

export function isOutlookInboxSection(
  value: string,
): value is OutlookInboxSection {
  return OUTLOOK_INBOX_SECTIONS.some((section) => section.type === value);
}
