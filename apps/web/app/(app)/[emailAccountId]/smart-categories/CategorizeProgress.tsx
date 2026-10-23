"use client";

import { useEffect } from "react";
import { atom, useAtom } from "jotai";
import useSWR from "swr";
import { ProgressPanel } from "@/components/ProgressPanel";
import type { CategorizeProgress } from "@/app/api/user/categorize/senders/progress/route";

const isCategorizeInProgressAtom = atom(false);

export function useCategorizeProgress() {
  const [isBulkCategorizing, setIsBulkCategorizing] = useAtom(
    isCategorizeInProgressAtom,
  );
  return { isBulkCategorizing, setIsBulkCategorizing };
}

export function CategorizeSendersProgress({
  refresh = false,
}: {
  refresh: boolean;
}) {
  const { isBulkCategorizing } = useCategorizeProgress();

  const { data } = useSWR<CategorizeProgress>(
    "/api/user/categorize/senders/progress",
    {
      refreshInterval: refresh || isBulkCategorizing ? 1000 : undefined,
    },
  );

  const { setIsBulkCategorizing } = useCategorizeProgress();
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;
    if (data?.completedItems === data?.totalItems) {
      timeoutId = setTimeout(() => {
        setIsBulkCategorizing(false);
      }, 3000);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [data?.completedItems, data?.totalItems, setIsBulkCategorizing]);

  if (!data?.totalItems) return null;

  const totalItems = data.totalItems || 0;
  const completedItems = data.completedItems || 0;

  return (
    <ProgressPanel
      totalItems={totalItems}
      remainingItems={totalItems - completedItems}
      inProgressText="正在为发件人分类..."
      completedText={`分类完成！已分类 ${completedItems} 个！`}
      itemLabel="发件人"
    />
  );
}
