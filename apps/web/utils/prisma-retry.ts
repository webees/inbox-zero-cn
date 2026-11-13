import { Prisma } from "@/generated/prisma/client";
import type { Logger } from "./logger";

/**
 * 为 Prisma 操作加上针对特定瞬时错误的重试逻辑。
 * 主要针对 P2028（"Transaction already closed"），它在使用
 * Neon 连接池的 E2E 测试中频繁出现。
 *
 * @param operation - 要执行的 Prisma 操作。
 * @param options - 重试配置。
 * @param options.maxRetries - 最大重试次数（默认：3）。
 * @param options.delayMs - 退避的初始延迟毫秒数（默认：100）。
 * @param options.logger - 用于重试可见性的可选 logger。
 * @returns Prisma 操作的结果。
 * @throws 当重试次数耗尽或发生不可重试的错误时，抛出原始错误。
 */
export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; delayMs?: number; logger?: Logger } = {},
): Promise<T> {
  const { maxRetries = 3, delayMs = 100, logger } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2028" &&
        attempt < maxRetries
      ) {
        // 线性退避：100ms、200ms、300ms……
        const backoff = delayMs * attempt;
        logger?.warn("因 P2028 重试 Prisma 操作", {
          attempt,
          nextAttemptInMs: backoff,
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
  // 不可达：循环总是通过 return（成功）或 throw（错误）退出
  throw new Error("Prisma 重试次数耗尽（不可达）");
}
