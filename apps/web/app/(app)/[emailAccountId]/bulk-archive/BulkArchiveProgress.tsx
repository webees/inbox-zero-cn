"use client";

import { useEffect } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ProgressPanel } from "@/components/ProgressPanel";
import { useArchiveQueueProgress } from "@/store/archive-sender-queue";
import { useAccount } from "@/providers/EmailAccountProvider";

export function BulkArchiveProgress({
  onComplete,
}: {
  onComplete?: () => void;
}) {
  const { t } = useLingui();
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

  function getInProgressText() {
    const current = Math.min(settledItems + 1, totalItems);
    if (failedItems) {
      return t`${plural(totalItems, {
        one: `正在归档 ${current} / # 个发件人... ${failedItems} 个失败`,
        other: `正在归档 ${current} / # 个发件人... ${failedItems} 个失败`,
      })}`;
    }
    return t`${plural(totalItems, {
      one: `正在归档 ${current} / # 个发件人...`,
      other: `正在归档 ${current} / # 个发件人...`,
    })}`;
  }

  return (
    <ProgressPanel
      totalItems={totalItems}
      remainingItems={activeItems}
      inProgressText={getInProgressText()}
      completedText={
        failedItems
          ? t`归档完成：${completedItems} 个成功，${failedItems} 个失败`
          : t`${plural(completedItems, {
              one: "归档完成！已处理 # 个发件人！",
              other: "归档完成！已处理 # 个发件人！",
            })}`
      }
      itemLabel={t`个发件人`}
    />
  );
}
