"use client";

import { useCallback } from "react";
import { Toggle } from "@/components/Toggle";
import { enableMultiRuleSelectionAction } from "@/utils/actions/rule";
import { createSettingActionErrorHandler } from "@/utils/actions/error-handling";
import { SettingCard } from "@/components/SettingCard";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useAction } from "next-safe-action/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingContent } from "@/components/LoadingContent";
import { TooltipExplanation } from "@/components/TooltipExplanation";

export function MultiRuleSetting() {
  const { data, isLoading, error, mutate } = useEmailAccountFull();

  const { execute } = useAction(
    enableMultiRuleSelectionAction.bind(null, data?.id ?? ""),
    {
      onSuccess: () => {
        mutate();
      },
      onError: createSettingActionErrorHandler({
        mutate,
        prefix: "发生错误",
      }),
    },
  );

  const enabled = data?.multiRuleSelectionEnabled ?? false;

  const handleToggle = useCallback(
    (enable: boolean) => {
      if (!data) return;

      const optimisticData = {
        ...data,
        multiRuleSelectionEnabled: enable,
      };
      mutate(optimisticData, false);

      execute({ enable });
    },
    [data, mutate, execute],
  );

  return (
    <SettingCard
      title={
        <div className="flex items-center gap-1.5">
          <span>多规则选择</span>
          <TooltipExplanation
            side="top"
            text="关闭此项会阻止 AI 有意为一封邮件选择多条自定义规则。在少数特殊情况下，Inbox Zero 仍可能应用多条规则。"
          />
        </div>
      }
      description="允许 AI 在合适时为单封邮件选择多条规则。"
      right={
        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-8 w-32" />}
        >
          <Toggle
            name="multi-rule-selection"
            enabled={enabled}
            onChange={handleToggle}
            disabled={isLoading}
          />
        </LoadingContent>
      }
    />
  );
}
