"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { SettingCard } from "@/components/SettingCard";
import { MutedText } from "@/components/Typography";
import { prefixPath } from "@/utils/path";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/Input";
import { Toggle } from "@/components/Toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/Badge";
import { useActionTiming } from "@/hooks/useActionTiming";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useFollowUpRemindersEnabled } from "@/hooks/useFeatureFlags";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useAction } from "next-safe-action/hooks";
import {
  toggleFollowUpRemindersAction,
  updateFollowUpSettingsAction,
  scanFollowUpRemindersAction,
} from "@/utils/actions/follow-up-reminders";
import {
  type SaveFollowUpSettingsFormInput,
  DEFAULT_FOLLOW_UP_DAYS,
} from "@/utils/actions/follow-up-reminders.validation";
import { toast } from "sonner";
import { toastError, toastSuccess } from "@/components/Toast";
import { getEmailTerminology } from "@/utils/terminology";
import { getGmailBasicSearchUrl } from "@/utils/url";
import { FOLLOW_UP_LABEL } from "@/utils/label";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { env } from "@/env";

export function FollowUpRemindersSetting() {
  const isFeatureEnabled = useFollowUpRemindersEnabled();

  if (!isFeatureEnabled) return null;

  return <FollowUpRemindersSettingContent />;
}

function FollowUpRemindersSettingContent() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, mutate } = useEmailAccountFull();

  const enabled =
    data?.followUpAwaitingReplyDays !== null ||
    data?.followUpNeedsReplyDays !== null;

  const { execute: executeToggle } = useAction(
    toggleFollowUpRemindersAction.bind(null, data?.id ?? ""),
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
        followUpAwaitingReplyDays: enable ? DEFAULT_FOLLOW_UP_DAYS : null,
        followUpNeedsReplyDays: enable ? DEFAULT_FOLLOW_UP_DAYS : null,
      };
      mutate(optimisticData as typeof data, false);
      executeToggle({ enabled: enable });
    },
    [data, mutate, executeToggle],
  );

  return (
    <SettingCard
      title="跟进提醒"
      description="为尚未收到回复或你尚未回复的邮件打标签。"
      right={
        isLoading ? (
          <Skeleton className="h-5 w-9" />
        ) : (
          <div className="flex items-center gap-2">
            {enabled && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    配置
                  </Button>
                </DialogTrigger>
                <FollowUpSettingsDialogContent
                  showChannelsHint
                  onSuccess={() => {
                    mutate();
                    setOpen(false);
                  }}
                />
              </Dialog>
            )}
            <Toggle
              name="follow-up-enabled"
              enabled={enabled}
              onChange={handleToggle}
              disabled={!data}
            />
          </div>
        )
      }
    />
  );
}

export function FollowUpSettingsDialogContent({
  onSuccess,
  showChannelsHint = true,
}: {
  onSuccess: () => void;
  showChannelsHint?: boolean;
}) {
  const { data } = useEmailAccountFull();

  if (!data) return null;

  return (
    <FollowUpSettingsDialog
      emailAccountId={data.id}
      emailAddress={data.email ?? ""}
      followUpAwaitingReplyDays={data.followUpAwaitingReplyDays}
      followUpNeedsReplyDays={data.followUpNeedsReplyDays}
      followUpAutoDraftEnabled={data.followUpAutoDraftEnabled ?? true}
      showChannelsHint={showChannelsHint}
      onSuccess={onSuccess}
    />
  );
}

