"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Trans, useLingui } from "@lingui/react/macro";
import { ViewLearnedPatterns } from "@/app/(app)/[emailAccountId]/assistant/group/ViewLearnedPatterns";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createGroupAction } from "@/utils/actions/group";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { Skeleton } from "@/components/ui/skeleton";

export function LearnedPatternsDialog({
  ruleId,
  groupId,
  disabled,
  label,
}: {
  ruleId: string;
  groupId: string | null;
  disabled?: boolean;
  label?: string;
}) {
  const { emailAccountId } = useAccount();
  const { t } = useLingui();

  const [learnedPatternGroupId, setLearnedPatternGroupId] = useState<
    string | null
  >(groupId);

  const { execute, isExecuting } = useAction(
    createGroupAction.bind(null, emailAccountId),
    {
      onSuccess: (data) => {
        if (data.data?.groupId) {
          setLearnedPatternGroupId(data.data.groupId);
        } else {
          toastError({
            description: t`There was an error setting up learned patterns.`,
          });
        }
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={async () => {
            if (!ruleId) return;
            if (groupId) return;
            if (isExecuting) return;

            execute({ ruleId });
          }}
        >
          {label ?? t`查看已学习的模式`}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            <Trans>已学习的模式</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              已学习的模式是 AI
              从你的邮件历史中学习到的模式。当匹配到已学习的模式时，
              其他规则条件会被跳过，并自动选择此规则。
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 overflow-y-auto">
          {isExecuting ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            learnedPatternGroupId && (
              <ViewLearnedPatterns groupId={learnedPatternGroupId} />
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
