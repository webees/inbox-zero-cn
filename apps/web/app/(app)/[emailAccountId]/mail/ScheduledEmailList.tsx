"use client";

import { useState } from "react";
import { AlertCircleIcon, ClockIcon, LoaderCircleIcon } from "lucide-react";
import type { UpcomingScheduledEmailsResponse } from "@/app/api/user/scheduled-emails/route";
import { InlineActionButton } from "@/components/InlineActionButton";
import { LoadingContent } from "@/components/LoadingContent";
import {
  cancelScheduledEmailAction,
  retryScheduledEmailAction,
} from "@/utils/actions/scheduled-email";
import { getActionErrorMessage } from "@/utils/error";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { useUpcomingScheduledEmails } from "@/hooks/useHiddenDraftMessageIds";

type ScheduledEmail =
  UpcomingScheduledEmailsResponse["scheduledEmails"][number];

export function ScheduledEmailList() {
  const { emailAccountId } = useAccount();
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error, mutate } =
    useUpcomingScheduledEmails(emailAccountId);

  const runScheduledAction = async (
    action: typeof cancelScheduledEmailAction,
    id: string,
  ) => {
    const result = await action(emailAccountId, { id });
    if (result?.serverError || result?.validationErrors)
      throw new Error(getActionErrorMessage(result));
  };

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await action();
      // 操作已经成功；刷新失败只是数据过时，并不是取消失败，
      // 而且 SWR 会自行重试。
      await mutate().catch(() => {});
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "出了点问题");
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.scheduledEmails ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {actionError && (
        <p role="alert" className="px-4 py-2 text-destructive text-xs">
          {actionError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <LoadingContent loading={isLoading} error={error}>
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground text-sm">
              没有已定时的邮件。你稍后发送的邮件会显示在这里，直到它们开始发送。
            </div>
          ) : (
            <ul aria-label="已定时邮件">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-b px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground text-sm">
                      {row.subject?.trim() || "（无主题）"}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {row.to?.trim() || "无收件人"}
                    </p>
                  </div>
                  <p
                    role="status"
                    className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs"
                  >
                    <StatusIcon status={row.status} />
                    {statusLabel(row)}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {["PENDING", "BLOCKED_AUTH", "FAILED"].includes(
                      row.status,
                    ) && (
                      <InlineActionButton
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            runScheduledAction(
                              cancelScheduledEmailAction,
                              row.id,
                            ),
                          )
                        }
                      >
                        取消发送
                      </InlineActionButton>
                    )}
                    {row.status === "UNCERTAIN" && (
                      // 取消和重试都不接受状态不确定的行，因此
                      // 这是解决该行的唯一方式。
                      <a
                        className="text-xs underline underline-offset-4"
                        href={prefixPath(emailAccountId, "/mail?type=sent")}
                      >
                        查看已发送
                      </a>
                    )}
                    {["BLOCKED_AUTH", "FAILED"].includes(row.status) && (
                      <InlineActionButton
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            runScheduledAction(
                              retryScheduledEmailAction,
                              row.id,
                            ),
                          )
                        }
                      >
                        重试发送
                      </InlineActionButton>
                    )}
                  </div>
                  {row.error && (
                    <p className="basis-full text-destructive text-xs">
                      {row.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </LoadingContent>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ScheduledEmail["status"] }) {
  if (status === "PROCESSING")
    return <LoaderCircleIcon className="size-3.5 animate-spin" />;
  if (status === "PENDING") return <ClockIcon className="size-3.5" />;
  return <AlertCircleIcon className="size-3.5 text-destructive" />;
}

function statusLabel(row: ScheduledEmail) {
  switch (row.status) {
    case "PENDING":
      return formatTime(row.sendAt);
    case "PROCESSING":
      return "发送中…";
    case "UNCERTAIN":
      return "无法确认投递";
    case "BLOCKED_AUTH":
      return "重新连接账号以发送此邮件";
    default:
      return "需要注意";
  }
}

function formatTime(value: string | Date) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
