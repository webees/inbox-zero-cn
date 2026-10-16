"use client";

import { useReducer, useRef, useState } from "react";
import { PauseIcon, PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionDescription } from "@/components/Typography";
import { LoadingContent } from "@/components/LoadingContent";
import { pauseAiQueue, resumeAiQueue } from "@/utils/queue/ai-queue";
import { toastError } from "@/components/Toast";
import { PremiumAlertWithData } from "@/components/PremiumAlert";
import { usePremium } from "@/hooks/usePremium";
import { SetDateDropdown } from "@/app/(app)/[emailAccountId]/assistant/SetDateDropdown";
import { useBeforeUnload } from "@/hooks/useBeforeUnload";
import { useAiQueueState } from "@/store/ai-queue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAccount } from "@/providers/EmailAccountProvider";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemCard,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { hasTierAccess } from "@/utils/premium";
import { RERUN_MINIMUM_TIER } from "@/utils/premium/rerun";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { BulkProcessActivityLog } from "@/app/(app)/[emailAccountId]/assistant/BulkProcessActivityLog";
import {
  bulkRunReducer,
  getProgressMessage,
  initialBulkRunState,
} from "@/app/(app)/[emailAccountId]/assistant/bulk-run-rules-reducer";
import { EndTrialButton } from "@/components/EndTrialButton";
import { onRun } from "@/app/(app)/[emailAccountId]/assistant/bulk-run";
import { useAiAutomationStatus } from "@/hooks/useAiAutomationStatus";

const TRIAL_BULK_PROCESS_EMAIL_LIMIT = 200;

