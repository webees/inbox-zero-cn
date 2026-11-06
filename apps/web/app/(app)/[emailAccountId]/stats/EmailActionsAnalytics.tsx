"use client";

import { useOrgSWR } from "@/hooks/useOrgSWR";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { CardBasic } from "@/components/ui/card";
import type { EmailActionStatsResponse } from "@/app/api/user/stats/email-actions/route";
import { BarChart } from "./BarChart";
import type { ChartConfig } from "@/components/ui/chart";
import { COLORS } from "@/utils/colors";
import { BRAND_NAME } from "@/utils/branding";

const chartConfig = {
  Archived: { label: "已归档", color: COLORS.analytics.green },
  Deleted: { label: "已删除", color: COLORS.analytics.pink },
} satisfies ChartConfig;

export function EmailActionsAnalytics() {
  const { data, isLoading, error } = useOrgSWR<EmailActionStatsResponse>(
    "/api/user/stats/email-actions",
  );

  if (data?.disabled) {
    return (
      <CardBasic>
        <p>{`你使用 ${BRAND_NAME} 归档和删除了多少邮件`}</p>
        <div className="mt-4 h-72 flex items-center justify-center text-muted-foreground">
          <p>此功能已禁用。请联系你的管理员启用。</p>
        </div>
      </CardBasic>
    );
  }

  return (
    <LoadingContent
      loading={isLoading}
      error={error}
      loadingComponent={<Skeleton className="h-32 w-full rounded" />}
    >
      {data && (
        <CardBasic>
          <p>{`你使用 ${BRAND_NAME} 归档和删除了多少邮件`}</p>
          <div className="mt-4">
            <BarChart
              data={data.result}
              config={chartConfig}
              dataKeys={["Archived", "Deleted"]}
              xAxisKey="date"
            />
          </div>
        </CardBasic>
      )}
    </LoadingContent>
  );
}
