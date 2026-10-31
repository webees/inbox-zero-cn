"use client";

import { Toggle } from "@/components/Toggle";
import { SettingCard } from "@/components/SettingCard";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useSentWithSignatureToggle } from "@/hooks/useSentWithSignatureToggle";
import { env } from "@/env";
import { BRAND_NAME } from "@/utils/branding";

export function SentWithSignatureSetting() {
  const { enabled, isLoading, error, isExecuting, toggle } =
    useSentWithSignatureToggle();

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
            enabled={enabled ?? false}
            onChange={toggle}
            disabled={isLoading || isExecuting}
          />
        </LoadingContent>
      }
    />
  );
}
