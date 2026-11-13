"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SettingCard } from "@/components/SettingCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Toggle } from "@/components/Toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeToPlusButton } from "@/components/UpgradeToPlusButton";
import { DigestSettingsForm } from "@/app/(app)/[emailAccountId]/settings/DigestSettingsForm";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useAction } from "next-safe-action/hooks";
import { toggleDigestAction } from "@/utils/actions/settings";
import { toastError } from "@/components/Toast";
import { createCanonicalTimeOfDay } from "@/utils/schedule";
import { usePremium } from "@/hooks/usePremium";
import { hasTierAccess } from "@/utils/premium";

export function DigestSetting() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { data, isLoading, mutate } = useEmailAccountFull();
  const { tier, isLoading: isLoadingPremium } = usePremium();

  const enabled = data?.digestSchedule != null;
  const hasDigestAccess = hasTierAccess({
    tier,
    minimumTier: "PLUS_MONTHLY",
  });

  const { execute: executeToggle } = useAction(
    toggleDigestAction.bind(null, data?.id ?? ""),
    {
      onError: (error) => {
        mutate();
        toastError({
          description: error.error?.serverError ?? t`Failed to update settings`,
        });
      },
    },
  );

  const handleToggle = useCallback(
    (enable: boolean) => {
      if (!data) return;

      const optimisticData = {
        ...data,
        digestSchedule: enable ? {} : null,
      };
      mutate(optimisticData as typeof data, false);
      executeToggle({
        enabled: enable,
        timeOfDay: enable ? createCanonicalTimeOfDay(9, 0) : undefined,
      });
    },
    [data, mutate, executeToggle],
  );

  const renderRight = () => {
    if (isLoading || isLoadingPremium) {
      return <Skeleton className="h-5 w-9" />;
    }

    if (!hasDigestAccess) {
      return (
        <UpgradeToPlusButton
          tooltip={t`升级到 Plus 套餐以启用每日邮件摘要。`}
        />
      );
    }

    return (
      <div className="flex items-center gap-2">
        {enabled && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trans>配置</Trans>
              </Button>
            </DialogTrigger>
            <DigestSettingsDialogContent onSuccess={() => setOpen(false)} />
          </Dialog>
        )}
        <Toggle
          name="digest-enabled"
          enabled={enabled}
          onChange={handleToggle}
        />
      </div>
    );
  };

  return (
    <SettingCard
      title={t`邮件摘要`}
      description={t`按你设定的时间，获取符合所选规则的邮件摘要。`}
      right={renderRight()}
    />
  );
}

export function DigestSettingsDialogContent({
  onSuccess,
  showChannelsHint = true,
}: {
  onSuccess?: () => void;
  showChannelsHint?: boolean;
}) {
  return (
    <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          <Trans>邮件摘要设置</Trans>
        </DialogTitle>
        <DialogDescription>
          <Trans>配置邮件摘要的发送时间以及包含哪些规则</Trans>
        </DialogDescription>
      </DialogHeader>

      <DigestSettingsForm
        onSuccess={onSuccess}
        showChannelsHint={showChannelsHint}
      />
    </DialogContent>
  );
}
