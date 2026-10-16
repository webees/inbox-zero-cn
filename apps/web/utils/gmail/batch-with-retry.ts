import chunk from "lodash/chunk";
import { type BatchError, isBatchError, isDefined } from "@/utils/types";
import { getBatch } from "@/utils/gmail/batch";
import { isRetryableError } from "@/utils/gmail/retry";
import { sleep } from "@/utils/sleep";
import type { Logger } from "@/utils/logger";

const GMAIL_BATCH_SIZE = 25;
const RATE_LIMIT_RETRY_BATCH_SIZE = 10;
const MAX_BATCH_RETRIES = 3;
const MAX_RETRY_JITTER_MS = 1000;

// Gmail 会将每个子请求计入每用户并发。为其他账号活动留出
// 余量，然后进一步减少被限流的重试。
export async function getBatchWithRetry<TRaw, TParsed>({
  ids,
  endpoint,
  accessToken,
  parse,
  logger,
  queryString,
  retryCount = 0,
  retryError,
}: {
  ids: string[];
  endpoint: string; // e.g. /gmail/v1/users/me/messages
  accessToken: string;
  parse: (item: TRaw) => TParsed;
  logger: Logger;
  queryString?: string;
  retryCount?: number;
  retryError?: BatchError["error"];
}): Promise<TParsed[]> {
  if (!accessToken) throw new Error("没有访问令牌");

  const results: TParsed[] = [];
  for (const idsChunk of chunk(ids, GMAIL_BATCH_SIZE)) {
    const chunkResults = await getBatchChunkWithRetry<TRaw, TParsed>({
      ids: idsChunk,
      endpoint,
      accessToken,
      parse,
      logger,
      queryString,
      retryCount,
      retryError,
    });
    results.push(...chunkResults);
  }

  return results;
}

async function getBatchChunkWithRetry<TRaw, TParsed>({
  ids,
  endpoint,
  accessToken,
  parse,
  logger,
  queryString,
  retryCount,
  retryError,
}: {
  ids: string[];
  endpoint: string;
  accessToken: string;
  parse: (item: TRaw) => TParsed;
  logger: Logger;
  queryString?: string;
  retryCount: number;
  retryError?: BatchError["error"];
}): Promise<TParsed[]> {
  if (retryCount > MAX_BATCH_RETRIES)
    throwBatchRetryLimit({
      batchSize: ids.length,
      retryCount,
      retryError,
      logger,
    });

  const batch: (TRaw | BatchError)[] = await getBatch(
    ids,
    endpoint,
    accessToken,
    queryString,
  );

  if (batch.some((item) => isBatchError(item) && item.error.code === 401)) {
    logger.error("获取批量请求时出错", { firstBatchItem: batch?.[0] });
    throw new Error("无效的访问令牌");
  }

  const missingIds = new Set<string>();
  const rateLimitedIds = new Set<string>();
  let lastRetryableError = retryError;
  let retryableItemCount = 0;
  let rateLimitedItemCount = 0;

  const parsed = batch
    .map((item, i) => {
      if (isBatchError(item)) {
        const { code, message: errorMessage, errors } = item.error;
        const reason = errors?.[0]?.reason;

        const { retryable, isRateLimit } = isRetryableError({
          status: code,
          reason,
          errorMessage,
        });

        if (!retryable) {
          logger.warn("由于不可重试的错误跳过批量项", {
            code,
            reason,
            errorMessage,
          });
          return;
        }

        retryableItemCount++;
        if (isRateLimit) {
          rateLimitedItemCount++;
          rateLimitedIds.add(ids[i]);
        }
        if (isRateLimit || !lastRetryableError) {
          lastRetryableError = item.error;
        }
        missingIds.add(ids[i]);
        return;
      }

      return parse(item);
    })
    .filter(isDefined);

  if (missingIds.size > 0) {
    const remainingIds = Array.from(missingIds);
    const nextRetryCount = retryCount + 1;

    if (nextRetryCount > MAX_BATCH_RETRIES)
      throwBatchRetryLimit({
        batchSize: remainingIds.length,
        retryCount: nextRetryCount,
        retryError: lastRetryableError,
        logger,
      });

    logger.warn("正在重试 Gmail 批量项", {
      batchSize: ids.length,
      retryableItemCount,
      rateLimitedItemCount,
      retryCount: nextRetryCount,
    });
    const exponentialDelayMs = Math.min(
      1000 * 2 ** (nextRetryCount - 1),
      10_000,
    );
    const jitterMs = Math.floor(Math.random() * (MAX_RETRY_JITTER_MS + 1));
    await sleep(exponentialDelayMs + jitterMs);
    const nonRateLimitedIds = remainingIds.filter(
      (id) => !rateLimitedIds.has(id),
    );
    const retryChunks = [
      ...chunk(nonRateLimitedIds, GMAIL_BATCH_SIZE),
      ...chunk(Array.from(rateLimitedIds), RATE_LIMIT_RETRY_BATCH_SIZE),
    ];
    const refetched: TParsed[] = [];
    for (const idsChunk of retryChunks) {
      const chunkResults = await getBatchChunkWithRetry({
        ids: idsChunk,
        endpoint,
        accessToken,
        parse,
        retryCount: nextRetryCount,
        retryError: lastRetryableError,
        logger,
        queryString,
      });
      refetched.push(...chunkResults);
    }
    return [...parsed, ...refetched];
  }

  return parsed;
}

function throwBatchRetryLimit({
  batchSize,
  retryCount,
  retryError,
  logger,
}: {
  batchSize: number;
  retryCount: number;
  retryError?: BatchError["error"];
  logger: Logger;
}): never {
  logger.warn("Gmail 批量重试次数过多", { batchSize, retryCount });
  if (!retryError) throw new Error("超出 Gmail 批量重试上限");

  // 保留服务商错误，以便账号级限流保护能暂停后续调用。
  throw new Error(retryError.message, { cause: retryError });
}
