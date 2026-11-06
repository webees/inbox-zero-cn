"use client";

import { memo, useEffect } from "react";
import {
  clearArchiveSenderStatuses,
  useArchiveQueueProgress,
} from "@/store/archive-sender-queue";
import { ProgressPanel } from "@/components/ProgressPanel";
import { useAccount } from "@/providers/EmailAccountProvider";

export const ArchiveProgress = memo(() => {
  const { emailAccountId } = useAccount();
  const bulkArchiveProgress = useArchiveQueueProgress(emailAccountId);
  const totalItems = bulkArchiveProgress?.totalItems ?? 0;
  const completedItems = bulkArchiveProgress?.completedItems ?? 0;
  const failedItems = bulkArchiveProgress?.failedItems ?? 0;
  const activeItems = bulkArchiveProgress?.activeItems ?? 0;

  useEffect(() => {
    if (!totalItems || activeItems) return;
    const timeoutId = setTimeout(
      () => clearArchiveSenderStatuses(emailAccountId),
      3000,
    );
    return () => clearTimeout(timeoutId);
  }, [activeItems, emailAccountId, totalItems]);

  if (!totalItems) return null;

  return (
    <ProgressPanel
      totalItems={totalItems}
      remainingItems={activeItems}
      inProgressText={`正在归档发件人…${failedItems ? ` ${failedItems} 个失败。` : ""}`}
      completedText={
        failedItems
          ? `归档完成：${completedItems} 个成功，${failedItems} 个失败。`
          : "归档完成！"
      }
      itemLabel="发件人"
    />
  );
});
