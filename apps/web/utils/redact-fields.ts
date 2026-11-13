// 由 logger（在日志中哈希/脱敏）和 Sentry 清理器（在发送给第三方之前脱敏）
// 共享的字段名集合。仅使用纯字符串 Set —— 不涉及 env、不涉及 crypto ——
// 因此可安全用于客户端和边缘 bundle。

// PII 标识符（通信方地址）。在日志中哈希，在 Sentry 中脱敏。
export const SENSITIVE_FIELD_NAMES = new Set([
  "from",
  "sender",
  "to",
  "replyTo",
]);

// 绝不能离开进程的密钥和编码载荷。
export const REDACTED_FIELD_NAMES = new Set([
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "headers",
  "set-cookie",
  "authorization",
  "requestBodyValues",
  "raw",
  "receivedState",
  "systemInstruction",
  "contents",
]);

// 邮件/消息内容。
export const CONTENT_FIELD_NAMES = new Set([
  "text",
  "body",
  "content",
  "subject",
  "textPlain",
  "textHtml",
  "snippet",
  "decodedSnippet",
]);

export function normalizeRedactionFieldName(fieldName: string) {
  return fieldName.toLowerCase().replace(/[\s_-]/g, "");
}
