import { SnoozedThreadStatus } from "@/generated/prisma/enums";
import type { SnoozedThread } from "@/generated/prisma/client";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { releaseSnoozedThreadForRetry } from "@/utils/snooze/scheduler";

export async function executeSnoozedThread(
  snoozedThread: SnoozedThread,
  provider: EmailProvider,
  logger: Logger,
  leaseStartedAt: Date,
) {
  try {
    await provider.unarchiveThread(snoozedThread.threadId);
  } catch (error) {
    await releaseSnoozedThreadForRetry(snoozedThread.id, leaseStartedAt);
    logger.error("恢复已暂缓会话失败", {
      error,
      snoozedThreadId: snoozedThread.id,
    });
    return { success: false as const, error };
  }

  try {
    const completed = await prisma.snoozedThread.updateMany({
      where: {
        id: snoozedThread.id,
        status: SnoozedThreadStatus.EXECUTING,
        updatedAt: leaseStartedAt,
      },
      data: { status: SnoozedThreadStatus.COMPLETED },
    });
    if (completed.count !== 1) {
      throw new Error("已暂缓会话的执行占用已丢失");
    }
    return { success: true as const };
  } catch (error) {
    // 保持 EXECUTING 状态，这样快速重复的请求不会重复调用服务商。
    // 过期执行恢复稍后会重试并核对此记录。
    logger.error("已恢复暂缓会话，但记录完成状态失败", {
      error,
      snoozedThreadId: snoozedThread.id,
    });
    return { success: false as const, error };
  }
}
