"use client";

import { useEffect, useState } from "react";
import { CheckCircle2Icon, LoaderIcon } from "lucide-react";
import useSWR from "swr";
import type { BatchExecutedRulesResponse } from "@/app/api/user/executed-rules/batch/route";
import type { ThreadsResponse } from "@/app/api/threads/route";
import { Badge } from "@/components/Badge";

export type ActivityLogEntry = {
  id: string;
  from: string;
  subject: string;
  status: "processing" | "completed" | "waiting";
  ruleName?: string;
};

export function ActivityLog({
  entries,
  processingCount = 0,
  paused = false,
  title = "处理活动",
  loading = false,
}: {
  entries: ActivityLogEntry[];
  processingCount?: number;
  paused?: boolean;
  title?: string;
  loading?: boolean;
}) {
  if (entries.length === 0 && !loading) return null;

  return (
    <div className="w-full min-w-0 rounded-lg border bg-muted overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {processingCount > 0 && !paused && (
          <span className="text-xs text-muted-foreground">
            {processingCount} 封处理中
          </span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto overflow-x-hidden">
        <div className="space-y-1 p-2">
          {entries.length === 0 && loading && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              正在获取邮件…
            </div>
          )}
          {entries.map((entry) => (
            <ActivityLogRow key={entry.id} entry={entry} paused={paused} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityLogRow({
  entry,
  paused,
}: {
  entry: ActivityLogEntry;
  paused: boolean;
}) {
  const isCompleted = entry.status === "completed";
  const showSpinner = entry.status === "processing" && !paused;

  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 text-xs">
      {isCompleted ? (
        <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-600" />
      ) : showSpinner ? (
        <LoaderIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-blue-600" />
      ) : (
        <div className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {entry.from}
          </span>
          <span className="flex-shrink-0">
            {entry.ruleName && (
              <Badge color={isCompleted ? "green" : "gray"}>
                {entry.ruleName}
              </Badge>
            )}
            {!entry.ruleName && isCompleted && (
              <Badge color="yellow">无匹配</Badge>
            )}
          </span>
        </div>
        <div className="truncate text-muted-foreground mt-0.5">
          {entry.subject}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 智能组件 - 数据获取与状态管理
// =============================================================================

type InternalActivityLogEntry = {
  threadId: string;
  messageId: string;
  from: string;
  subject: string;
  status: "processing" | "completed";
  ruleName?: string;
  timestamp: number;
};

export function BulkProcessActivityLog({
  threads,
  processedThreadIds,
  aiQueue,
  paused,
  loading = false,
}: {
  threads: ThreadsResponse["threads"];
  processedThreadIds: Set<string>;
  aiQueue: Set<string>;
  paused: boolean;
  loading?: boolean;
}) {
  const [activityLog, setActivityLog] = useState<InternalActivityLogEntry[]>(
    [],
  );

  // 新一轮运行开始时清空活动日志
  useEffect(() => {
    if (loading) {
      setActivityLog([]);
    }
  }, [loading]);

  // 从已处理的会话中获取消息 ID
  const messageIds = Array.from(processedThreadIds)
    .map((threadId) => {
      const thread = threads.find((t) => t.id === threadId);
      return thread?.messages?.[thread.messages.length - 1]?.id;
    })
    .filter((id): id is string => !!id)
    .slice(-20); // 保留最后 20 条

  // 检查活动日志中的所有条目是否都已完成
  const allCompleted =
    activityLog.length > 0 &&
    activityLog.every((entry) => entry.status === "completed");

  // 轮询已执行的规则 - 只要还有未处理的消息就持续轮询
  const { data: executedRulesData } = useSWR<BatchExecutedRulesResponse>(
    messageIds.length > 0 && !allCompleted
      ? `/api/user/executed-rules/batch?messageIds=${messageIds.join(",")}`
      : null,
    {
      refreshInterval: messageIds.length > 0 && !allCompleted ? 2000 : 0,
    },
  );

  // 当会话入队或规则执行时更新活动日志
  useEffect(() => {
    if (!threads.length) return;

    setActivityLog((prev) => {
      const existingMessageIds = new Set(prev.map((entry) => entry.messageId));
      const newEntries: InternalActivityLogEntry[] = [];

      for (const threadId of processedThreadIds) {
        const thread = threads.find((t) => t.id === threadId);
        if (!thread) continue;

        const message = thread.messages?.[thread.messages.length - 1];
        if (!message) continue;

        // 检查是否已在日志中（使用当前状态，而非过期的闭包值）
        if (existingMessageIds.has(message.id)) continue;

        const executedRule = executedRulesData?.rulesMap[message.id]?.[0];

        newEntries.push({
          threadId: thread.id,
          messageId: message.id,
          from: message.headers.from || "未知",
          subject: message.headers.subject || "（无主题）",
          status: executedRule ? "completed" : "processing",
          ruleName: executedRule?.rule?.name,
          timestamp: Date.now(),
        });

        // 记录新增项，防止本批次内出现重复
        existingMessageIds.add(message.id);
      }

      if (newEntries.length === 0) return prev;
      return [...newEntries, ...prev].slice(0, 50); // 保留最后 50 条
    });
  }, [processedThreadIds, executedRulesData, threads]);

  // 规则完成时更新已有条目
  useEffect(() => {
    if (!executedRulesData) return;

    setActivityLog((prev) =>
      prev.map((entry) => {
        if (entry.status === "completed") return entry;

        const executedRule = executedRulesData.rulesMap[entry.messageId]?.[0];
        if (executedRule) {
          return {
            ...entry,
            status: "completed" as const,
            ruleName: executedRule.rule?.name,
          };
        }
        return entry;
      }),
    );
  }, [executedRulesData]);

  // 将内部条目转换为展示组件的格式
  const entries: ActivityLogEntry[] = activityLog.map((entry) => {
    const isInQueue = aiQueue.has(entry.threadId);
    const isCompleted = entry.status === "completed";

    return {
      id: entry.messageId,
      from: entry.from,
      subject: entry.subject,
      status: isCompleted ? "completed" : isInQueue ? "processing" : "waiting",
      ruleName: entry.ruleName,
    };
  });

  // 统计当前正在处理的条目数（已入队但未完成）
  const processingCount = activityLog.filter(
    (entry) => aiQueue.has(entry.threadId) && entry.status !== "completed",
  ).length;

  return (
    <ActivityLog
      entries={entries}
      processingCount={processingCount}
      paused={paused}
      loading={loading}
    />
  );
}
