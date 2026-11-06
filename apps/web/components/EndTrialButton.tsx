"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCardIcon } from "lucide-react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError } from "@/components/Toast";
import type { GetTrialPreviewResponse } from "@/app/api/user/trial-preview/route";
import { endStripeTrialAction } from "@/utils/actions/premium";
import { formatDateSimple } from "@/utils/date";
import { formatStripeAmount } from "@/utils/stripe-amount";

export function EndTrialButton({
  variant,
  size,
  className,
  showIcon = true,
}: Pick<ButtonProps, "variant" | "size" | "className"> & {
  showIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [endingTrial, setEndingTrial] = useState(false);
  const { mutate } = useSWRConfig();

  // 聚焦时重新校验：在后台标签页中保持打开的对话框
  // 不能按与屏幕上不再一致的金额扣款。
  const {
    data: preview,
    isLoading,
    isValidating,
    error,
  } = useSWR<GetTrialPreviewResponse>(open ? "/api/user/trial-preview" : null);

  const endTrial = async () => {
    setEndingTrial(true);
    const result = await endStripeTrialAction().finally(() => {
      setEndingTrial(false);
    });

    if (result?.serverError) {
      toastError({ description: result.serverError });
      return;
    }

    setOpen(false);

    if (result?.data?.status === "active") {
      toast.success("你的付费套餐已生效。");
    } else {
      toast.message("你的试用已结束。");
    }

    await Promise.all([
      mutate("/api/user/me"),
      mutate("/api/user/ai-automation-status"),
    ]);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          Icon={showIcon ? CreditCardIcon : undefined}
        >
          立即开始付费套餐
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>结束免费试用并立即付款？</AlertDialogTitle>
          <LoadingContent loading={isLoading} error={error}>
            {preview && (
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    我们将立即从你的银行卡扣款{" "}
                    <span className="font-semibold text-foreground">
                      {formatStripeAmount(preview.amountDue, preview.currency)}
                    </span>{" "}
                    ，用于 {preview.planName} 套餐
                    {preview.interval
                      ? `，按${billingCadence[preview.interval]}计费`
                      : ""}
                    。
                  </p>
                  {preview.trialEnd && (
                    <p>
                      你无需执行此操作即可继续使用 Inbox Zero。你的试用已包含
                      所有付费功能，并免费持续到{" "}
                      {formatDateSimple(new Date(preview.trialEnd))}
                      ，届时将自动进行相同的扣款。
                    </p>
                  )}
                  <p>
                    想换其他套餐或按月付费？{" "}
                    <Link href="/premium" className="underline">
                      先更改套餐
                    </Link>
                    。
                  </p>
                </div>
              </AlertDialogDescription>
            )}
          </LoadingContent>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>保留免费试用</AlertDialogCancel>
          <Button
            loading={endingTrial}
            disabled={!preview || isValidating}
            onClick={endTrial}
          >
            {preview
              ? `立即支付 ${formatStripeAmount(preview.amountDue, preview.currency)}`
              : "立即支付"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const billingCadence: Record<
  NonNullable<GetTrialPreviewResponse["interval"]>,
  string
> = {
  day: "每天",
  week: "每周",
  month: "每月",
  year: "每年",
};
