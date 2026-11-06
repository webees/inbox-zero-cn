import type { Logger } from "@/utils/logger";
import { isFetchError } from "@/utils/retry/is-fetch-error";
import { getRetryAfterHeaderFromError } from "@/utils/retry/get-retry-after-header";
import {
  getRetryAfterDelayMs,
  type ProviderRetryPolicy,
  withProviderRetry,
} from "@/utils/retry/provider-retry";

interface ErrorInfo {
  code?: string;
  errorMessage: string;
  responseBody?: string;
  status?: number;
}

// 有意低于 Microsoft 常见的 30 秒限流退避，以便无服务器
// 请求快速失败，而不是睡到函数超时预算耗尽。
// 非无服务器的调用方在需要时可传入更高的 maxBlockingDelayMs。
export const MAX_MICROSOFT_GRAPH_BLOCKING_RETRY_DELAY_MS = 10_000;

/**
 * 在遇到限流或临时服务器错误时重试 Microsoft Graph API 操作
 * - 限流：429、"TooManyRequests"、"ApplicationThrottled"、"MailboxConcurrency"
 * - 服务器错误：502、503、504、"ServiceNotAvailable"、"ServerBusy"
 */
export async function withMicrosoftGraphRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  maxRetries = 5,
  maxBlockingDelayMs = MAX_MICROSOFT_GRAPH_BLOCKING_RETRY_DELAY_MS,
): Promise<T> {
  return withMicrosoftGraphRetryPolicy(
    operation,
    logger,
    maxRetries,
    maxBlockingDelayMs,
    "all",
  );
}

/**
 * 仅当 Graph 明确因限流而拒绝时，才重试非幂等的
 * Microsoft Graph 写入。网络、服务器和冲突失败具有
 * 歧义，因为写入可能已经成功。
 */
export async function withMicrosoftGraphWriteRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  maxRetries = 5,
  maxBlockingDelayMs = MAX_MICROSOFT_GRAPH_BLOCKING_RETRY_DELAY_MS,
): Promise<T> {
  return withMicrosoftGraphRetryPolicy(
    operation,
    logger,
    maxRetries,
    maxBlockingDelayMs,
    "rate-limit-only",
  );
}

/**
 * 从 Microsoft Graph API 错误中提取错误信息
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
  const err = error as Record<string, unknown>;
  const nestedError = err?.error as Record<string, unknown> | undefined;

  const status =
    (err?.statusCode as number) ??
    (err?.status as number) ??
    ((err?.response as Record<string, unknown>)?.status as number) ??
    (nestedError?.statusCode as number) ??
    (nestedError?.status as number) ??
    ((nestedError?.response as Record<string, unknown>)?.status as number) ??
    undefined;

  const code =
    (err?.code as string) ?? (nestedError?.code as string) ?? undefined;

  const primaryMessage =
    (err?.message as string) ??
    (nestedError?.message as string) ??
    (err?.body as string) ??
    "";

  const errorMessage = String(primaryMessage);

  const responseBody =
    typeof err?.body === "string" ? (err.body as string) : undefined;

  return { status, code, errorMessage, responseBody };
}

/**
 * 判断错误是否可重试（限流、服务器错误、冲突或网络错误）
 */
export function isRetryableError(errorInfo: ErrorInfo): {
  retryable: boolean;
  isRateLimit: boolean;
  isServerError: boolean;
  isConflictError: boolean;
} {
  const { status, code, errorMessage } = errorInfo;

  // 限流检测：429 状态、节流代码或限流消息
  const isRateLimit =
    status === 429 ||
    code === "TooManyRequests" ||
    code === "ApplicationThrottled" ||
    /rate limit/i.test(errorMessage) ||
    /MailboxConcurrency/i.test(errorMessage);

  // 应重试的临时服务器错误（502、503、504）
  const isServerError =
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "ServiceNotAvailable" ||
    code === "ServerBusy" ||
    /502|503|504|server error|temporarily unavailable|service unavailable/i.test(
      errorMessage,
    );

  // 来自过期 change key 的冲突错误（412）
  const isConflictError =
    status === 412 ||
    code === "ErrorIrresolvableConflict" ||
    /change key/i.test(errorMessage);

  // Graph 有时会在响应体中途结束 200 响应；重试时同样的读取会成功。
  const isTruncatedResponse = status === 200 && code === "SyntaxError";

  return {
    retryable:
      isRateLimit ||
      isServerError ||
      isConflictError ||
      isTruncatedResponse ||
      isFetchError(errorInfo),
    isRateLimit,
    isServerError,
    isConflictError,
  };
}

/**
 * 根据错误类型和尝试次数计算重试延迟
 */
export function calculateRetryDelay(
  isRateLimit: boolean,
  isServerError: boolean,
  isConflictError: boolean,
  attemptNumber: number,
  retryAfterHeader?: string,
): number {
  const retryAfterDelayMs = getRetryAfterDelayMs(retryAfterHeader);
  if (retryAfterDelayMs !== undefined) return retryAfterDelayMs;

  // 根据错误类型使用不同的回退延迟
  if (isConflictError) {
    // 冲突错误的快速指数退避：500ms、1s、2s、4s、8s
    // 一旦过期操作完成，冲突会很快解决
    return Math.min(500 * 2 ** (attemptNumber - 1), 8000);
  }

  if (isServerError) {
    // 服务器错误的指数退避：5s、10s、20s、40s、80s
    return Math.min(5000 * 2 ** (attemptNumber - 1), 80_000);
  }

  if (isRateLimit) {
    // 限流的固定延迟（按 Microsoft Graph 建议为 30 秒）
    return 30_000;
  }

  // 其他可重试错误的默认指数退避：1s、2s、4s、8s、16s
  return Math.min(1000 * 2 ** (attemptNumber - 1), 16_000);
}

async function withMicrosoftGraphRetryPolicy<T>(
  operation: () => Promise<T>,
  logger: Logger,
  maxRetries: number,
  maxBlockingDelayMs: number,
  retryPolicy: ProviderRetryPolicy,
): Promise<T> {
  return withProviderRetry(operation, {
    providerName: "Microsoft Graph",
    logger,
    maxRetries,
    maxBlockingDelayMs,
    retryPolicy,
    classify: (attempt) => {
      const errorInfo = extractErrorInfo(attempt);
      const { retryable, isRateLimit, isServerError, isConflictError } =
        isRetryableError(errorInfo);
      const retryAfterHeader = getRetryAfterHeaderFromError(attempt);

      return {
        retryable,
        isRateLimit,
        delayMs: calculateRetryDelay(
          isRateLimit,
          isServerError,
          isConflictError,
          attempt.attemptNumber,
          retryAfterHeader,
        ),
        logFields: {
          status: errorInfo.status,
          code: errorInfo.code,
          isRateLimit,
          isServerError,
          isConflictError,
          isFetchError: isFetchError(errorInfo),
          retryAfterHeader,
          responseBody: errorInfo.responseBody,
        },
      };
    },
  });
}
