"use client";

import { useEffect } from "react";
import { ProgressPanel } from "@/components/ProgressPanel";
import { useArchiveQueueProgress } from "@/store/archive-sender-queue";
import { useAccount } from "@/providers/EmailAccountProvider";

export function BulkArchiveProgress({
  onComplete,
}: {
  onComplete?: () => void;
}) {
  const { emailAccountId } = useAccount();
  const progress = useArchiveQueueProgress(emailAccountId);
  const totalItems = progress?.totalItems ?? 0;
  const completedItems = progress?.completedItems ?? 0;
  const failedItems = progress?.failedItems ?? 0;
  const activeItems = progress?.activeItems ?? 0;
  const settledItems = progress?.settledItems ?? 0;
  const hasActiveProgress = activeItems > 0;
  const hasSettledProgress = !!totalItems && settledItems === totalItems;

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;
    if (hasSettledProgress) {
      timeoutId = setTimeout(() => {
        onComplete?.();
      }, 3000);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [hasSettledProgress, onComplete]);

  if ((!hasActiveProgress && !hasSettledProgress) || !totalItems) {
    return null;
  }

  const failedSuffix = failedItems ? ` ${failedItems} 个失败。` : "";

  return (
    <ProgressPanel
      totalItems={totalItems}
      remainingItems={activeItems}
      inProgressText={`正在归档 ${Math.min(settledItems + 1, totalItems)}/${totalItems} 个发件人…${failedSuffix}`}
      completedText={
        failedItems
          ? `归档完成：${completedItems} 个成功，${failedItems} 个失败。`
          : `归档完成！已处理 ${completedItems} 个发件人！`
      }
      itemLabel="发件人"
    />
  );
}
