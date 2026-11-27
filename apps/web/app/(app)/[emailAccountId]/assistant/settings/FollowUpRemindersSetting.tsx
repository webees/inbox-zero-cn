"use client";

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  type SaveFollowUpSettingsBody,
  type SaveFollowUpSettingsFormInput,
  DEFAULT_FOLLOW_UP_DAYS,
} from "@/utils/actions/follow-up-reminders.validation";
import { toast } from "sonner";
import { toastError, toastSuccess } from "@/components/Toast";
import { getGmailBasicSearchUrl } from "@/utils/url";
import { FOLLOW_UP_LABEL } from "@/utils/label";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { getActionErrorMessage } from "@/utils/error";
import { env } from "@/env";
import { useDraftReplies } from "@/app/(app)/[emailAccountId]/assistant/settings/DraftReplies";

export function FollowUpRemindersSetting() {
  const isFeatureEnabled = useFollowUpRemindersEnabled();

  if (!isFeatureEnabled) return null;

  return <FollowUpRemindersSettingContent />;
}

function FollowUpRemindersSettingContent() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { data, isLoading, mutate } = useEmailAccountFull();

  const { enabled: draftRepliesEnabled } = useDraftReplies();

  const enabled =
    data?.followUpAwaitingReplyDays !== null ||
    data?.followUpNeedsReplyDays !== null;
  // Nudge drafts are only written for awaiting-reply reminders.
  const draftsFollowUps =
    data?.followUpAwaitingReplyDays != null &&
    draftRepliesEnabled &&
    !!data?.followUpAutoDraftEnabled &&
    !env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED;

  const { execute: executeToggle } = useAction(
    toggleFollowUpRemindersAction.bind(null, data?.id ?? ""),
    {
      onError: (error) => {
        mutate();
        toastError({
          title: t`Failed to update follow-up reminders`,
          description: getActionErrorMessage(error.error, t`Unknown error`),
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
      title={t`跟进提醒`}
      description={
        draftsFollowUps
          ? t`为还没收到回复或你尚未回复的邮件添加标签，并在你还没收到回复时起草提醒邮件。`
          : t`为还没收到回复或你尚未回复的邮件添加标签。不会起草邮件。`
      }
      right={
        isLoading ? (
          <Skeleton className="h-5 w-9" />
        ) : (
          <div className="flex items-center gap-2">
            {enabled && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Trans>配置</Trans>
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
  const { data, mutate } = useEmailAccountFull();

  if (!data) return null;

  return (
    <FollowUpSettingsDialog
      emailAccountId={data.id}
      emailAddress={data.email ?? ""}
      followUpAwaitingReplyDays={data.followUpAwaitingReplyDays}
      followUpNeedsReplyDays={data.followUpNeedsReplyDays}
      followUpAutoDraftEnabled={data.followUpAutoDraftEnabled ?? false}
      showChannelsHint={showChannelsHint}
      onSuccess={(saved) => {
        mutate({ ...data, ...saved });
        onSuccess();
      }}
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
  onSuccess: (saved: SaveFollowUpSettingsBody) => void;
}) {
  const { t, i18n } = useLingui();
  const { enabled: draftRepliesEnabled } = useDraftReplies();
  const { provider } = useAccount();
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
      onSuccess: ({ input }) => {
        toastSuccess({ description: t`Settings saved!` });
        onSuccess(input);
      },
      onError: (error) => {
        toastError({
          title: t`Failed to save follow-up settings`,
          description: getActionErrorMessage(error.error, t`Unknown error`),
        });
      },
    },
  );

  const { execute: executeScan, isExecuting: isScanning } = useAction(
    scanFollowUpRemindersAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        showScanCompleteToast(provider, emailAddress, i18n);
      },
      onError: (error) => {
        const ranForMinutes = getScanElapsedMs() > 4 * 60 * 1000;

        if (ranForMinutes) {
          showScanCompleteToast(provider, emailAddress, i18n);
        } else {
          toastError({
            title: t`Failed to scan for follow-ups`,
            description: getActionErrorMessage(error.error, t`Unknown error`),
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
        <DialogTitle>
          <Trans>跟进提醒</Trans>
        </DialogTitle>
        <DialogDescription>
          <Trans>需要关注的会话会提醒你。</Trans>
          <br />
          {isMicrosoftProvider(provider) ? (
            <Trans>
              我们会添加一个 <Badge color="blue">{FOLLOW_UP_LABEL}</Badge>{" "}
              类别，以便轻松找到它们。周六和周日不计入。
            </Trans>
          ) : (
            <Trans>
              我们会添加一个 <Badge color="blue">{FOLLOW_UP_LABEL}</Badge>{" "}
              标签，以便轻松找到它们。周六和周日不计入。
            </Trans>
          )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          type="number"
          name="followUpAwaitingReplyDays"
          label={t`他们超过以下天数未回复时提醒我`}
          registerProps={register("followUpAwaitingReplyDays")}
          error={errors.followUpAwaitingReplyDays}
          min={0.001}
          max={90}
          step={0.001}
          rightText={t`天`}
        />

        <Input
          type="number"
          name="followUpNeedsReplyDays"
          label={t`我超过以下天数未回复时提醒我`}
          registerProps={register("followUpNeedsReplyDays")}
          error={errors.followUpNeedsReplyDays}
          min={0.001}
          max={90}
          step={0.001}
          rightText={t`天`}
        />

        {!autoDraftDisabled && (
          <div className="flex items-center justify-between">
            <div>
              <label
                htmlFor="followUpAutoDraftEnabled"
                className="block text-sm font-medium text-foreground"
              >
                <Trans>起草跟进邮件</Trans>
              </label>
              <p className="text-muted-foreground text-sm">
                {draftRepliesEnabled ? (
                  <Trans>当你还没收到回复时，起草一封提醒邮件。</Trans>
                ) : (
                  <Trans>请先开启“起草回复”才能使用此功能。</Trans>
                )}
              </p>
            </div>
            <Toggle
              name="followUpAutoDraftEnabled"
              ariaLabel={t`起草跟进邮件`}
              enabled={draftRepliesEnabled && autoDraftValue}
              disabled={!draftRepliesEnabled}
              onChange={(value) => setValue("followUpAutoDraftEnabled", value)}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={isExecuting}>
            <Trans>保存</Trans>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isScanning}
            onClick={() => {
              startScanTiming();
              toast.info(t`正在扫描你的邮件...`, {
                description: t`取决于需要检查的邮件数量，这可能需要几分钟。`,
              });
              executeScan({});
            }}
          >
            <Trans>查找跟进事项</Trans>
          </Button>
        </div>

        {showChannelsHint && (
          <MutedText>
            <Trans>
              想在聊天应用中收到提醒吗？{" "}
              <Link
                href={prefixPath(emailAccountId, "/channels")}
                className="text-foreground underline"
              >
                前往渠道页面进行配置
              </Link>
              .
            </Trans>
          </MutedText>
        )}
      </form>
    </DialogContent>
  );
}

function showScanCompleteToast(
  provider: string | undefined,
  emailAddress: string,
  i18n: I18n,
) {
  if (isGoogleProvider(provider)) {
    const searchUrl = getGmailBasicSearchUrl(
      emailAddress,
      `label:${FOLLOW_UP_LABEL}`,
    );
    toast.success(i18n._(msg`扫描完成！`), {
      description: i18n._(msg`在 Gmail 中查看你的跟进事项。`),
      action: {
        label: i18n._(msg`查看`),
        onClick: () => window.open(searchUrl, "_blank"),
      },
    });
  } else {
    toast.success(i18n._(msg`扫描完成！`), {
      description: i18n._(msg`在 Outlook 中查找“${FOLLOW_UP_LABEL}”类别。`),
    });
  }
}
