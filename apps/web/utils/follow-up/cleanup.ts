import { subDays } from "date-fns/subDays";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { hasFollowUpLabel } from "./labels";

const STALE_DRAFT_DAYS = 7;

export async function cleanupStaleDrafts({
  emailAccountId,
  provider,
  logger,
}: {
  emailAccountId: string;
  provider: EmailProvider;
  logger: Logger;
}): Promise<void> {
  const staleThreshold = subDays(new Date(), STALE_DRAFT_DAYS);

  logger.info("正在清理过期的跟进草稿", {
    thresholdDays: STALE_DRAFT_DAYS,
    before: staleThreshold.toISOString(),
  });

  const staleTrackers = await prisma.threadTracker.findMany({
    where: {
      emailAccountId,
      followUpAppliedAt: { lt: staleThreshold },
      resolved: false,
    },
    select: {
      id: true,
      threadId: true,
      followUpAppliedAt: true,
      followUpDraftId: true,
    },
  });

  logger.info("找到过期追踪项", { count: staleTrackers.length });

  if (staleTrackers.length === 0) {
    logger.info("完成过期草稿清理");
    return;
  }

  const trackedDraftIds = new Set(
    staleTrackers.map((t) => t.followUpDraftId).filter(Boolean),
  );

  logger.info("在数据库中找到已追踪的草稿", {
    count: trackedDraftIds.size,
  });

  const allDrafts = await provider.getDrafts({ maxResults: 100 });

  for (const tracker of staleTrackers) {
    const trackerLogger = logger.with({
      trackerId: tracker.id,
      threadId: tracker.threadId,
    });

    try {
      const hasLabel = await hasFollowUpLabel({
        provider,
        threadId: tracker.threadId,
        logger: trackerLogger,
      });

      if (!hasLabel) {
        trackerLogger.info("会话已没有跟进标签，跳过");
        continue;
      }

      // 只删除我们数据库中已追踪的草稿（AI 生成）
      const threadDrafts = allDrafts.filter(
        (draft) => draft.threadId === tracker.threadId,
      );

      const trackedThreadDrafts = threadDrafts.filter((draft) =>
        trackedDraftIds.has(draft.id),
      );

      const skippedCount = threadDrafts.length - trackedThreadDrafts.length;
      if (skippedCount > 0) {
        trackerLogger.info("跳过未追踪的草稿（用户创建）", {
          skippedCount,
        });
      }

      for (const draft of trackedThreadDrafts) {
        try {
          await provider.deleteDraft(draft.id);
          trackerLogger.info("已删除过期草稿", { draftId: draft.id });
        } catch (error) {
          trackerLogger.warn("删除过期草稿失败", {
            draftId: draft.id,
            error,
          });
        }
      }

      trackerLogger.info("已清理该会话的过期草稿", {
        deletedCount: trackedThreadDrafts.length,
      });
    } catch (error) {
      trackerLogger.error("清理该会话的过期草稿失败", {
        error,
      });
    }
  }

  logger.info("完成过期草稿清理");
}
