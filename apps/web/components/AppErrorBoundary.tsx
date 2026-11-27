"use client";

import * as Sentry from "@sentry/nextjs";
import { AlertCircle, Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { env } from "@/env";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getAppErrorBoundaryLogContext } from "@/components/app-error-boundary-log-context";
import { createClientLogger } from "@/utils/logger-client";

export function AppErrorBoundary({
  error,
  reset,
  title = "出错了",
  description,
  onBack,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  onBack?: () => void;
}) {
  const [capturedError, setCapturedError] = useState<{
    error: Error;
    eventId: string;
  }>();
  const supportReference =
    capturedError?.error === error ? capturedError.eventId : undefined;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{
    emailAccountId?: string;
    ruleId?: string;
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: log each boundary error once with the route context captured at that time
  useEffect(() => {
    const logger = createClientLogger("app-error-boundary");
    const context = getAppErrorBoundaryLogContext({
      error,
      params,
      pathname,
      searchParams,
    });
    // 与异常详情关联，但不把原始错误文本复制到 Axiom。
    const sentryEventId = Sentry.captureException(error, { extra: context });
    setCapturedError({ error, eventId: sentryEventId });
    logger.error("应用错误边界已触发", {
      ...context,
      sentryEventId,
    });
    logger.flush().catch(() => undefined);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10">
            <AlertCircle className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>
            {description ||
              "无法加载此视图。请重试。如果问题仍然存在，请使用下方的参考编号联系支持团队。"}
          </EmptyDescription>
        </EmptyHeader>
        <div className="mt-6 flex flex-col flex-wrap justify-center gap-2 sm:flex-row">
          <Button onClick={reset} variant="outline">
            <RotateCcw className="mr-2 size-4" />
            重试
          </Button>
          {onBack && (
            <Button type="button" onClick={onBack} variant="outline">
              返回收件箱
            </Button>
          )}
          <Button asChild>
            <Link href="/">
              <Home className="mr-2 size-4" />
              返回首页
            </Link>
          </Button>
        </div>
        {supportReference && (
          <p className="break-all text-xs text-muted-foreground">
            支持参考编号：{" "}
            <span className="select-all font-mono">{supportReference}</span>
          </p>
        )}
        <p className="mt-6 text-sm text-muted-foreground">
          如果此错误仍然存在，请联系支持团队：{" "}
          <a
            href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}?${new URLSearchParams({ subject: "应用错误报告", body: `支持参考编号：${supportReference || error.digest || "不可用"}` })}`}
            className="break-all underline"
          >
            {env.NEXT_PUBLIC_SUPPORT_EMAIL}
          </a>
        </p>
      </Empty>
    </div>
  );
}
