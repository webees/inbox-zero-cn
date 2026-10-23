"use client";

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
          description: error.error?.serverError ?? "更新设置失败",
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
        <UpgradeToPlusButton tooltip="升级到 Plus 套餐以启用每日摘要邮件。" />
      );
    }

    return (
      <div className="flex items-center gap-2">
        {enabled && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                配置
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
      title="摘要"
      description="按你的计划，获取由你所选规则匹配的邮件摘要。"
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
        <DialogTitle>摘要设置</DialogTitle>
        <DialogDescription>
          配置摘要邮件的发送时间以及包含哪些规则。
        </DialogDescription>
      </DialogHeader>

      <DigestSettingsForm
        onSuccess={onSuccess}
        showChannelsHint={showChannelsHint}
      />
    </DialogContent>
  );
}
