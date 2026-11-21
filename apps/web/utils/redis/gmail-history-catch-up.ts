import "server-only";
import { randomUUID } from "node:crypto";
import type { Logger } from "@/utils/logger";
import { redis } from "@/utils/redis";
import { isEmailProviderRateLimitRedisConfigured } from "@/utils/redis/email-provider-rate-limit";
import { clearOwnedLock } from "@/utils/redis/owned-lock";

const GMAIL_HISTORY_CATCH_UP_KEY_PREFIX = "gmail-history-catch-up";
const GMAIL_HISTORY_CATCH_UP_TTL_SECONDS = 24 * 60 * 60;

// 失败只会损失更宽的补偿窗口，因此绝不会导致 webhook 失败。
// 与限流状态共用 Redis 检查：没有该状态时，webhook 永远不会
// 跳过历史记录，因此没有需要补偿的内容。

/**
 * 记录因 Gmail 对账号限流而导致 webhook 历史
 * 未被处理。每次标记都会获得新 token，使一次补偿运行
 * clears the mark it read, not one set by a webhook skipped during that run.
 */
export async function markGmailHistoryCatchUp(
  emailAccountId: string,
  logger: Logger,
) {
  if (!isEmailProviderRateLimitRedisConfigured()) return;

  try {
    await redis.set(getGmailHistoryCatchUpKey(emailAccountId), randomUUID(), {
      ex: GMAIL_HISTORY_CATCH_UP_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn("Failed to mark Gmail history catch-up", { error });
  }
}

export async function getGmailHistoryCatchUp(
  emailAccountId: string,
  logger: Logger,
): Promise<string | null> {
  if (!isEmailProviderRateLimitRedisConfigured()) return null;

  try {
    return await redis.get<string>(getGmailHistoryCatchUpKey(emailAccountId));
  } catch (error) {
    logger.warn("Failed to read Gmail history catch-up", { error });
    return null;
  }
}

export async function clearGmailHistoryCatchUp({
  emailAccountId,
  token,
  logger,
}: {
  emailAccountId: string;
  token: string;
  logger: Logger;
}) {
  if (!isEmailProviderRateLimitRedisConfigured()) return;

  try {
    await clearOwnedLock({
      key: getGmailHistoryCatchUpKey(emailAccountId),
      lockToken: token,
    });
  } catch (error) {
    logger.warn("Failed to clear Gmail history catch-up", { error });
  }
}

function getGmailHistoryCatchUpKey(emailAccountId: string) {
  return `${GMAIL_HISTORY_CATCH_UP_KEY_PREFIX}:${emailAccountId}`;
}
