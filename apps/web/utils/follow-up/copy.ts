import { ThreadTrackerType } from "@/generated/prisma/enums";
import * as he from "he";

const SNIPPET_MAX_CHARS = 1800;

export function getFollowUpCopy(trackerType: ThreadTrackerType) {
  const isAwaiting = trackerType === ThreadTrackerType.AWAITING;
  return {
    isAwaiting,
    directionLine: isAwaiting
      ? "正在等待对方回复你发送的邮件"
      : "你尚未回复这封邮件",
    counterpartyPrefix: isAwaiting
      ? "你将这封邮件发送给了"
      : "你收到了来自以下发件人的邮件：",
    snippetLabel: isAwaiting ? "你发送的邮件" : "等待你回复的邮件",
    emoji: isAwaiting ? "⏳" : "✍️",
  };
}

export function truncateSnippet(
  snippet: string,
  maxChars = SNIPPET_MAX_CHARS,
): string {
  const normalized = normalizeFollowUpSnippet(snippet);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

export function normalizeFollowUpText(text: string): string {
  return he.decode(text).replace(/\s+/g, " ").trim();
}

function normalizeFollowUpSnippet(text: string): string {
  return he
    .decode(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