export function BulkRunRules() {
  const { emailAccountId } = useAccount();

  const [isOpen, setIsOpen] = useState(false);
  const { PremiumModal, openModal: openPremiumModal } = usePremiumModal();
  const [state, dispatch] = useReducer(bulkRunReducer, initialBulkRunState);

  const queue = useAiQueueState();

  const {
    hasAiAccess,
    isLoading: isLoadingPremium,
    premium,
    tier,
  } = usePremium();
  const { data: aiAutomationStatus } = useAiAutomationStatus();

  const isBusinessPlusTier = hasTierAccess({
    tier: tier || null,
    minimumTier: "PROFESSIONAL_MONTHLY",
  });
  const hasRerunAccess = hasTierAccess({
    tier: tier || null,
    minimumTier: RERUN_MINIMUM_TIER,
  });
  const isTrial = premium?.stripeSubscriptionStatus === "trialing";
  const trialAiLimitMessage =
    aiAutomationStatus?.status === "trial_ai_limit_reached"
      ? aiAutomationStatus.message
      : null;

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [includeRead, setIncludeRead] = useState(false);
  const [rerun, setRerun] = useState(false);
  const [generateDraftReplies, setGenerateDraftReplies] = useState(false);

  const abortRef = useRef<() => void>(undefined);

  // 派生状态
  const remaining = new Set(
    [...state.processedThreadIds].filter((id) => queue.has(id)),
  ).size;
  const completed = state.processedThreadIds.size - remaining;
  const isProcessing = queue.size > 0;
  const isPaused = state.status === "paused";
  const isBusy = isProcessing || state.status === "processing";
  // 开关仍处于开启状态时权限可能被收回（套餐会在后台重新校验），
  // 因此所有逻辑都读取受权限约束后的值，而不是原始的开关状态。
  const isIncludeReadEnabled = includeRead && isBusinessPlusTier;
  const isRerunEnabled = rerun && hasRerunAccess;

  // 处理期间（含初始拉取）离开页面前警告用户
  useBeforeUnload(isBusy);

  const handleStart = async () => {
    dispatch({ type: "START" });

    if (!startDate) {
      toastError({ description: "请选择开始日期" });
      dispatch({ type: "RESET" });
      return;
    }
    if (!emailAccountId) {
      toastError({
        description: "缺少邮箱账号 ID，请刷新页面。",
      });
      dispatch({ type: "RESET" });
      return;
    }

    // 确保队列未因上一次运行而暂停
    resumeAiQueue();

    try {
      abortRef.current = await onRun(
        emailAccountId,
        {
          startDate,
          endDate,
          includeRead: isIncludeReadEnabled,
          generateDraftReplies,
          rerun: isRerunEnabled,
          maxEmails: isTrial ? TRIAL_BULK_PROCESS_EMAIL_LIMIT : undefined,
        },
        (threads) => {
          dispatch({ type: "THREADS_QUEUED", threads });
        },
        (completionStatus, count) => {
          if (completionStatus !== "success") {
            dispatch({ type: "STOP", completedCount: count });
            return;
          }

          dispatch({ type: "COMPLETE", count });
        },
      );
    } catch (error) {
      console.error("启动批量处理失败：", error);
      toastError({
        title: "启动失败",
        description: "发生错误，请重试。",
      });
      dispatch({ type: "RESET" });
    }
  };

  const handlePauseResume = () => {
    if (isPaused) {
      resumeAiQueue();
      dispatch({ type: "RESUME" });
    } else {
      pauseAiQueue();
      dispatch({ type: "PAUSE" });
    }
  };

  const handleStop = () => {
    dispatch({ type: "STOP", completedCount: completed });
    abortRef.current?.();
  };

  const progressMessage = getProgressMessage(state, remaining);

  return (
    <div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            处理历史邮件
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量处理邮件</DialogTitle>
            <DialogDescription>
              对收件箱中已有的邮件运行你的规则。
            </DialogDescription>
          </DialogHeader>
          {progressMessage && (
            <div className="rounded-md border border-green-200 bg-green-50 px-2 py-1.5 dark:border-green-800 dark:bg-green-950">
              <SectionDescription className="mt-0">
                {progressMessage}
              </SectionDescription>
            </div>
          )}
          <LoadingContent loading={isLoadingPremium}>
            <div className="flex min-w-0 flex-col space-y-4 overflow-hidden">
              <PremiumAlertWithData className="mr-auto" />

              <div className="grid grid-cols-2 gap-2">
                <SetDateDropdown
                  onChange={(date) => {
                    setStartDate(date);
                    dispatch({ type: "RESET" });
                  }}
                  value={startDate}
                  placeholder="设置开始日期"
                  disabled={isProcessing}
                />
                <SetDateDropdown
                  onChange={(date) => {
                    setEndDate(date);
                    dispatch({ type: "RESET" });
                  }}
                  value={endDate}
                  placeholder="设置结束日期（可选）"
                  disabled={isProcessing}
                />
              </div>

              <ItemCard>
                <ToggleRow
                  title="包含已读邮件"
                  checked={isIncludeReadEnabled}
                  onCheckedChange={setIncludeRead}
                  disabled={isProcessing}
                  onUpgrade={isBusinessPlusTier ? undefined : openPremiumModal}
                />
                <ItemSeparator />
                <ToggleRow
                  title="对已处理的邮件重新运行规则"
                  checked={isRerunEnabled}
                  onCheckedChange={setRerun}
                  disabled={isProcessing}
                  onUpgrade={hasRerunAccess ? undefined : openPremiumModal}
                />
                <ItemSeparator />
                <ToggleRow
                  title="生成草稿回复"
                  checked={generateDraftReplies}
                  onCheckedChange={setGenerateDraftReplies}
                  disabled={isBusy}
                />
              </ItemCard>

              {isTrial && (
                <div className="flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {trialAiLimitMessage ??
                      `试用版一次最多可处理 ${TRIAL_BULK_PROCESS_EMAIL_LIMIT} 封历史邮件。`}
                  </span>
                  <EndTrialButton
                    size="sm"
                    variant="outline"
                    className="self-start border-blue-300 bg-white text-blue-900 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100 dark:hover:bg-blue-900 sm:self-auto"
                  />
                </div>
              )}

              {(state.status !== "idle" ||
                state.processedThreadIds.size > 0) && (
                <BulkProcessActivityLog
                  threads={Array.from(state.fetchedThreads.values())}
                  processedThreadIds={state.processedThreadIds}
                  aiQueue={queue}
                  paused={isPaused}
                  loading={
                    state.status === "processing" &&
                    state.processedThreadIds.size === 0
                  }
                />
              )}

              {(state.status === "idle" || state.status === "stopped") &&
                !isProcessing && (
                  <Button
                    type="button"
                    disabled={
                      !startDate ||
                      !emailAccountId ||
                      !hasAiAccess ||
                      trialAiLimitMessage !== null
                    }
                    onClick={handleStart}
                  >
                    处理邮件
                  </Button>
                )}
              {isBusy && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={handlePauseResume}>
                    {isPaused ? (
                      <>
                        <PlayIcon className="mr-1.5 h-3.5 w-3.5" />
                        继续
                      </>
                    ) : (
                      <>
                        <PauseIcon className="mr-1.5 h-3.5 w-3.5" />
                        暂停
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleStop}>
                    <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                    停止
                  </Button>
                </div>
              )}

              {state.runResult && state.runResult.count === 0 && (
                <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  在所选日期范围内，你的收件箱中没有找到
                  {describeTargetedEmails({
                    includeRead: isIncludeReadEnabled,
                    rerun: isRerunEnabled,
                  })}
                  。
                </div>
              )}
            </div>
          </LoadingContent>
          <PremiumModal />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  title,
  checked,
  onCheckedChange,
  disabled,
  onUpgrade,
}: {
  title: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {onUpgrade && <ItemDescription>专业版套餐可用。</ItemDescription>}
      </ItemContent>
      <ItemActions>
        {onUpgrade ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`升级以使用${title}`}
            onClick={onUpgrade}
          >
            升级
          </Button>
        ) : (
          <Switch
            aria-label={title}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
          />
        )}
      </ItemActions>
    </Item>
  );
}

function describeTargetedEmails({
  includeRead,
  rerun,
}: {
  includeRead: boolean;
  rerun: boolean;
}) {
  const qualifiers = [
    includeRead ? null : "未读",
    rerun ? null : "未处理",
  ].filter(Boolean);

  return qualifiers.length ? `${qualifiers.join("、")}邮件` : "邮件";
}
