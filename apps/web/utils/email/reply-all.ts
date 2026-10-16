import type { ParsedMessageHeaders } from "@/utils/types";
import { extractEmailAddress, splitRecipientList } from "@/utils/email";

export interface ReplyAllRecipients {
  cc: string[];
  to: string;
}

/**
 * 通过包含原始 TO 和 CC 收件人来构建回复全部收件人。
 * 回复发送给原始发件人，CC 包含所有其他收件人。
 *
 * @param headers - Original email headers
 * @param overrideTo - Optional override for the TO field (e.g., for drafts)
 * @param currentUserEmails - Current user's email addresses to exclude from CC
 * @returns Object with TO and CC recipients for reply-all
 */
export function buildReplyAllRecipients(
  headers: ParsedMessageHeaders,
  overrideTo: string | undefined,
  currentUserEmails: string | string[],
): ReplyAllRecipients {
  // 确定主要收件人（TO 字段）
  const replyToRaw = overrideTo || headers["reply-to"] || headers.from;
  const replyTo = extractEmailAddress(replyToRaw);

  const currentUserEmailSet = new Set(
    (Array.isArray(currentUserEmails) ? currentUserEmails : [currentUserEmails])
      .map((email) => extractEmailAddress(email).toLowerCase())
      .filter(Boolean),
  );

  // 为回复全部行为构建 CC 列表
  const ccSet = new Set<string>();
  const seenEmails = new Set<string>();

  addHeaderRecipientsToCcSet({
    headerValue: headers.cc,
    replyTo,
    currentUserEmailSet,
    seenEmails,
    ccSet,
  });
  addHeaderRecipientsToCcSet({
    headerValue: headers.to,
    replyTo,
    currentUserEmailSet,
    seenEmails,
    ccSet,
  });

  return {
    to: replyToRaw, // 为 TO 字段保留原始格式
    cc: Array.from(ccSet),
  };
}

/**
 * 将 CC 收件人数组转换为逗号分隔的字符串。
 * 如果数组为空则返回 undefined。
 */
export function formatCcList(ccList: string[]): string | undefined {
  return ccList.length > 0 ? ccList.join(", ") : undefined;
}

/**
 * 将手动输入的 CC/BCC 收件人与现有收件人合并，
 * 确保去重和清理。
 */
export function mergeAndDedupeRecipients(
  existing: string[],
  manual: string | undefined,
): string[] {
  const result = [...existing];
  const seen = new Set(
    existing.map((e) => extractEmailAddress(e).toLowerCase()),
  );

  if (manual) {
    const manualEntries = splitRecipientList(manual);

    for (const entry of manualEntries) {
      const email = extractEmailAddress(entry);
      if (email) {
        const key = email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(entry);
        }
      }
    }
  }

  return result;
}

function addHeaderRecipientsToCcSet({
  headerValue,
  replyTo,
  currentUserEmailSet,
  seenEmails,
  ccSet,
}: {
  headerValue: string | undefined;
  replyTo: string;
  currentUserEmailSet: Set<string>;
  seenEmails: Set<string>;
  ccSet: Set<string>;
}) {
  if (!headerValue) return;

  const headerEmails = splitRecipientList(headerValue)
    .map((entry) => extractEmailAddress(entry))
    .filter((email) => {
      if (!email) return false;

      const normalizedEmail = email.toLowerCase();
      return (
        normalizedEmail !== replyTo.toLowerCase() &&
        !currentUserEmailSet.has(normalizedEmail)
      );
    });

  for (const email of headerEmails) {
    const key = email.toLowerCase();
    if (!seenEmails.has(key)) {
      seenEmails.add(key);
      ccSet.add(email);
    }
  }
}
