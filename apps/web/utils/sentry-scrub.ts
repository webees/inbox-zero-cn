import type { Event } from "@sentry/nextjs";
import {
  CONTENT_FIELD_NAMES,
  normalizeRedactionFieldName,
  REDACTED_FIELD_NAMES,
  SENSITIVE_FIELD_NAMES,
} from "@/utils/redact-fields";

const REDACTED = "[redacted]";
const MAX_DEPTH = 10;

const REDACT_KEYS = new Set<string>(
  [
    ...REDACTED_FIELD_NAMES,
    ...CONTENT_FIELD_NAMES,
    ...SENSITIVE_FIELD_NAMES,
  ].map(normalizeRedactionFieldName),
);

// Sentry 是第三方。在发送事件之前，从 captureException 上下文和请求数据
// 所落入的字段中脱敏 PII/密钥。我们采用脱敏（而非哈希），以便在客户端和
// 边缘环境中保持安全（不依赖 node:crypto）。event.user.email 有意保留：
// 它是已认证用户自己的邮箱，日志策略允许记录。
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.extra) event.extra = redactPii(event.extra);
  if (event.contexts) event.contexts = redactPii(event.contexts);
  if (event.request) {
    const { data, headers, cookies } = event.request;
    if (data) event.request.data = redactPii(data);
    if (headers) event.request.headers = redactPii(headers);
    if (cookies) event.request.cookies = redactPii(cookies);
  }
  return event;
}

// 在所有运行时中作为 beforeSend / beforeSendTransaction 接入 Sentry.init。
// scrubSentryEvent 对事件类型是泛型的，因此会在每个调用点实例化为
// ErrorEvent / TransactionEvent（两者共享被脱敏的字段）。使用别名而不是
// 重新声明类型，以避免导入 @sentry/nextjs 未再导出的 TransactionEvent。
export const beforeSend = scrubSentryEvent;
export const beforeSendTransaction = scrubSentryEvent;

function redactPii<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactPii(item, depth + 1)) as T;
  }

  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = REDACT_KEYS.has(normalizeRedactionFieldName(key))
      ? REDACTED
      : redactPii(nested, depth + 1);
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
