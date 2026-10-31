"use client";

import { useState, useMemo, useCallback } from "react";
import type { DateRange } from "react-day-picker";
import { subDays } from "date-fns/subDays";
import { Mail, Sparkles, Users } from "lucide-react";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerWithRange } from "@/components/DatePickerWithRange";
import { useOrgStatsTotals } from "@/hooks/useOrgStatsTotals";
import { useOrgStatsEmailBuckets } from "@/hooks/useOrgStatsEmailBuckets";
import { useOrgStatsRulesBuckets } from "@/hooks/useOrgStatsRulesBuckets";
import { MutedText } from "@/components/Typography";
import { useOrganizationMembership } from "@/hooks/useOrganizationMembership";
import { hasOrganizationAdminRole } from "@/utils/organizations/roles";
import { AccessDenied } from "@/components/AccessDenied";

const selectOptions = [
  { label: "上周", value: "7" },
  { label: "上个月", value: "30" },
  { label: "最近 3 个月", value: "90" },
  { label: "全部时间", value: "0" },
];
const defaultSelected = selectOptions[1];

export function OrgStats({ organizationId }: { organizationId: string }) {
  const { data: membership, isLoading: membershipLoading } =
    useOrganizationMembership();
  const isAdmin = hasOrganizationAdminRole(membership?.role ?? "");

  const [dateDropdown, setDateDropdown] = useState<string>(
    defaultSelected.label,
  );

  const now = useMemo(() => new Date(), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(now, Number.parseInt(defaultSelected.value)),
    to: now,
  });

  const onSetDateDropdown = useCallback(
    (option: { label: string; value: string }) => {
      setDateDropdown(option.label);
    },
    [],
  );

  const options = useMemo(
    () => ({
      fromDate: dateRange?.from?.getTime(),
      toDate: dateRange?.to?.getTime(),
    }),
    [dateRange],
  );

  const {
    data: totalsData,
    isLoading: totalsLoading,
    error: totalsError,
  } = useOrgStatsTotals(organizationId, options);

  const {
    data: emailBucketsData,
    isLoading: emailBucketsLoading,
    error: emailBucketsError,
  } = useOrgStatsEmailBuckets(organizationId, options);

  const {
    data: rulesBucketsData,
    isLoading: rulesBucketsLoading,
    error: rulesBucketsError,
  } = useOrgStatsRulesBuckets(organizationId, options);

  if (membershipLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <AccessDenied message="你没有查看组织分析的权限。只有管理员可以访问此页面。" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DatePickerWithRange
          dateRange={dateRange}
          onSetDateRange={setDateRange}
          selectOptions={selectOptions}
          dateDropdown={dateDropdown}
          onSetDateDropdown={onSetDateDropdown}
        />
      </div>

      <div className="space-y-6">
        <LoadingContent
          loading={totalsLoading}
          error={totalsError}
          loadingComponent={
            <div className="grid gap-4 md:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          }
        >
          {totalsData && (
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title="收到的邮件"
                value={totalsData.totalEmails.toLocaleString()}
                icon={<Mail className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="执行的规则"
                value={totalsData.totalRules.toLocaleString()}
                icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="活跃成员"
                value={totalsData.activeMembers.toLocaleString()}
                icon={<Users className="h-4 w-4 text-muted-foreground" />}
              />
            </div>
          )}
        </LoadingContent>

        <div className="grid gap-4 md:grid-cols-2">
          <LoadingContent
            loading={emailBucketsLoading}
            error={emailBucketsError}
            loadingComponent={<Skeleton className="h-64" />}
          >
            {emailBucketsData && (
              <BucketChart
                title="邮件量分布"
                description="按所选时间段内收到的邮件数统计的用户数量"
                data={emailBucketsData}
                emptyMessage="暂无邮件数据。用户需要先加载他们的统计数据。"
                unit="封邮件"
              />
            )}
          </LoadingContent>

          <LoadingContent
            loading={rulesBucketsLoading}
            error={rulesBucketsError}
            loadingComponent={<Skeleton className="h-64" />}
          >
            {rulesBucketsData && (
              <BucketChart
                title="自动化使用分布"
                description="按所选时间段内执行的规则数统计的用户数量"
                data={rulesBucketsData}
                emptyMessage="暂无自动化数据。"
                unit="条规则"
              />
            )}
          </LoadingContent>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function BucketChart({
  title,
  description,
  data,
  emptyMessage,
  unit = "封邮件",
}: {
  title: string;
  description: string;
  data: { label: string; userCount: number }[];
  emptyMessage: string;
  unit?: string;
}) {
  const hasData = data.some((bucket) => bucket.userCount > 0);
  const maxValue = Math.max(...data.map((d) => d.userCount), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <MutedText>{description}</MutedText>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-40 items-center justify-center">
            <MutedText className="text-center">{emptyMessage}</MutedText>
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((bucket) => (
              <div key={bucket.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {bucket.label} {unit}
                  </span>
                  <span className="font-medium">{bucket.userCount} 名用户</span>
                </div>
                <div className="h-2 w-full rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{
                      width: `${(bucket.userCount / maxValue) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
