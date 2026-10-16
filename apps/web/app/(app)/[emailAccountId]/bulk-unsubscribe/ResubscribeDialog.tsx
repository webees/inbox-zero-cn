"use client";

import { useState } from "react";
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

  // 解除屏蔽时不调用 mutate——对话框关闭后再刷新
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
          <DialogTitle>重新订阅「{senderName}」</DialogTitle>
          <DialogDescription className="pt-2">
            按照以下步骤，即可重新收到此发件人的邮件。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border">
          {/* 步骤 1 */}
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
                <div className="font-medium">解除屏蔽发件人</div>
                <p className="text-sm text-muted-foreground">
                  我们目前会自动归档此发件人的邮件。点击「解除屏蔽」以允许接收其邮件。
                </p>
              </div>
              {unblockComplete ? (
                <p className="shrink-0 text-sm font-medium text-green-600">
                  已解除屏蔽
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
                  解除屏蔽
                </Button>
              )}
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t" />

          {/* 步骤 2 */}
          <div className="flex gap-4 p-4">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium">
              {doneLoading ? (
                <CheckIcon className="size-4 text-green-600" />
              ) : (
                "2"
              )}
            </div>
            <div>
              <div className="font-medium">手动重新订阅</div>
              <p className="text-sm text-muted-foreground">
                访问发件人的网站并手动重新订阅。
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
            取消
          </Button>
          <Button
            onClick={handleDone}
            disabled={!unblockComplete || doneLoading}
          >
            {doneLoading && <ButtonLoader />}
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
