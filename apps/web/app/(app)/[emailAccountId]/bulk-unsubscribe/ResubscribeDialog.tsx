"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLoader } from "@/components/Loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setSenderStatusAction } from "@/utils/actions/unsubscriber";

interface ResubscribeDialogProps {
  emailAccountId: string;
  mutate: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  senderEmail: string;
  senderName: string;
}

export function ResubscribeDialog({
  open,
  onOpenChange,
  senderName,
  senderEmail,
  emailAccountId,
  mutate,
}: ResubscribeDialogProps) {
  const [unblockComplete, setUnblockComplete] = useState(false);
  const [unblockLoading, setUnblockLoading] = useState(false);
  const [doneLoading, setDoneLoading] = useState(false);

  // 解除屏蔽时不调用 mutate，改为在对话框关闭时刷新
  const handleUnblock = async () => {
    setUnblockLoading(true);
    try {
      await setSenderStatusAction(emailAccountId, {
        senderEmail,
        status: null,
      });
      setUnblockComplete(true);
    } finally {
      setUnblockLoading(false);
    }
  };

  const handleDialogClose = (dialogOpen: boolean) => {
    if (!dialogOpen && !doneLoading) {
      onOpenChange(false);
      setUnblockComplete(false);
      setDoneLoading(false);
      mutate();
    }
  };

  const handleDone = async () => {
    setDoneLoading(true);
    try {
      await mutate();
    } finally {
      onOpenChange(false);
      setUnblockComplete(false);
      setDoneLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>重新订阅“{senderName}”</Trans>
          </DialogTitle>
          <DialogDescription className="pt-2">
            <Trans>按照以下步骤重新接收该发件人的邮件</Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border">
          {/* Step 1 */}
          <div className="flex gap-4 p-4">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium">
              {unblockComplete ? (
                <CheckIcon className="size-4 text-green-600" />
              ) : (
                "1"
              )}
            </div>
            <div className="flex flex-1 items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  <Trans>解除屏蔽发件人</Trans>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    我们目前会自动归档该发件人的邮件。点击“解除屏蔽”以允许接收他们的邮件
                  </Trans>
                </p>
              </div>
              {unblockComplete ? (
                <p className="shrink-0 text-sm font-medium text-green-600">
                  <Trans>已解除屏蔽</Trans>
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleUnblock}
                  disabled={unblockLoading}
                >
                  {unblockLoading && <ButtonLoader />}
                  <Trans>解除屏蔽</Trans>
                </Button>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="border-t" />

          {/* Step 2 */}
          <div className="flex gap-4 p-4">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium">
              {doneLoading ? (
                <CheckIcon className="size-4 text-green-600" />
              ) : (
                "2"
              )}
            </div>
            <div>
              <div className="font-medium">
                <Trans>手动重新订阅</Trans>
              </div>
              <p className="text-sm text-muted-foreground">
                <Trans>访问发件人的网站并手动重新订阅</Trans>
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleDialogClose(false)}
            disabled={doneLoading}
          >
            <Trans>取消</Trans>
          </Button>
          <Button
            onClick={handleDone}
            disabled={!unblockComplete || doneLoading}
          >
            {doneLoading && <ButtonLoader />}
            <Trans>完成</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
