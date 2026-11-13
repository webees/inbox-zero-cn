"use client";

import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const setOpen = useSetAtom(feedbackDialogOpenAtom);

  return (
    <SidebarMenuButton
      tooltip={t`反馈`}
      sidebarName="left-sidebar"
      className="h-9 font-semibold"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
    >
      <MessageSquarePlusIcon />
      <span>
        <Trans>反馈</Trans>
      </span>
    </SidebarMenuButton>
  );
}

export function FeedbackDialog() {
  const { t } = useLingui();
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
      toastSuccess({ description: t`感谢你的反馈！` });
      reset();
      setOpen(false);
    },
    onError: (error) => {
      toastError({
        description: getActionErrorMessage(error.error, {
          prefix: t`提交反馈失败`,
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
          <DialogTitle>
            <Trans>发送反馈</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              告诉我们你喜欢什么、哪里令人困惑，或者你希望我们接下来开发什么。
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="text"
            name="feedback"
            autosizeTextarea
            rows={5}
            placeholder={t`你在想什么？`}
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
              <Trans>取消</Trans>
            </Button>
            <Button type="submit" loading={isExecuting}>
              <Trans>提交</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
