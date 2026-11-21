"use client";

import { useCallback, useState } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import useSWR from "swr";
import { LoadingContent } from "@/components/LoadingContent";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeading } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import type { DebugFollowUpResponse } from "@/app/api/user/debug/follow-up/route";
import { useAccount } from "@/providers/EmailAccountProvider";

export default function DebugFollowUpPage() {
  const { emailAccountId } = useAccount();
  const { data, isLoading, error } = useSWR<DebugFollowUpResponse>(
    emailAccountId ? ["/api/user/debug/follow-up", emailAccountId] : null,
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!data) return;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  return (
    <PageWrapper>
      <PageHeading>跟进调试</PageHeading>

      <LoadingContent loading={isLoading} error={error}>
        <div className="mt-6 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DebugStat
              label="等待回复（天）"
              value={data?.emailAccount.followUpAwaitingReplyDays ?? "关闭"}
            />
            <DebugStat
              label="需要回复（天）"
              value={data?.emailAccount.followUpNeedsReplyDays ?? "关闭"}
            />
            <DebugStat
              label="自动草稿"
              value={
                data?.emailAccount.followUpAutoDraftEnabled ? "开启" : "关闭"
              }
            />
            <DebugStat
              label="未解决的追踪器"
              value={data?.summary.unresolvedTrackers ?? 0}
            />
            <DebugStat
              label="未解决 + 已应用"
              value={data?.summary.unresolvedWithFollowUpApplied ?? 0}
            />
            <DebugStat
              label="未解决 + 草稿"
              value={data?.summary.unresolvedWithFollowUpDraft ?? 0}
            />
          </div>

          <div className="rounded-lg border p-4 text-sm">
            <p>
              <span className="font-medium">上次应用的跟进：</span>{" "}
              {formatDate(data?.summary.lastFollowUpAppliedAt)}
            </p>
            <p className="mt-2">
              <span className="font-medium">上次追踪器活动：</span>{" "}
              {formatDate(data?.summary.lastTrackerActivityAt)}
            </p>
            <p className="mt-2 text-muted-foreground">
              上次追踪器活动可反映跟进处理活动。
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!data}
            >
              {copied ? (
                <CheckIcon className="mr-2 h-4 w-4" />
              ) : (
                <CopyIcon className="mr-2 h-4 w-4" />
              )}
              {copied ? "已复制" : "复制 JSON"}
            </Button>
          </div>

          <div className="rounded-lg border bg-muted/50 p-4">
            <pre className="overflow-auto text-sm">
              {data ? JSON.stringify(data, null, 2) : "加载中…"}
            </pre>
          </div>
        </div>
      </LoadingContent>
    </PageWrapper>
  );
}

function DebugStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "从未";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString();
}
