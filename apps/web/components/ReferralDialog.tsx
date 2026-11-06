"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { usePostHog } from "posthog-js/react";
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
          <span className="font-semibold">推荐好友</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <Referrals source="sidebar" />
      </DialogContent>
    </Dialog>
  );
}

export function Referrals({ source }: { source: ReferralSurface }) {
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
        description: `推荐${type === "code" ? "码" : "链接"}已复制到剪贴板！`,
      });
    } catch {
      toastError({
        title: `复制${type === "code" ? "推荐码" : "推荐链接"}失败`,
        description: "请重试",
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
          title: "通过我的推荐链接加入 Inbox Zero",
          text: "使用我的推荐链接开始使用 Inbox Zero！",
          url: link,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          toastError({
            title: "分享失败",
            description: "请重试",
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
    return <ErrorDisplay error={{ error: "加载推荐数据出错" }} />;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <PageHeading>推荐好友，赢取奖励</PageHeading>
        <PageSubHeading className="mt-2">
          把 Inbox Zero 分享给好友，每位完成试用的好友都能为你赢得一个月免费使用
        </PageSubHeading>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>你的推荐码</CardTitle>
          <CardDescription>与好友分享此推荐码即可赢取奖励</CardDescription>
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
                  复制链接
                </Button>
                <Button
                  onClick={shareReferralLink}
                  variant="default"
                  className="flex-1"
                >
                  <Share2 className="mr-2 h-4 w-4" />
                  分享
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">无法加载推荐码</p>
          )}
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      {statsData && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">推荐总数</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsData.stats.totalReferrals}
              </div>
              <p className="text-xs text-muted-foreground">你推荐的好友</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">已获奖励</CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsData.stats.totalRewards}
              </div>
              <p className="text-xs text-muted-foreground">已获免费月数</p>
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
