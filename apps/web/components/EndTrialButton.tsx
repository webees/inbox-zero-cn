"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCardIcon } from "lucide-react";
import { toast } from "sonner";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();

  // Revalidate on focus: a dialog left open in a background tab must not
  // charge an amount that no longer matches what is on screen.
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
      toast.success(t`Your paid plan is active.`);
    } else {
      toast.message(t`你的试用已结束。`);
    }

    await Promise.all([
      mutate("/api/user/me"),
      mutate("/api/user/ai-automation-status"),
    ]);
  };

  const amount = preview
    ? formatStripeAmount(preview.amountDue, preview.currency)
    : null;
  const planName = preview?.planName;
  const cadence = preview?.interval
    ? i18n._(billingCadence[preview.interval])
    : null;
  const trialEndDate = preview?.trialEnd
    ? formatDateSimple(new Date(preview.trialEnd))
    : null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          Icon={showIcon ? CreditCardIcon : undefined}
        >
          <Trans>立即开始付费套餐</Trans>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>结束免费试用并立即付款？</Trans>
          </AlertDialogTitle>
          <LoadingContent loading={isLoading} error={error}>
            {preview && (
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    {cadence ? (
                      <Trans>
                        我们将立即从你的银行卡扣款{" "}
                        <span className="font-semibold text-foreground">
                          {amount}
                        </span>{" "}
                        ，用于 {planName} 套餐，按{cadence}计费。
                      </Trans>
                    ) : (
                      <Trans>
                        我们将立即从你的银行卡扣款{" "}
                        <span className="font-semibold text-foreground">
                          {amount}
                        </span>{" "}
                        ，用于 {planName} 套餐。
                      </Trans>
                    )}
                  </p>
                  {trialEndDate && (
                    <p>
                      <Trans>
                        你无需这样做也能继续使用 Inbox
                        Zero。你的试用已包含所有付费功能，并免费持续到{" "}
                        {trialEndDate}，届时将自动进行相同的扣款。
                      </Trans>
                    </p>
                  )}
                  <p>
                    <Trans>
                      想选择其他套餐或按月付款？
                      <Link href="/premium" className="underline">
                        先更改你的套餐
                      </Link>
                      .
                    </Trans>
                  </p>
                </div>
              </AlertDialogDescription>
            )}
          </LoadingContent>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>保留免费试用</Trans>
          </AlertDialogCancel>
          <Button
            loading={endingTrial}
            disabled={!preview || isValidating}
            onClick={endTrial}
          >
            {amount ? (
              <Trans>立即支付 {amount}</Trans>
            ) : (
              <Trans>立即支付</Trans>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const billingCadence: Record<
  NonNullable<GetTrialPreviewResponse["interval"]>,
  MessageDescriptor
> = {
  day: msg`每日`,
  week: msg`每周`,
  month: msg`每月`,
  year: msg`每年`,
};
