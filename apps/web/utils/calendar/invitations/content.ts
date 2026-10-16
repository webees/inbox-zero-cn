import { getCalendarInvitationIdentity } from "@/utils/calendar/invitations/parser";

export function normalizeCalendarInvitationContent(content: string) {
  // MIME 解析器会规范化 CRLF 和末尾换行；Graph 下载会保留它们。
  const normalized = content.replaceAll("\r\n", "\n");
  let end = normalized.length;
  while (normalized[end - 1] === "\n") end--;
  return normalized.slice(0, end);
}

export function isSameCalendarInvitation(first: string, second: string) {
  const a = normalizeCalendarInvitationContent(first);
  const b = normalizeCalendarInvitationContent(second);
  if (a === b) return true;
  // Exchange 会重新生成 MIME 日历部分但保留发件人的 .ics
  // 附件，因此同一邀请的副本可能逐字节不同。
  const revision = getInvitationRevision(a);
  return revision !== null && revision === getInvitationRevision(b);
}

function getInvitationRevision(content: string) {
  try {
    const identity = getCalendarInvitationIdentity(content);
    if (!identity) return null;
    const { method, uid, organizer, sequence, recurrenceId } = identity;
    return JSON.stringify([method, uid, organizer, sequence, recurrenceId]);
  } catch {
    return null;
  }
}
