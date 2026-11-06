"use client";

import { useCallback } from "react";
import { useAction } from "next-safe-action/hooks";
import { Toggle } from "@/components/Toggle";
import { SettingCard } from "@/components/SettingCard";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useAccount } from "@/providers/EmailAccountProvider";
import { createSettingActionErrorHandler } from "@/utils/actions/error-handling";
import { updateHiddenAiDraftLinksAction } from "@/utils/actions/email-account";

export function HiddenAiDraftLinksSetting() {
  const { data, isLoading, error, mutate } = useEmailAccountFull();
  const { emailAccountId } = useAccount();

  const { execute } = useAction(
    updateHiddenAiDraftLinksAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
      },
      onError: createSettingActionErrorHandler({
        mutate,
        prefix: "更新隐藏 AI 草稿链接设置失败",
      }),
    },
  );

  const enabled = data?.allowHiddenAiDraftLinks ?? false;

  const handleToggle = useCallback(
    (nextEnabled: boolean) => {
      if (!data) return;

      mutate(
        {
          ...data,
          allowHiddenAiDraftLinks: nextEnabled,
        },
        false,
      );

      execute({ enabled: nextEnabled });
    },
    [data, execute, mutate],
  );

  return (
    <SettingCard
      title="允许 AI 草稿中的隐藏链接"
      description="允许 AI 生成的草稿使用“点击此处”之类的自定义锚文本。这更方便，但会隐藏完整目标地址以及链接中的任何数据。"
      right={
        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-8 w-32" />}
        >
          <Toggle
            name="hidden-ai-draft-links"
            enabled={enabled}
            onChange={handleToggle}
            disabled={isLoading}
          />
        </LoadingContent>
      }
    />
  );
}
