"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { usePostHog } from "posthog-js/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Share2, Users, Trophy, GiftIcon } from "lucide-react";
import { toastError, toastSuccess } from "@/components/Toast";
import type { GetReferralStatsResponse } from "@/app/api/referrals/stats/route";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { GetReferralCodeResponse } from "@/app/api/referrals/code/route";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { generateReferralLink } from "@/utils/referral/referral-link";
import { PageHeading, PageSubHeading } from "@/components/Typography";

export type ReferralSurface = "account_menu" | "refer_page" | "sidebar";

export function ReferralDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <SidebarMenuButton sidebarName="left-sidebar">
          <GiftIcon />
          <span className="font-semibold">
            <Trans>推荐好友</Trans>
          </span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <Referrals source="sidebar" />
      </DialogContent>
    </Dialog>
  );
}

export function Referrals({ source }: { source: ReferralSurface }) {
  const { t } = useLingui();
  const posthog = usePostHog();
  const {
    data: codeData,
    isLoading: loadingCode,
    error: errorCode,
  } = useSWR<GetReferralCodeResponse>("/api/referrals/code");

  const {
    data: statsData,
    isLoading: loadingStats,
    error: errorStats,
  } = useSWR<GetReferralStatsResponse>("/api/referrals/stats");

  const loading = loadingCode || loadingStats;

  useEffect(() => {
    posthog?.capture("Referral Surface Shown", { source });
  }, [posthog, source]);

  const link = generateReferralLink(codeData?.code || "");

  const copyToClipboard = async (
    text: string,
    type: "code" | "link",
    captureAction = true,
  ) => {
    if (captureAction) {
      posthog?.capture("Clicked Referral Surface", {
        action: `copy_${type}`,
        source,
      });
    }

    try {
      await navigator.clipboard.writeText(text);
      toastSuccess({
        description:
          type === "code"
            ? t`推荐码已复制到剪贴板！`
            : t`推荐链接已复制到剪贴板！`,
      });
    } catch {
      toastError({
        title: type === "code" ? t`复制推荐码失败` : t`复制链接失败`,
        description: t`请重试`,
      });
    }
  };

  const shareReferralLink = async () => {
    if (!codeData?.code) return;

    posthog?.capture("Clicked Referral Surface", {
      action: "share",
      method:
        typeof navigator.share === "function"
          ? "native_share"
          : "copy_fallback",
      source,
    });

    if (navigator.share) {
      try {
        await navigator.share({
          title: t`使用我的推荐链接加入 Inbox Zero`,
          text: t`使用我的推荐链接开始使用 Inbox Zero！`,
          url: link,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          toastError({
            title: t`分享失败`,
            description: t`请重试`,
          });
        }
      }
    } else {
      copyToClipboard(link, "link", false);
    }
  };

  if (loading) {
    return <ReferralDashboardSkeleton />;
  }

  if (errorCode || errorStats) {
    return <ErrorDisplay error={{ error: t`加载推荐数据时出错` }} />;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <PageHeading>
          <Trans>推荐好友，赢取奖励</Trans>
        </PageHeading>
        <PageSubHeading className="mt-2">
          <Trans>
            与好友分享 Inbox
            Zero，每有一位好友完成试用，你就能获得一个月免费使用
          </Trans>
        </PageSubHeading>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>你的推荐码</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>将此推荐码分享给好友以赢取奖励</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {codeData?.code ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-gray-50 p-3 sm:p-4">
                <div className="overflow-x-auto">
                  <span className="font-mono text-sm sm:text-base lg:text-lg font-bold text-gray-900 break-all">
                    {link}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => copyToClipboard(link, "link")}
                  variant="outline"
                  className="flex-1"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  <Trans>复制链接</Trans>
                </Button>
                <Button
                  onClick={shareReferralLink}
                  variant="default"
                  className="flex-1"
                >
                  <Share2 className="mr-2 h-4 w-4" />
                  <Trans>分享</Trans>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">
              <Trans>无法加载推荐码</Trans>
            </p>
          )}
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      {statsData && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <Trans>推荐总数</Trans>
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsData.stats.totalReferrals}
              </div>
              <p className="text-xs text-muted-foreground">
                <Trans>你推荐的好友</Trans>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <Trans>已获得奖励</Trans>
              </CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsData.stats.totalRewards}
              </div>
              <p className="text-xs text-muted-foreground">
                <Trans>已获得的免费月数</Trans>
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ReferralDashboardSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <Skeleton className="mx-auto h-8 sm:h-10 w-full max-w-sm" />
        <Skeleton className="mx-auto mt-3 sm:mt-4 h-5 sm:h-6 w-full max-w-md" />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-full max-w-xs" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 sm:h-20 w-full" />
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
