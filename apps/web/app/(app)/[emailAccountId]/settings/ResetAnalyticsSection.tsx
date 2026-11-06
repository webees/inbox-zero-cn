"use client";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import { resetAnalyticsAction } from "@/utils/actions/user";

export function ResetAnalyticsSection({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { executeAsync: executeResetAnalytics } = useAction(
    resetAnalyticsAction.bind(null, emailAccountId),
  );

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>重置分析</ItemTitle>
          <ItemDescription>永久删除所有分析数据</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              toast.promise(() => executeResetAnalytics(), {
                loading: "正在重置分析…",
                success: () =>
                  "分析已重置！请访问退订或分析页面，点击“加载更多”按钮以重新加载你的数据。",
                error: (err: unknown) =>
                  `重置分析时出错：${
                    err instanceof Error ? err.message : "未知错误"
                  }`,
              });
            }}
          >
            重置
          </Button>
        </ItemActions>
      </Item>
    </>
  );
}
