import pRetry, { type RetryContext } from "p-retry";
import type { Logger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

// "rate-limit-only" 用于非幂等写入：网络、服务器和冲突
// 失败是有歧义的，因为写入可能已经成功。
export type ProviderRetryPolicy = "all" | "rate-limit-only";

interface ProviderRetryDecision {
  delayMs: number;
  isRateLimit: boolean;
  logFields: Record<string, unknown>;
  retryable: boolean;
}

export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  {
    classify,
    logger,
    maxBlockingDelayMs,
    maxRetries,
    providerName,
    retryPolicy,
  }: {
    classify: (attempt: RetryContext) => ProviderRetryDecision;
    logger: Logger;
    maxBlockingDelayMs: number;
    maxRetries: number;
    providerName: string;
    retryPolicy: ProviderRetryPolicy;
  },
): Promise<T> {
  return pRetry(operation, {
    retries: maxRetries,
    onFailedAttempt: async (attempt) => {
      const { retryable, isRateLimit, delayMs, logFields } = classify(attempt);

      if (!retryable || (retryPolicy === "rate-limit-only" && !isRateLimit)) {
        logger.warn("遇到不可重试的错误", {
          error: attempt.error,
          ...logFields,
          retryPolicy,
        });
        // 抛出尝试上下文会把 p-retry 的包装错误交给调用方
        // 而不是服务商错误，这样错误分类器就永远无法匹配。
        throw attempt.error;
      }

      const retryLogFields = {
        delaySeconds: Math.ceil(delayMs / 1000),
        maxBlockingDelaySeconds: Math.ceil(maxBlockingDelayMs / 1000),
        attemptNumber: attempt.attemptNumber,
        maxRetries,
        ...logFields,
        retryPolicy,
      };

      logger.warn(`${providerName} 出错，将重试`, retryLogFields);

      if (delayMs > maxBlockingDelayMs) {
        logger.warn("在无服务器环境中因退避时间过长而中止重试", retryLogFields);
        throw attempt.error;
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    },
  });
}

/**
 * 解析以 delta-seconds 或 HTTP-date 形式给出的 Retry-After 头。
 * 当该头缺失、无法解析，或已经处于
 * 过去时返回 undefined，以便调用方回退到自己的退避策略。
 */
export function getRetryAfterDelayMs(
  retryAfterHeader: string | undefined,
): number | undefined {
  if (!retryAfterHeader) return;

  const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
  if (!Number.isNaN(retryAfterSeconds)) return retryAfterSeconds * 1000;

  const retryDate = new Date(retryAfterHeader);
  if (Number.isNaN(retryDate.getTime())) return;

  const delayMs = retryDate.getTime() - Date.now();
  return delayMs > 0 ? delayMs : undefined;
}
