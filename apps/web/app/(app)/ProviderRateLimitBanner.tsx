"use client";

import { AppAlertBanner } from "@/app/(app)/AppAlertBanner";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { getProviderRateLimitBannerLabel } from "@/utils/email/rate-limit-mode-error";

export function ProviderRateLimitBanner() {
  const { data, isLoading, error } = useEmailAccountFull();

  if (isLoading || error || !data?.providerRateLimit) return null;

  const { provider, retryAt } = data.providerRateLimit;
  const providerLabel = getProviderRateLimitBannerLabel(provider);

  const retryAtDate = new Date(retryAt);
  const retryAtLabel = Number.isNaN(retryAtDate.getTime())
    ? retryAt
    : retryAtDate.toLocaleString();

  return (
    <AppAlertBanner
      title={`${providerLabel} 正在对此账号限流`}
      description={
        <p>
          Inbox Zero 的操作会暂时暂停，直到大约 <strong>{retryAtLabel}</strong>
          。此限制由 {providerLabel}{" "}
          强制执行，连接到该邮箱的其他应用也会占用同一共享额度。
        </p>
      }
    />
  );
}
