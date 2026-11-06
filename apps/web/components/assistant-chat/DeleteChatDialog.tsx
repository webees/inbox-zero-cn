"use client";

import { useAction } from "next-safe-action/hooks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import { deleteChatAction } from "@/utils/actions/chat";
import { getActionErrorMessage } from "@/utils/error";

export function DeleteChatDialog({
  open,
  onOpenChange,
  chatId,
  label,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  label: string;
  onDeleted: () => void;
}) {
  const { emailAccountId } = useAccount();
  const { execute, isExecuting } = useAction(
    deleteChatAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "聊天已删除。" });
        onDeleted();
        onOpenChange(false);
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: "删除聊天失败",
          }),
        });
      },
    },
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除聊天？</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{label}&rdquo;
            将从你的聊天记录中移除，其中的消息将被隐去。此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isExecuting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              execute({ chatId });
            }}
            disabled={isExecuting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isExecuting ? "删除中…" : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