function FollowUpSettingsDialog({
  emailAccountId,
  emailAddress,
  followUpAwaitingReplyDays,
  followUpNeedsReplyDays,
  followUpAutoDraftEnabled,
  showChannelsHint,
  onSuccess,
}: {
  emailAccountId: string;
  emailAddress: string;
  followUpAwaitingReplyDays: number | null | undefined;
  followUpNeedsReplyDays: number | null | undefined;
  followUpAutoDraftEnabled: boolean;
  showChannelsHint: boolean;
  onSuccess: () => void;
}) {
  const { provider } = useAccount();
  const terminology = getEmailTerminology(provider);
  const autoDraftDisabled = env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SaveFollowUpSettingsFormInput>({
    defaultValues: {
      followUpAwaitingReplyDays: followUpAwaitingReplyDays?.toString() ?? "",
      followUpNeedsReplyDays: followUpNeedsReplyDays?.toString() ?? "",
      followUpAutoDraftEnabled: autoDraftDisabled
        ? false
        : followUpAutoDraftEnabled,
    },
  });

  const autoDraftValue = watch("followUpAutoDraftEnabled");
  const { start: startScanTiming, getElapsedMs: getScanElapsedMs } =
    useActionTiming();

  const { execute, isExecuting } = useAction(
    updateFollowUpSettingsAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "设置已保存！" });
        onSuccess();
      },
      onError: (error) => {
        toastError({
          description: error.error?.serverError ?? "保存设置失败",
        });
      },
    },
  );

  const { execute: executeScan, isExecuting: isScanning } = useAction(
    scanFollowUpRemindersAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        showScanCompleteToast(provider, emailAddress);
      },
      onError: (error) => {
        const ranForMinutes = getScanElapsedMs() > 4 * 60 * 1000;

        if (ranForMinutes) {
          showScanCompleteToast(provider, emailAddress);
        } else {
          toastError({
            description: error.error?.serverError ?? "扫描失败",
          });
        }
      },
    },
  );

  const onSubmit = (formData: SaveFollowUpSettingsFormInput) => {
    execute({
      followUpAwaitingReplyDays: formData.followUpAwaitingReplyDays
        ? Number(formData.followUpAwaitingReplyDays)
        : null,
      followUpNeedsReplyDays: formData.followUpNeedsReplyDays
        ? Number(formData.followUpNeedsReplyDays)
        : null,
      followUpAutoDraftEnabled: autoDraftDisabled
        ? false
        : formData.followUpAutoDraftEnabled,
    });
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>跟进提醒</DialogTitle>
        <DialogDescription>
          在会话需要关注时收到提醒。
          <br />
          我们会添加一个 <Badge color="blue">跟进</Badge>{" "}
          {terminology.label.singular}，方便你轻松找到它们。周六和周日不计入。
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          type="number"
          name="followUpAwaitingReplyDays"
          label="当他们超过以下天数未回复时提醒我"
          registerProps={register("followUpAwaitingReplyDays")}
          error={errors.followUpAwaitingReplyDays}
          min={0.001}
          max={90}
          step={0.001}
          rightText="天"
        />

        <Input
          type="number"
          name="followUpNeedsReplyDays"
          label="当我超过以下天数未回复时提醒我"
          registerProps={register("followUpNeedsReplyDays")}
          error={errors.followUpNeedsReplyDays}
          min={0.001}
          max={90}
          step={0.001}
          rightText="天"
        />

        {!autoDraftDisabled && (
          <div className="flex items-center justify-between">
            <div>
              <label
                htmlFor="followUpAutoDraftEnabled"
                className="block text-sm font-medium text-foreground"
              >
                自动生成草稿
              </label>
              <p className="text-muted-foreground text-sm">
                在未收到回复时起草一封催促邮件。
              </p>
            </div>
            <Toggle
              name="followUpAutoDraftEnabled"
              enabled={autoDraftValue}
              onChange={(value) => setValue("followUpAutoDraftEnabled", value)}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={isExecuting}>
            保存
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isScanning}
            onClick={() => {
              startScanTiming();
              toast.info("正在扫描你的邮件…", {
                description: "这可能需要几分钟，具体取决于需要检查的邮件数量。",
              });
              executeScan({});
            }}
          >
            查找跟进
          </Button>
        </div>

        {showChannelsHint && (
          <MutedText>
            想在聊天应用中接收提醒？{" "}
            <Link
              href={prefixPath(emailAccountId, "/channels")}
              className="text-foreground underline"
            >
              在渠道页面配置
            </Link>
            .
          </MutedText>
        )}
      </form>
    </DialogContent>
  );
}

function showScanCompleteToast(
  provider: string | undefined,
  emailAddress: string,
) {
  if (isGoogleProvider(provider)) {
    const searchUrl = getGmailBasicSearchUrl(
      emailAddress,
      `label:${FOLLOW_UP_LABEL}`,
    );
    toast.success("扫描完成！", {
      description: "在 Gmail 中查看你的跟进事项。",
      action: {
        label: "查看",
        onClick: () => window.open(searchUrl, "_blank"),
      },
    });
  } else {
    toast.success("扫描完成！", {
      description: `在 Outlook 中查找“${FOLLOW_UP_LABEL}”分类。`,
    });
  }
}
