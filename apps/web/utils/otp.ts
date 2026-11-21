import type { EmailThread } from "@/utils/email/types";
import { getMessageTimestamp } from "@/utils/email/message-timestamp";
import type { ParsedMessage } from "@/utils/types";

const OTP_SUBJECT_PATTERNS = [
  /\botp\b/i,
  /\bone[- ]time (?:code|password|passcode|pin)\b/i,
  /\b(?:verification|security|login|sign[ -]?in|authentication|confirmation|access|temporary) code\b/i,
  /\b(?:2fa|two[- ]factor(?: authentication)?) code\b/i,
  /\b(?:code|pin) (?:for|to) (?:log|sign) in\b/i,
] as const;

// 数字（可选拆成两组，或带有类似 "G-" 的短前缀），或字母与数字混合的
// 令牌。紧邻且延续数字的标点会排除价格、时间、日期和电话号码。
const OTP_CODE_PATTERN =
  /(?<![\w.,/$€£#+-]|\d[ -]|\d:|\) )(?:[A-Z]{1,3}-)?(\d{3,4}[ -]\d{3,4}|\d{4,8}|(?=[A-Z\d]*\d)(?=[A-Z\d]*[A-Z])[A-Z\d]{6,8})(?![\w%]|[.,:/ -]\d)/g;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;

export const OTP_MAX_AGE_MS = 15 * 60 * 1000;

export function isOtpSubject(subject: string): boolean {
  return OTP_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
}

/** 要粘贴的验证码，取自第一个包含验证码的文本。 */
export function extractOtpCode(texts: string[]): string | null {
  for (const text of texts) {
    for (const match of text.matchAll(OTP_CODE_PATTERN)) {
      const code = match[1].replace(/[ -]/g, "");
      if (!YEAR_PATTERN.test(code)) return code;
    }
  }
  return null;
}

export function isRecentOtpMessage(
  message: ParsedMessage,
  now = new Date(),
): boolean {
  const receivedAt = getMessageTimestamp(message);
  const currentTime = now.getTime();

  return (
    Number.isFinite(receivedAt) &&
    receivedAt >= currentTime - OTP_MAX_AGE_MS &&
    receivedAt <= currentTime &&
    isOtpSubject(message.subject)
  );
}

export function getRecentOtpThreads(
  threads: EmailThread[],
  now = new Date(),
): EmailThread[] {
  return threads.flatMap((thread) => {
    const messages = thread.messages.filter((message) =>
      isRecentOtpMessage(message, now),
    );
    return messages.length > 0 ? [{ ...thread, messages }] : [];
  });
}
