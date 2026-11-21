"use client";

import { useState } from "react";
import { parseAsBoolean, useQueryState } from "nuqs";
import { Plural, Trans } from "@lingui/react/macro";
import { toastError } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  CardGreen,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cleanInboxAction } from "@/utils/actions/clean";
import { CleanAction } from "@/generated/prisma/enums";
import type { CleanupJob } from "@/generated/prisma/client";
import { PREVIEW_RUN_COUNT } from "@/app/(app)/[emailAccountId]/clean/consts";
import { useAccount } from "@/providers/EmailAccountProvider";

export function PreviewBatch({ job }: { job: CleanupJob }) {
  const { emailAccountId } = useAccount();
  const [, setIsPreviewBatch] = useQueryState("isPreviewBatch", parseAsBoolean);
  const [isLoading, setIsLoading] = useState(false);

  const handleRunOnFullInbox = async () => {
    setIsLoading(true);
    setIsPreviewBatch(false);
    const result = await cleanInboxAction(emailAccountId, {
      daysOld: job.daysOld,
      instructions: job.instructions || "",
      action: job.action,
      skips: {
        reply: job.skipReply,
        starred: job.skipStarred,
        calendar: job.skipCalendar,
        receipt: job.skipReceipt,
        attachment: job.skipAttachment,
        conversation: job.skipConversation,
      },
    });

    setIsLoading(false);

    if (result?.serverError) {
      toastError({ description: result.serverError });
      return;
    }
  };

  return (
    <CardGreen className="mb-4">
      <CardHeader>
        <CardTitle>
          <Trans>预览运行</Trans>
        </CardTitle>
        {/* <CardDescription>
          我们处理了 {total} 封邮件。其中 {archived} 封已{" "}
          {job.action === CleanAction.ARCHIVE ? "归档" : "标记为已读"}。
        </CardDescription> */}
        <CardDescription>
          <Plural
            value={PREVIEW_RUN_COUNT}
            one="我们正在清理 # 封邮件，让你了解它的工作方式。"
            other="我们正在清理 # 封邮件，让你了解它的工作方式。"
          />
        </CardDescription>
        <CardDescription>
          {job.action === CleanAction.ARCHIVE ? (
            <Trans>如需撤销，请将鼠标悬停在“归档”徽章上并点击撤销。</Trans>
          ) : (
            <Trans>
              如需撤销，请将鼠标悬停在“标记为已读”徽章上并点击撤销。
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Button onClick={handleRunOnFullInbox} loading={isLoading}>
          <Trans>在完整收件箱上运行</Trans>
        </Button>
        {/* {disableRunOnFullInbox && (
          <CardDescription className="font-semibold">
            所有邮件都已处理完毕
          </CardDescription>
        )} */}
      </CardContent>
    </CardGreen>
  );
}
