"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type { MailDiagnostics } from "@inboxzero/mail-core/engine";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import {
  isPendingEffectStatus,
  type OperationStatus,
} from "@inboxzero/mail-core/operations";
import { LoadingContent } from "@/components/LoadingContent";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeading } from "@/components/Typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";

const STATUS_DESCRIPTIONS = {
  preparing: "准备中",
  queued: "已加入本地队列",
  executing: "正在发送到服务商",
  verifying: "正在与邮箱确认",
  retry_wait: "等待重试",
  blocked_auth: "重新连接账号",
  uncertain: "结果未知",
  needs_attention: "需要处理",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  superseded: "已被取代",
} satisfies Record<OperationStatus, string>;

export default function MailQueuePage() {
  const { emailAccountId } = useAccount();
  return <MailQueue key={emailAccountId} emailAccountId={emailAccountId} />;
}

function MailQueue({ emailAccountId }: { emailAccountId: string }) {
  const client = useOptionalMailClient();
  const [filter, setFilter] = useState("active");
  const [limit, setLimit] = useState(50);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    client ? ["mail-queue-diagnostics", emailAccountId, filter, limit] : null,
    async () => {
      if (!client) throw new Error("邮件引擎不可用");
      const diagnostics = await client.getDiagnostics(emailAccountId);
      return {
        ...summarizeDiagnostics(diagnostics, filter, limit),
        online: navigator.onLine,
        readAt: Date.now(),
      };
    },
    { refreshInterval: 2000, refreshWhenOffline: true },
  );

  return (
    <PageWrapper className="space-y-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageHeading>邮件队列</PageHeading>
          <p className="mt-2 text-sm text-muted-foreground">
            此浏览器中该账号的引擎操作。打开时每 2 秒刷新一次。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={prefixPath(emailAccountId, "/debug")}>返回调试</Link>
          </Button>
          <Button
            variant="outline"
            disabled={isValidating || !client}
            onClick={() => mutate()}
          >
            刷新
          </Button>
        </div>
      </div>
      <LoadingContent
        loading={isLoading || !client}
        error={
          error
            ? {
                error:
                  error instanceof Error
                    ? error.message
                    : "无法读取邮件引擎队列。",
              }
            : undefined
        }
      >
        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>待处理操作</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold">{data.activeCount}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    结果未知：{data.uncertainCount} · 同步任务：{" "}
                    {data.pendingJobs}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>连接</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>{connectionLabel(data.connection, data.online)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    更新于 {formatTime(data.readAt)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>邮箱覆盖范围</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{coverageLabel(data.coverage)}</p>
                  <p className="text-muted-foreground">
                    上次完成同步： {formatTime(data.lastCompletedSyncAtMs)}
                  </p>
                </CardContent>
              </Card>
            </div>
            <p className="text-sm text-muted-foreground">
              “待处理”包括已接受但尚未达到终态的操作。这里显示的是本地引擎，而不是服务商内部的处理。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="queue-status" className="text-sm font-medium">
                状态
              </label>
              <Select
                value={filter}
                onValueChange={(value) => {
                  setFilter(value);
                  setLimit(50);
                }}
              >
                <SelectTrigger id="queue-status" className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    待处理操作（{data.activeCount}）
                  </SelectItem>
                  <SelectItem value="all">全部（{data.total}）</SelectItem>
                  {Object.entries(STATUS_DESCRIPTIONS).map(
                    ([status, description]) => (
                      <SelectItem key={status} value={status}>
                        {description} ({data.counts[status] ?? 0})
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                显示 {data.commands.length} / {data.matchingCount} 个操作
              </span>
            </div>
            {data.matchingCount === 0 ? (
              <p className="rounded-md border p-6 text-sm text-muted-foreground">
                没有操作匹配此状态。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>操作</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>消息</TableHead>
                    <TableHead>会话</TableHead>
                    <TableHead>详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_td]:align-top">
                  {data.commands.map((command) => (
                    <TableRow key={command.operationId}>
                      <TableCell className="whitespace-nowrap">
                        {(command.changeKind ?? command.kind).replaceAll(
                          "_",
                          " ",
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            command.status === "failed" ||
                            command.status === "uncertain" ||
                            command.status === "blocked_auth" ||
                            command.status === "needs_attention"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {STATUS_DESCRIPTIONS[command.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{command.messageIds.length}</TableCell>
                      <TableCell>{command.conversationIds.length}</TableCell>
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer whitespace-nowrap">
                            查看操作详情
                          </summary>
                          <dl className="mt-3 min-w-56 space-y-2 break-all text-xs">
                            <dt>操作 ID</dt>
                            <dd>{command.operationId}</dd>
                            {command.conversationIds.length > 0 && (
                              <>
                                <dt>会话 ID</dt>
                                <dd>{command.conversationIds.join(", ")}</dd>
                              </>
                            )}
                            {command.messageIds.length > 0 && (
                              <>
                                <dt>消息 ID</dt>
                                <dd>{command.messageIds.join(", ")}</dd>
                              </>
                            )}
                          </dl>
                        </details>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {data.matchingCount > limit && (
              <Button variant="outline" onClick={() => setLimit(limit + 50)}>
                显示更多
              </Button>
            )}
          </>
        )}
      </LoadingContent>
    </PageWrapper>
  );
}

function summarizeDiagnostics(
  diagnostics: MailDiagnostics,
  filter: string,
  limit: number,
) {
  const counts = Object.fromEntries(
    Object.keys(STATUS_DESCRIPTIONS).map((status) => [status, 0]),
  ) as Record<string, number>;
  for (const command of diagnostics.commands) {
    counts[command.status] = (counts[command.status] ?? 0) + 1;
  }
  const matching = diagnostics.commands.filter((command) => {
    if (filter === "all") return true;
    if (filter === "active") {
      return (
        command.status === "preparing" || isPendingEffectStatus(command.status)
      );
    }
    return command.status === filter;
  });
  const coverage = diagnostics.coverage[0];
  return {
    connection: diagnostics.connection,
    coverage: coverage?.metadata,
    lastCompletedSyncAtMs: coverage?.lastCompletedSyncAtMs ?? null,
    activeCount: diagnostics.pendingOperations,
    uncertainCount: diagnostics.uncertainOperations,
    pendingJobs: diagnostics.pendingJobs,
    total: diagnostics.commands.length,
    matchingCount: matching.length,
    counts,
    commands: matching.slice(0, limit),
  };
}

function formatTime(timestamp?: number | null) {
  if (
    timestamp === undefined ||
    timestamp === null ||
    !Number.isFinite(timestamp)
  )
    return "—";
  return new Date(timestamp).toLocaleString();
}

function connectionLabel(
  connection: MailDiagnostics["connection"],
  online: boolean,
) {
  if (connection === "blocked_auth") return "重新连接账号";
  if (connection === "offline" || !online) return "离线 — 操作将等待连接";
  return "在线";
}

function coverageLabel(
  metadata?: MailDiagnostics["coverage"][number]["metadata"],
) {
  if (!metadata) return "未记录覆盖范围";
  return metadata === "complete" ? "元数据完整" : "正在追赶";
}
