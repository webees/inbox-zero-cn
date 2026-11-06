import { createScopedLogger, type Logger } from "@/utils/logger";
import { isFetchError } from "@/utils/retry/is-fetch-error";
import { getRetryAfterHeaderFromError } from "@/utils/retry/get-retry-after-header";
import {
  getRetryAfterDelayMs,
  type ProviderRetryPolicy,
  withProviderRetry,
} from "@/utils/retry/provider-retry";

const logger = createScopedLogger("gmail-retry");
export const MAX_GMAIL_BLOCKING_RETRY_DELAY_MS = 10_000;

interface RetryLogContext {
  logger?: Logger;
}

interface ErrorInfo {
  code?: string;
  errorMessage: string;
  googleErrorStatus?: string;
  reason?: string;
  status?: number;
}

/**
 * 在遇到限流或临时服务器错误时重试 Gmail API 操作
 * - 限流：429、带特定原因的 403
 * - 服务器错误：502、503、504
 */
export async function withGmailRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
  context?: RetryLogContext,
): Promise<T> {
  return withGmailRetryPolicy(operation, maxRetries, context, "all");
}

/** 仅当 Gmail 明确以限流为由拒绝时，才重试结果不确定的发送操作。 */
export async function withGmailNonIdempotentWriteRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
  context?: RetryLogContext,
): Promise<T> {
  return withGmailRetryPolicy(
    operation,
    maxRetries,
    context,
    "rate-limit-only",
  );
}

async function withGmailRetryPolicy<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  context: RetryLogContext | undefined,
  retryPolicy: ProviderRetryPolicy,
): Promise<T> {
  return withProviderRetry(operation, {
    providerName: "Gmail",
    logger: context?.logger || logger,
    maxRetries,
    maxBlockingDelayMs: MAX_GMAIL_BLOCKING_RETRY_DELAY_MS,
    retryPolicy,
    classify: (attempt) => {
      const errorInfo = extractErrorInfo(attempt.error);
      const { retryable, isRateLimit, isServerError, isFailedPrecondition } =
        isRetryableError(errorInfo);
      const retryAfterHeader = getRetryAfterHeaderFromError(attempt.error);

      return {
        retryable,
        isRateLimit,
        delayMs: calculateRetryDelay(
          isRateLimit,
          isServerError,
          isFailedPrecondition,
          attempt.attemptNumber,
          retryAfterHeader,
          errorInfo.errorMessage,
        ),
        logFields: {
          ...buildRetryLogFields(errorInfo),
          retryAfterHeader,
          retryAfterFromMessage: parseRetryTime(
            errorInfo.errorMessage,
          )?.toISOString(),
          isRateLimit,
          isServerError,
          isFailedPrecondition,
        },
      };
    },
  });
}

/**
 * 从各种错误形态中提取错误信息
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
  const err = toRecord(getRetryAttemptError(error));
  const cause = toRecord(err.cause ?? err);
  const response = toRecord(cause.response);
  const responseData = toRecord(response.data);
  const responseError = toRecord(responseData.error);
  const status = getNumericStatus(
    cause.status,
    cause.code,
    response.status,
    responseError.code,
    err.code,
  );
  const code = getCodeValue(err.code, cause.code, responseError.code);
  const reason =
    getFirstErrorValue(cause.errors, "reason") ??
    getFirstErrorValue(responseError.errors, "reason") ??
    undefined;
  const googleErrorStatus = (responseError.status as string) ?? undefined;
  const primaryMessage =
    (cause?.message as string) ??
    (err?.message as string) ??
    (cause?.error as string) ??
    (err?.error as string) ??
    getFirstErrorValue(cause.errors, "message") ??
    (responseError.message as string) ??
    (responseError.error as string as string) ??
    "";

  const errorMessage = String(primaryMessage);

  return { status, code, reason, googleErrorStatus, errorMessage };
}

/**
 * 判断错误是否可重试（限流、服务器错误或网络错误）
 */
