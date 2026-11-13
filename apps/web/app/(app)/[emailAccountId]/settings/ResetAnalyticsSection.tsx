"use client";

import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const { executeAsync: executeResetAnalytics } = useAction(
    resetAnalyticsAction.bind(null, emailAccountId),
  );

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>
            <Trans>重置分析数据</Trans>
          </ItemTitle>
          <ItemDescription>
            <Trans>永久删除所有分析数据</Trans>
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              toast.promise(() => executeResetAnalytics(), {
                loading: t`正在重置分析数据...`,
                success: () =>
                  t`分析数据已重置！请访问退订管理或分析页面，点击“加载更多”按钮重新加载数据。`,
                error: (err: unknown) => {
                  const message =
                    err instanceof Error ? err.message : t`未知错误`;
                  return t`重置分析数据失败：${message}`;
                },
              });
            }}
          >
            <Trans>重置</Trans>
          </Button>
        </ItemActions>
      </Item>
    </>
  );
}
