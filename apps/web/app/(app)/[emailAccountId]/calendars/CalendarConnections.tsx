"use client";

import { useEffect } from "react";
import { CalendarCheckIcon, FileTextIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingContent } from "@/components/LoadingContent";
import { useCalendars } from "@/hooks/useCalendars";
import { CalendarConnectionCard } from "./CalendarConnectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { TypographyP } from "@/components/Typography";
import { toastError } from "@/components/Toast";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";

export function CalendarConnections() {
  useCalendarNotifications();
  const { data, isLoading, error } = useCalendars();
  const connections = data?.connections || [];

  return (
    <LoadingContent loading={isLoading} error={error}>
      <div className="space-y-6">
        {connections.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <TypographyP className="text-sm">
                  连接你的日历即可解锁：
                </TypographyP>

                <TypographyP className="text-sm flex items-center gap-2">
                  <CalendarCheckIcon className="size-4 text-blue-600" />
                  <span className="min-w-0">
                    依据你的真实空闲时间生成 AI 回复
                  </span>
                </TypographyP>

                <TypographyP className="text-sm flex items-center gap-2">
                  <FileTextIcon className="size-4 text-blue-600" />
                  <span className="min-w-0">每次通话前的会议简报</span>
                </TypographyP>
              </div>

              <div className="mt-4">
                <ConnectCalendar />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 max-sm:grid-cols-1">
            <ConnectCalendar />

            {connections.map((connection) => (
              <CalendarConnectionCard
                key={connection.id}
                connection={connection}
              />
            ))}
          </div>
        )}
      </div>
    </LoadingContent>
  );
}

function useCalendarNotifications() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const analytics = useProductAnalytics("calendars");

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (!errorParam) return;

    const errorDescription = searchParams.get("error_description");
    const errorMessages: Record<
      string,
      { title: string; description: string }
    > = {
      consent_declined: {
        title: "未授予日历授权同意",
        description:
          "Microsoft 返回 AADSTS65004，表示授权同意页面被取消或未完成。请完成授权同意后重试。",
      },
      admin_consent_required: {
        title: "需要管理员授权同意",
        description:
          "你的 Microsoft 365 租户需要管理员批准。请让管理员在 Entra ID 中为此应用授予授权同意，然后重试。",
      },
      access_denied: {
        title: "日历访问被拒绝",
        description: "Microsoft 拒绝了该请求。请重试，或让管理员批准访问。",
      },
      invalid_state: {
        title: "无效的日历请求",
        description: "此日历授权请求无效。请重试。",
      },
      invalid_state_format: {
        title: "无效的日历请求",
        description: "我们无法验证日历授权。请重试。",
      },
      missing_code: {
        title: "日历授权已取消",
        description: "我们未收到来自 Microsoft 的授权码。请重试连接。",
      },
      connection_failed: {
        title: "日历连接失败",
        description: "我们无法完成日历连接。请重试。",
      },
      oauth_error: {
        title: "日历连接失败",
        description: "Microsoft 返回了 OAuth 错误。请重试或联系支持人员。",
      },
    };

    const errorMessage = errorMessages[errorParam] || {
      title: "日历连接失败",
      description: errorDescription || "我们无法完成日历连接。请重试。",
    };

    toastError({
      title: errorMessage.title,
      description: errorMessage.description,
    });
    analytics.captureAction("calendar_connect_failed", {
      error_code: errorParam,
    });

    router.replace(pathname);
  }, [analytics, pathname, router, searchParams]);
}
