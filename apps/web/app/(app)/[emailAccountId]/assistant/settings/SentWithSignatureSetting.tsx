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
import { updateSentWithSignatureAction } from "@/utils/actions/email-account";
import { env } from "@/env";
import { BRAND_NAME } from "@/utils/branding";

export function SentWithSignatureSetting() {
  const { data, isLoading, error, mutate } = useEmailAccountFull();
  const { emailAccountId } = useAccount();

  const { execute, isExecuting } = useAction(
    updateSentWithSignatureAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
      },
      onError: createSettingActionErrorHandler({
        mutate,
        prefix: `更新“使用 ${BRAND_NAME} 发送”设置失败`,
      }),
    },
  );

  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (!data) return;

      mutate({ ...data, includeSentWithSignature: enabled }, false);

      execute({ enabled });
    },
    [data, execute, mutate],
  );

  if (env.NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE) {
    return null;
  }

  return (
    <SettingCard
      title={`包含“使用 ${BRAND_NAME} 发送”`}
      description={`在你从邮件客户端发送的邮件中，在签名后添加带有你推荐链接的“使用 ${BRAND_NAME} 发送”。每有一位通过你的链接注册，你就能获得一个月的额度。`}
      right={
        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-8 w-32" />}
        >
          <Toggle
            name="sent-with-signature"
            enabled={data?.includeSentWithSignature ?? false}
            onChange={handleToggle}
            disabled={isLoading || isExecuting}
          />
        </LoadingContent>
      }
    />
  );
}
