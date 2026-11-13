"use client";

import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { captureException } from "@/utils/error";
import type { GetCalendarAuthUrlResponse } from "@/app/api/google/calendar/auth-url/route";
import { fetchWithAccount } from "@/utils/fetch";
import { CALENDAR_ONBOARDING_RETURN_COOKIE } from "@/utils/calendar/constants";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import type { AppPage } from "@/utils/analytics/product";
import { redirectToSafeUrl } from "@/utils/redirect";

export function ConnectCalendar({
  analyticsPage,
  onboardingReturnPath,
}: {
  analyticsPage?: AppPage;
  onboardingReturnPath?: string;
}) {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics(analyticsPage);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false);

  const setOnboardingReturnCookie = () => {
    if (onboardingReturnPath) {
      document.cookie = `${CALENDAR_ONBOARDING_RETURN_COOKIE}=${encodeURIComponent(onboardingReturnPath)}; path=/; max-age=180; SameSite=Lax; Secure`;
    }
  };

  const handleConnectGoogle = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "google",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingGoogle(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/google/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("启动 Google 日历连接失败");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "google",
      });
      captureException(error, {
        extra: { context: "Google Calendar OAuth initiation" },
      });
      toastError({
        title: t`启动 Google 日历连接时出错`,
        description: t`请重试或联系支持团队`,
      });
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "microsoft",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingMicrosoft(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/outlook/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("启动 Microsoft 日历连接失败");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "microsoft",
      });
      captureException(error, {
        extra: { context: "Microsoft Calendar OAuth initiation" },
      });
      toastError({
        title: t`启动 Microsoft 日历连接时出错`,
        description: t`请重试或联系支持团队`,
      });
      setIsConnectingMicrosoft(false);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap md:flex-nowrap">
      <Button
        onClick={handleConnectGoogle}
        disabled={isConnectingGoogle || isConnectingMicrosoft}
        variant="outline"
        className="flex items-center gap-2 w-full md:w-auto"
      >
        <Image
          src="/images/google.svg"
          alt="Google"
          width={16}
          height={16}
          unoptimized
        />
        {isConnectingGoogle ? t`正在连接……` : t`添加 Google 日历`}
      </Button>

      <Button
        onClick={handleConnectMicrosoft}
        disabled={isConnectingGoogle || isConnectingMicrosoft}
        variant="outline"
        className="flex items-center gap-2 w-full md:w-auto"
      >
        <Image
          src="/images/microsoft.svg"
          alt="Microsoft"
          width={16}
          height={16}
          unoptimized
        />
        {isConnectingMicrosoft ? t`正在连接……` : t`添加 Outlook 日历`}
      </Button>
    </div>
  );
}
