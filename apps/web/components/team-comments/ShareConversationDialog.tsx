"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { shareConversationAction } from "@/utils/actions/team-comments";
import { getActionErrorMessage } from "@/utils/error";

export function ShareConversationDialog({
  memberId,
  emailAccountId,
  threadId,
  teammates,
  onShared,
}: {
  memberId: string;
  emailAccountId: string;
  threadId: string;
  teammates: Array<{
    id: string;
    emailAccount: { name: string | null; email: string; image: string | null };
  }>;
  onShared: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const { executeAsync, isExecuting } = useAction(shareConversationAction);
  const [error, setError] = useState("");
  const close = () => {
    setOpen(false);
    setSelected([]);
    setError("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else if (!isExecuting) close();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" className="shrink-0">
          <Trans>分享</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>分享会话</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              团队成员可以阅读此会话（包括后续回复）并留下内部评论，但不能通过你的账号发送邮件。
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <div
          className="max-h-64 space-y-3 overflow-auto"
          aria-label={t`选择团队成员`}
          role="group"
        >
          {teammates.map((teammate) => (
            <div
              className="flex cursor-pointer items-center gap-3"
              key={teammate.id}
            >
              <Checkbox
                id={`share-teammate-${teammate.id}`}
                checked={selected.includes(teammate.id)}
                onCheckedChange={(checked) =>
                  setSelected((current) =>
                    checked
                      ? [...current, teammate.id]
                      : current.filter((id) => id !== teammate.id),
                  )
                }
              />
              <label htmlFor={`share-teammate-${teammate.id}`}>
                {teammate.emailAccount.name ?? teammate.emailAccount.email}
              </label>
            </div>
          ))}
        </div>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={isExecuting}>
            <Trans>取消</Trans>
          </Button>
          <Button
            disabled={!selected.length || isExecuting}
            onClick={async () => {
              setError("");
              const result = await executeAsync({
                memberId,
                source: { emailAccountId, threadId },
                participantMemberIds: selected,
              });
              if (result?.data) {
                close();
                onShared();
              } else setError(getActionErrorMessage(result ?? {}));
            }}
          >
            {isExecuting ? t`正在分享…` : t`分享会话`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
