"use client";

import { Settings2Icon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlackNotificationTargetSelect } from "@/components/SlackNotificationTargetSelect";
import { Tooltip } from "@/components/Tooltip";
import { Toggle } from "@/components/Toggle";
import { toastError, toastSuccess } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAutomationJob } from "@/hooks/useAutomationJob";
import {
  saveAutomationJobAction,
  toggleAutomationJobAction,
  triggerTestCheckInAction,
} from "@/utils/actions/automation-jobs";
import { createSettingActionErrorHandler } from "@/utils/actions/error-handling";
import {
  AUTOMATION_CRON_PRESETS,
  DEFAULT_AUTOMATION_JOB_CRON,
} from "@/utils/automation-jobs/defaults";
import { describeCronSchedule } from "@/utils/automation-jobs/describe";
import { getActionErrorMessage } from "@/utils/error";
import { getMessagingProviderName } from "@/utils/messaging/platforms";
import { cn } from "@/utils";
import {
  MessagingProvider,
  MessagingRoutePurpose,
} from "@/generated/prisma/enums";
import type { GetMessagingChannelsResponse } from "@/app/api/user/messaging-channels/route";

type Channel = GetMessagingChannelsResponse["channels"][number];

export function ProactiveUpdatesSetting({
  channel,
  emailAccountId,
  onUpdate,
}: {
  channel: Channel;
  emailAccountId: string;
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cronExpression, setCronExpression] = useState(
    DEFAULT_AUTOMATION_JOB_CRON,
  );
  const [prompt, setPrompt] = useState("");
  const [showCronEditor, setShowCronEditor] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const isDialogFormInitializedRef = useRef(false);

  const { data, isLoading, mutate } = useAutomationJob(emailAccountId);
  const job = data?.job ?? null;
  const activeForChannel = job?.messagingChannelId === channel.id;
  const enabled = activeForChannel && Boolean(job?.enabled);

  useEffect(() => {
    if (!open) {
      isDialogFormInitializedRef.current = false;
      return;
    }

    if (isDialogFormInitializedRef.current) return;

    setCronExpression(job?.cronExpression ?? DEFAULT_AUTOMATION_JOB_CRON);
    setPrompt(job?.prompt ?? "");
    setShowCustomPrompt(Boolean(job?.prompt?.trim()));
    setShowCronEditor(false);

    isDialogFormInitializedRef.current = true;
  }, [open, job]);

  const { execute: executeToggle, status: toggleStatus } = useAction(
    toggleAutomationJobAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
        onUpdate();
        toastSuccess({ description: "定时签到已更新" });
      },
      onError: createSettingActionErrorHandler({
        mutate,
        defaultMessage: "更新设置失败",
      }),
    },
  );

  const { execute: executeSave, status: saveStatus } = useAction(
    saveAutomationJobAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
        onUpdate();
        setOpen(false);
        toastSuccess({ description: "定时签到设置已保存" });
      },
      onError: createSettingActionErrorHandler({
        defaultMessage: "保存设置失败",
      }),
    },
  );

  const { execute: executeTestCheckIn, status: testCheckInStatus } = useAction(
    triggerTestCheckInAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "测试签到已发送" });
      },
      onError: (error) => {
        const description =
          getActionErrorMessage(error.error) ?? "发送测试签到失败";
        toastError({ description });
      },
    },
  );

  const handleToggle = useCallback(
    (nextEnabled: boolean) => {
      if (!nextEnabled) {
        if (!enabled) return;
        executeToggle({ enabled: false });
        return;
      }

      if (activeForChannel && job) {
        executeToggle({ enabled: true });
        return;
      }

      setOpen(true);
    },
    [activeForChannel, enabled, executeToggle, job],
  );

  const selectedPreset = useMemo(
    () =>
      AUTOMATION_CRON_PRESETS.find(
        (preset) => preset.cronExpression === cronExpression,
      ) ?? null,
    [cronExpression],
  );

  const scheduleText = useMemo(
    () => describeCronSchedule(cronExpression),
    [cronExpression],
  );
  const isSlack = channel.provider === MessagingProvider.SLACK;
  let summaryText = "在聊天中获取定期摘要。";
  if (activeForChannel && job) {
    summaryText = describeCronSchedule(
      job.cronExpression ?? DEFAULT_AUTOMATION_JOB_CRON,
    );
  }

  const handleSave = useCallback(() => {
    executeSave({
      cronExpression,
      messagingChannelId: channel.id,
      prompt,
    });
  }, [channel.id, cronExpression, executeSave, prompt]);

  return (
    <>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>定时签到</ItemTitle>
          <ItemDescription>{summaryText}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Tooltip content="配置">
            <Button variant="ghost" size="iconSm" onClick={() => setOpen(true)}>
              <Settings2Icon className="h-4 w-4" />
            </Button>
          </Tooltip>
          {isSlack && (
            <SlackNotificationTargetSelect
              emailAccountId={emailAccountId}
              messagingChannelId={channel.id}
              purpose={MessagingRoutePurpose.SCHEDULED_CHECK_INS}
              value={getSlackScheduledCheckInsTargetValue(channel)}
              targetId={channel.destinations.scheduledCheckIns.targetId}
              targetLabel={channel.destinations.scheduledCheckIns.targetLabel}
              isDm={channel.destinations.scheduledCheckIns.isDm}
              canSendAsDm={channel.canSendAsDm}
              onUpdate={onUpdate}
              disabled={saveStatus === "executing"}
            />
          )}
          <Toggle
            name={`scheduled-checkins-${channel.id}`}
            enabled={enabled}
            disabled={toggleStatus === "executing" || isLoading}
            onChange={handleToggle}
          />
        </ItemActions>
      </Item>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>定时签到</DialogTitle>
            <DialogDescription>
              配置 Inbox Zero 何时向{" "}
              {getMessagingProviderName(channel.provider)} 发送定时摘要。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-3">
              <Label>计划</Label>
              <div className="grid grid-cols-3 gap-2">
                {AUTOMATION_CRON_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full",
                      selectedPreset?.id === preset.id &&
                        "border-primary ring-1 ring-primary",
                    )}
                    onClick={() => {
                      setCronExpression(preset.cronExpression);
                      setShowCronEditor(false);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{scheduleText}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowCronEditor((value) => !value)}
                >
                  {showCronEditor ? "完成" : "编辑"}
                </Button>
              </div>
              {showCronEditor && (
                <>
                  <Input
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
                    placeholder="UTC 时间的 Cron 表达式"
                  />
                  <p className="text-xs text-muted-foreground">
                    这是一个 cron 表达式（UTC）。可以让 ChatGPT 或 Claude
                    按你偏好的计划生成一个。
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomPrompt((value) => !value)}
              >
                + 添加签到说明
              </Button>
              {showCustomPrompt && (
                <Textarea
                  id={`scheduled-checkins-prompt-${channel.id}`}
                  placeholder="示例：只包含今天需要回复或在未来 2 天内有截止日期的邮件。跳过新闻邮件、收据和仅供参考的更新。"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              {activeForChannel && job ? (
                <Button
                  variant="ghost"
                  disabled={testCheckInStatus === "executing"}
                  onClick={() => executeTestCheckIn({})}
                >
                  {testCheckInStatus === "executing"
                    ? "发送中…"
                    : "发送测试签到"}
                </Button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={saveStatus === "executing"}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveStatus === "executing"}
                >
                  {saveStatus === "executing" ? "保存中…" : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getSlackScheduledCheckInsTargetValue(channel: Channel) {
  const destination = channel.destinations.scheduledCheckIns;
  if (destination.isDm) return "dm";
  if (destination.targetId) return destination.targetId;
  if (channel.canSendAsDm) return "dm";
  return null;
}
