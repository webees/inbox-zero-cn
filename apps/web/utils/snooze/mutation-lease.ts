import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import { SNOOZE_EXECUTION_LEASE_MS } from "@/utils/snooze/scheduler";

const logger = createScopedLogger("snooze/mutation-lease");

export async function withSnoozeMutationLease<T>(
  emailAccountId: string,
  run: () => Promise<T>,
): Promise<T | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + SNOOZE_EXECUTION_LEASE_MS);
  // 回滚可能会触及已移至其他会话的邮件，因此竞争性稍后提醒检查与提供商写入
  // 共享一个邮箱级租约。
  const claimed = await prisma.$executeRaw`
    UPDATE "EmailAccount" SET "snoozeMutationLeaseUntil" = ${leaseUntil}
    WHERE "id" = ${emailAccountId}
      AND ("snoozeMutationLeaseUntil" IS NULL OR "snoozeMutationLeaseUntil" <= ${now})
  `;
  if (!claimed) return null;

  try {
    return await run();
  } finally {
    try {
      await prisma.$executeRaw`
        UPDATE "EmailAccount" SET "snoozeMutationLeaseUntil" = NULL
        WHERE "id" = ${emailAccountId} AND "snoozeMutationLeaseUntil" = ${leaseUntil}
      `;
    } catch (error) {
      logger.warn("释放稍后提醒变更租约失败", {
        emailAccountId,
        error,
      });
    }
  }
}