export function isRetryableError(errorInfo: ErrorInfo): {
  retryable: boolean;
  isRateLimit: boolean;
  isServerError: boolean;
  isFailedPrecondition: boolean;
} {
  const { status, reason, errorMessage, googleErrorStatus } = errorInfo;
  const hasExistingPushClient = isExistingGmailPushClientError(errorInfo);

  // 宽泛的限流检测：429、403 + 已知原因，或知名消息
  const isRateLimit =
    status === 429 ||
    googleErrorStatus === "RESOURCE_EXHAUSTED" ||
    (status === 403 &&
      ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
        String(reason),
      )) ||
    /(^|[\s-])rate limit exceeded/i.test(errorMessage) ||
    /user-rate limit exceeded/i.test(errorMessage) ||
    /quota exceeded/i.test(errorMessage) ||
    /resource exhausted/i.test(errorMessage) ||
    /too many concurrent requests for user/i.test(errorMessage);

  // 应重试的临时服务器错误
  const isServerError =
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /500|502|503|504|internal error|server error|temporarily unavailable/i.test(
      errorMessage,
    );

  // Gmail is disabled for the account, so retrying only delays the failure.
  const isMailServiceDisabled = /mail service not enabled/i.test(errorMessage);

  const isFailedPrecondition =
    !hasExistingPushClient &&
    !isMailServiceDisabled &&
    status === 400 &&
    (String(reason).toLowerCase() === "failedprecondition" ||
      /precondition check failed/i.test(errorMessage));

  return {
    retryable:
      isRateLimit ||
      isServerError ||
      isFailedPrecondition ||
      isFetchError(errorInfo),
    isRateLimit,
    isServerError,
    isFailedPrecondition,
  };
}

export function isExistingGmailPushClientError(errorInfo: {
  errorMessage: string;
  status?: number;
}): boolean {
  return (
    errorInfo.status === 400 &&
    /only one user push notification client allowed per developer/i.test(
      errorInfo.errorMessage,
    )
  );
}

/**
 * 根据错误类型和尝试次数计算重试延迟
 */
export function calculateRetryDelay(
  isRateLimit: boolean,
  isServerError: boolean,
  isFailedPrecondition: boolean,
  attemptNumber: number,
  retryAfterHeader?: string,
  errorMessage?: string,
): number {
  // 尝试从错误消息中解析重试时间
  const retryTime = parseRetryTime(errorMessage || "");
  if (retryTime) {
    const delayMs = Math.max(0, retryTime.getTime() - Date.now());
    if (delayMs > 0) {
      return delayMs;
    }
    // 如果已过期，则落入回退逻辑
  }

  const retryAfterDelayMs = getRetryAfterDelayMs(retryAfterHeader);
  if (retryAfterDelayMs !== undefined) return retryAfterDelayMs;

  // 根据错误类型使用不同的回退延迟
  if (isServerError) {
    // 服务器错误的指数退避：5s、10s、20s、40s、80s
    return Math.min(5000 * 2 ** (attemptNumber - 1), 80_000);
  }

  if (isRateLimit) {
    // 短指数退避使重试保持在请求生命周期内，除非 Gmail 提供明确的重试时间。
    return Math.min(1000 * 2 ** (attemptNumber - 1), 10_000);
  }

  if (isFailedPrecondition) {
    // 瞬时前置条件失败的短指数退避：1s、2s、4s、8s、10s
    return Math.min(1000 * 2 ** (attemptNumber - 1), 10_000);
  }

  // 其他可重试错误的默认指数退避：1s、2s、4s、8s、16s
  return Math.min(1000 * 2 ** (attemptNumber - 1), 16_000);
}

/**
 * 从 Gmail 限流错误消息中解析重试时间
 * 示例："User-rate limit exceeded. Retry after 2025-08-22T18:22:38.763Z"
 */
function parseRetryTime(errorMessage: string): Date | null {
  const retryMatch = errorMessage.match(/Retry after (.+?)(\s|$)/);
  if (retryMatch?.[1]) {
    try {
      const retryDate = new Date(retryMatch[1]);
      // 校验日期有效（非 NaN）
      if (!Number.isNaN(retryDate.getTime())) {
        return retryDate;
      }
    } catch {
      // 无效的日期格式
    }
  }
  return null;
}

function trimErrorMessage(errorMessage: string): string | undefined {
  const trimmed = errorMessage.trim();
  if (!trimmed) return;
  if (trimmed.length <= 500) return trimmed;
  return `${trimmed.slice(0, 497)}...`;
}

function buildRetryLogFields(errorInfo: ErrorInfo) {
  return {
    status: errorInfo.status,
    code: errorInfo.code,
    reason: errorInfo.reason,
    googleErrorStatus: errorInfo.googleErrorStatus,
    errorMessage: trimErrorMessage(errorInfo.errorMessage),
    isFetchError: isFetchError(errorInfo),
  };
}

function getFirstErrorValue(
  errors: unknown,
  key: "reason" | "message",
): string | undefined {
  if (!Array.isArray(errors)) return;
  const firstError = errors[0];
  if (!firstError || typeof firstError !== "object") return;
  const value = (firstError as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getNumericStatus(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = normalizeNumericValue(value);
    if (normalized !== undefined) return normalized;
  }

  return;
}

function normalizeNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return;
}

function getCodeValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return;
}

function getRetryAttemptError(attempt: unknown): unknown {
  const attemptRecord = toRecord(attempt);
  if ("attemptNumber" in attemptRecord && "error" in attemptRecord) {
    return attemptRecord.error;
  }
  return attempt;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}
