"use client";

import { LockIcon, MessageSquareIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastError, toastSuccess } from "@/components/Toast";
import { env } from "@/env";
import { useChannelTargets } from "@/hooks/useMessagingChannels";
import type { MessagingRoutePurpose } from "@/generated/prisma/enums";
import { updateSlackRouteAction } from "@/utils/actions/messaging-channels";
import { getActionErrorMessage } from "@/utils/error";

export function SlackNotificationTargetSelect({
  emailAccountId,
  messagingChannelId,
  purpose,
  value,
  targetId,
  targetLabel,
  isDm,
  canSendAsDm,
  onUpdate,
  onValueChange,
  placeholder = "选择频道",
  className = "h-8 w-[180px] [&>span]:min-w-0 [&>span]:text-left",
  disabled = false,
}: {
  emailAccountId: string;
  messagingChannelId: string;
  purpose: MessagingRoutePurpose;
  value?: string | null;
  targetId: string | null;
  targetLabel: string | null;
  isDm: boolean;
  canSendAsDm: boolean;
  onUpdate: () => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const {
    data: targetsData,
    isLoading,
    error,
    mutate: mutateTargets,
  } = useChannelTargets(messagingChannelId, emailAccountId);

  const privateTargets = targetsData?.targets ?? [];
  const hasError = Boolean(error || targetsData?.error);
  const selectedValue = value ?? (isDm ? "dm" : (targetId ?? ""));
  const selectedIsDm = selectedValue === "dm";
  const selectedTargetId =
    selectedValue && selectedValue !== "dm" ? selectedValue : targetId;
  const selectedTargetLabel = getSelectedTargetLabel({
    isDm: selectedIsDm,
    targetId: selectedTargetId,
    targetLabel,
    privateTargets,
    isLoading,
  });

  const { execute, status } = useAction(
    updateSlackRouteAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "目标已更新" });
        onUpdate();
      },
      onError: (actionError) => {
        toastError({
          description:
            getActionErrorMessage(actionError.error) ?? "更新目标失败",
        });
      },
    },
  );

  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => {
        if (onValueChange) {
          onValueChange(value);
          return;
        }

        execute({
          channelId: messagingChannelId,
          purpose,
          targetId: value === "dm" ? "dm" : value,
        });
      }}
      disabled={disabled || isLoading || status === "executing"}
    >
      <SelectTrigger className={className}>
        <SelectValue
          placeholder={
            isLoading ? "加载中..." : hasError ? "加载失败" : placeholder
          }
        >
          {selectedTargetLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {canSendAsDm && (
          <SelectItem value="dm">
            <MessageSquareIcon className="mr-1 inline h-3 w-3" />
            私信
          </SelectItem>
        )}
        {privateTargets.map((target) => (
          <SelectItem key={target.id} value={target.id}>
            <LockIcon className="mr-1 inline h-3 w-3" />
            {target.name}
          </SelectItem>
        ))}
        {!isLoading && !hasError && (
          <div className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            <div>
              {privateTargets.length === 0
                ? "未找到频道。"
                : "没看到你的频道？"}
            </div>
            <div>
              使用下方命令邀请机器人：{" "}
              <code className="rounded bg-muted px-1">
                /invite @{env.NEXT_PUBLIC_SLACK_BOT_NAME}
              </code>
            </div>
          </div>
        )}
        {hasError && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            加载频道失败。{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => mutateTargets()}
            >
              重试
            </button>
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

function getSelectedTargetLabel({
  isDm,
  targetId,
  targetLabel,
  privateTargets,
  isLoading,
}: {
  isDm: boolean;
  targetId: string | null;
  targetLabel: string | null;
  privateTargets: Array<{ id: string; name: string }>;
  isLoading: boolean;
}) {
  if (isDm) return "私信";
  if (!targetId) return targetLabel;

  const loadedTargetLabel = privateTargets.find(
    (target) => target.id === targetId,
  )?.name;
  if (loadedTargetLabel) return loadedTargetLabel;

  if (isLoading && targetLabel === `#${targetId}`) return null;

  return targetLabel;
}
