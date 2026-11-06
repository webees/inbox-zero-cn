"use client";

import { useState } from "react";
import { parseAsBoolean, useQueryState } from "nuqs";
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
        <CardTitle>预览运行</CardTitle>
        {/* <CardDescription>
          我们处理了 {total} 封邮件。其中 {archived} 封{" "}
          {job.action === CleanAction.ARCHIVE ? "已归档" : "已标为已读"}。
        </CardDescription> */}
        <CardDescription>
          我们正在清理 {PREVIEW_RUN_COUNT} 封邮件，让你看看效果。
        </CardDescription>
        <CardDescription>
          若要撤销，请将鼠标悬停在 "
          {job.action === CleanAction.ARCHIVE ? "归档" : "标为已读"}"
          徽章上，然后点击撤销。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Button onClick={handleRunOnFullInbox} loading={isLoading}>
          对全部收件箱运行
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
