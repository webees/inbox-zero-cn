"use client";

import { AlertCircleIcon, ClockIcon, LoaderCircleIcon } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { UpcomingScheduledEmailsResponse } from "@/app/api/user/scheduled-emails/route";
import { InlineActionButton } from "@/components/InlineActionButton";
import { LoadingContent } from "@/components/LoadingContent";
import { useScheduledEmailActions } from "@/hooks/useScheduledEmailActions";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { useUpcomingScheduledEmails } from "@/hooks/useHiddenDraftMessageIds";

type ScheduledEmail =
  UpcomingScheduledEmailsResponse["scheduledEmails"][number];

export function ScheduledEmailList() {
  const { t, i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const { data, isLoading, error } = useUpcomingScheduledEmails(emailAccountId);
  const { cancelSend, retrySend } = useScheduledEmailActions(emailAccountId);

  const rows = data?.scheduledEmails ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <LoadingContent loading={isLoading} error={error}>
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground text-sm">
              <Trans>
                没有已安排的邮件。你稍后发送的邮件在发出前会显示在这里。
              </Trans>
            </div>
          ) : (
            <ul aria-label={t`已安排的邮件`}>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-b px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground text-sm">
                      {row.subject?.trim() || t`（无主题）`}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {row.to?.trim() || t`无收件人`}
                    </p>
                  </div>
                  <p
                    role="status"
                    className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs"
                  >
                    <StatusIcon status={row.status} />
                    {statusLabel(row, i18n)}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {["PENDING", "BLOCKED_AUTH", "FAILED"].includes(
                      row.status,
                    ) && (
                      <InlineActionButton onClick={() => cancelSend(row.id)}>
                        <Trans>取消发送</Trans>
                      </InlineActionButton>
                    )}
                    {row.status === "UNCERTAIN" && (
                      // 取消和重试都不接受状态不确定的邮件，因此这是解决它的唯一方式。
                      <a
                        className="text-xs underline underline-offset-4"
                        href={prefixPath(emailAccountId, "/mail?type=sent")}
                      >
                        <Trans>查看已发送</Trans>
                      </a>
                    )}
                    {["BLOCKED_AUTH", "FAILED"].includes(row.status) && (
                      <InlineActionButton onClick={() => retrySend(row.id)}>
                        <Trans>重试发送</Trans>
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

function statusLabel(row: ScheduledEmail, i18n: I18n) {
  switch (row.status) {
    case "PENDING":
      return formatTime(row.sendAt, i18n);
    case "PROCESSING":
      return i18n._(msg`正在发送…`);
    case "UNCERTAIN":
      return i18n._(msg`无法确认送达`);
    case "BLOCKED_AUTH":
      return i18n._(msg`请重新连接账号以发送此邮件`);
    default:
      return i18n._(msg`需要处理`);
  }
}

function formatTime(value: string | Date, i18n: I18n) {
  return i18n.date(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
