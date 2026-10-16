"use client";

import { useAtom, useSetAtom } from "jotai";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquarePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { submitFeedbackAction } from "@/utils/actions/feedback";
import {
  submitFeedbackBody,
  type SubmitFeedbackBody,
} from "@/utils/actions/feedback.validation";
import { getActionErrorMessage } from "@/utils/error";
import { feedbackDialogOpenAtom } from "@/store/command-palette";

export function FeedbackSidebarButton() {
  const setOpen = useSetAtom(feedbackDialogOpenAtom);

  return (
    <SidebarMenuButton
      tooltip="反馈"
      sidebarName="left-sidebar"
      className="h-9 font-semibold"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
    >
      <MessageSquarePlusIcon />
      <span>反馈</span>
    </SidebarMenuButton>
  );
}

export function FeedbackDialog() {
  const [open, setOpen] = useAtom(feedbackDialogOpenAtom);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SubmitFeedbackBody>({
    resolver: zodResolver(submitFeedbackBody),
    defaultValues: { feedback: "" },
  });

  const { execute, isExecuting } = useAction(submitFeedbackAction, {
    onSuccess: () => {
      toastSuccess({ description: "感谢你的反馈！" });
      reset();
      setOpen(false);
    },
    onError: (error) => {
      toastError({
        description: getActionErrorMessage(error.error, {
          prefix: "提交反馈失败",
        }),
      });
    },
  });

  const onSubmit: SubmitHandler<SubmitFeedbackBody> = (data) => {
    execute(data);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发送反馈</DialogTitle>
          <DialogDescription>
            告诉我们你喜欢什么、哪里不清楚，或者你希望我们接下来开发什么。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="text"
            name="feedback"
            autosizeTextarea
            rows={5}
            placeholder="你有什么想法？"
            registerProps={register("feedback")}
            error={errors.feedback}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isExecuting}
            >
              取消
            </Button>
            <Button type="submit" loading={isExecuting}>
              提交
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
