"use client";

import { useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { Clock, TrendingDown, TrendingUp, Timer } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useOrgSWR } from "@/hooks/useOrgSWR";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardBasic } from "@/components/ui/card";
import { getDateRangeParams } from "./params";
import { BarChart } from "./BarChart";
import type { ChartConfig } from "@/components/ui/chart";
import { COLORS } from "@/utils/colors";
import { cn } from "@/utils";
import type { ResponseTimeQuery } from "@/utils/stats/response-time/validation";
import type { ResponseTimeResponse } from "@/utils/stats/response-time/controller";
import { isDefined } from "@/utils/types";
import { createSearchParams } from "@/utils/url";

interface ResponseTimeAnalyticsProps {
  dateRange?: DateRange;
  refreshInterval: number;
}

export function ResponseTimeAnalytics({
  dateRange,
  refreshInterval,
}: ResponseTimeAnalyticsProps) {
  const { t } = useLingui();
  const params: ResponseTimeQuery = getDateRangeParams(dateRange);

  const { data, isLoading, error } = useOrgSWR<ResponseTimeResponse>(
    `/api/user/stats/response-time?${createSearchParams(params)}`,
    { refreshInterval },
  );

  const distributionData = useMemo(() => {
    if (!data?.distribution) return [];
    return [
      { group: t`不足 1 小时`, count: data.distribution.lessThan1Hour },
      { group: t`1-4 小时`, count: data.distribution.oneToFourHours },
      { group: t`4-24 小时`, count: data.distribution.fourTo24Hours },
      { group: t`1-3 天`, count: data.distribution.oneToThreeDays },
      { group: t`3-7 天`, count: data.distribution.threeToSevenDays },
      { group: t`超过 7 天`, count: data.distribution.moreThan7Days },
    ];
  }, [data, t]);
  const trendData = useMemo(() => {
    if (!data?.trend) return [];
    return data.trend
      .map((item) =>
        item
          ? {
              date: item.period,
              median: item.medianResponseTime,
            }
          : null,
      )
      .filter(isDefined);
  }, [data]);

  const distributionChartConfig: ChartConfig = {
    count: { label: t`邮件`, color: COLORS.analytics.blue },
  };

  const trendChartConfig: ChartConfig = {
    median: {
      label: t`回复时间中位数`,
      color: COLORS.analytics.purple,
    },
  };

  return (
    <LoadingContent
      loading={isLoading}
      error={error}
      loadingComponent={<Skeleton className="h-[400px] rounded" />}
    >
      {data?.summary && (
        <div className="space-y-4">
          {data.emailsAnalyzed > 0 && (
            <p className="text-muted-foreground text-sm">
              <Trans>
                基于最近{" "}
                <Plural
                  value={data.emailsAnalyzed}
                  one="# 封邮件"
                  other="# 封邮件"
                />
              </Trans>
            </p>
          )}

          <div className="grid gap-2 sm:gap-4 grid-cols-3">
            <SummaryCard
              title={t`中位回复时间`}
              value={formatTime(data.summary.medianResponseTime)}
              icon={<Clock className="h-4 w-4" />}
              comparison={data.summary.previousPeriodComparison}
            />
            <SummaryCard
              title={t`平均回复时间`}
              value={formatTime(data.summary.averageResponseTime)}
              icon={<Timer className="h-4 w-4" />}
            />
            <SummaryCard
              title={t`1 小时内`}
              value={`${data.summary.within1Hour}%`}
              icon={<TrendingUp className="h-4 w-4" />}
            />
          </div>

          {/* Distribution Chart */}
          {distributionData.some((d) => d.count > 0) && (
            <CardBasic>
              <p>
                <Trans>回复时间分布</Trans>
              </p>
              <div className="mt-4">
                <BarChart
                  data={distributionData}
                  config={distributionChartConfig}
                  dataKeys={["count"]}
                  xAxisKey="group"
                  xAxisFormatter={(value) => value}
                  tooltipLabelFormatter={(value) => String(value)}
                />
              </div>
            </CardBasic>
          )}

          {/* Trend Chart */}
          {trendData.length > 0 && (
            <CardBasic>
              <p>
                <Trans>每周回复时间趋势</Trans>
              </p>
              <div className="mt-4">
                <BarChart
                  data={trendData}
                  config={trendChartConfig}
                  dataKeys={["median"]}
                  xAxisKey="date"
                  xAxisFormatter={(value) => value}
                  yAxisFormatter={formatTimeShort}
                  tooltipValueFormatter={formatTime}
                />
              </div>
            </CardBasic>
          )}

          {/* Empty state */}
          {!distributionData.some((d) => d.count > 0) &&
            trendData.length === 0 && (
              <CardBasic>
                <p>
                  <Trans>回复时间分析</Trans>
                </p>
                <div className="mt-4 h-32 flex items-center justify-center text-muted-foreground">
                  <p>
                    <Trans>此时间段没有可用的回复时间数据。</Trans>
                  </p>
                </div>
              </CardBasic>
            )}
        </div>
      )}
    </LoadingContent>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  comparison,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  comparison?: {
    medianResponseTime: number;
    percentChange: number;
  } | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {comparison && (
          <p
            className={cn(
              "text-xs mt-1 flex items-center gap-1",
              comparison.percentChange < 0
                ? "text-green-600"
                : comparison.percentChange > 0
                  ? "text-red-600"
                  : "text-muted-foreground",
            )}
          >
            {comparison.percentChange < 0 ? (
              <TrendingDown className="h-3 w-3" />
            ) : comparison.percentChange > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : null}
            <PercentChangeText change={comparison.percentChange} />
            <span className="text-muted-foreground ml-1">
              <Trans>较上期</Trans>
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatTime(minutes: number): string {
  if (minutes === 0) return "0m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) {
    let hours = Math.floor(minutes / 60);
    let mins = Math.round(minutes % 60);
    // 四舍五入后的分钟数等于 60 时进位
    if (mins === 60) {
      hours += 1;
      mins = 0;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  let days = Math.floor(minutes / 1440);
  let hours = Math.round((minutes % 1440) / 60);
  // 四舍五入后的小时数等于 24 时进位
  if (hours === 24) {
    days += 1;
    hours = 0;
  }
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

// Y 轴标签的简短格式
function formatTimeShort(minutes: number): string {
  if (minutes === 0) return "0";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  const days = Math.round(minutes / 1440);
  return `${days}d`;
}

function PercentChangeText({ change }: { change: number }) {
  const percentChange = Math.abs(change);
  if (change === 0) return <Trans>无变化</Trans>;
  if (change < 0) return <Trans>快 {percentChange}%</Trans>;
  return <Trans>慢 {percentChange}%</Trans>;
}
