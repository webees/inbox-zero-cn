"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeading, TypographyP } from "@/components/Typography";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import { BRAND_NAME } from "@/utils/branding";
import { redirectToSafeUrl } from "@/utils/redirect";

export function PermissionsConsent() {
  const { t } = useLingui();
  const { emailAccountId, provider, isLoading: accountLoading } = useAccount();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isMicrosoft = provider === "microsoft";

  const handleReconnect = async () => {
    setIsReconnecting(true);

    try {
      const accountProvider = provider === "microsoft" ? "microsoft" : "google";
      const url = await getAccountLinkingUrl(accountProvider, {
        reconnectEmailAccountId: emailAccountId,
      });
      redirectToSafeUrl(url, { allowExternal: true });
    } catch (error) {
      toastError({
        title: t`Error initiating reconnection`,
        description:
          error instanceof Error
            ? error.message
            : t`Please try again or contact support`,
      });
    } finally {
      setIsReconnecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center">
      <PageHeading className="text-center">
        <Trans>缺少权限 😔</Trans>
      </PageHeading>

      <TypographyP className="mx-auto mt-4 max-w-prose text-center">
        {isMicrosoft
          ? t`你的 Microsoft 账号已连接，但 ${BRAND_NAME} 缺少一项或多项所需的 Microsoft 365 权限。`
          : t`你必须登录并授予所有权限，${BRAND_NAME} 才能正常运行。`}
      </TypographyP>

      {isMicrosoft && (
        <TypographyP className="mx-auto mt-3 max-w-prose text-center text-muted-foreground">
          <Trans>
            如果你的组织限制用户授权，请让 Microsoft 365 管理员批准 {BRAND_NAME}
            ， 然后重新连接你的账号。
          </Trans>
        </TypographyP>
      )}
      {provider === "google" && (
        <TypographyP className="mx-auto mt-3 max-w-prose text-center text-muted-foreground">
          <Trans>
            重新连接你的账号，并在 Google 权限页面上勾选所有复选框，包括 Gmail
            访问权限。
          </Trans>
        </TypographyP>
      )}

      <Button
        className="mt-4"
        onClick={handleReconnect}
        loading={isReconnecting}
        disabled={isReconnecting || accountLoading || !provider}
      >
        <Trans>重新连接账号</Trans>
      </Button>

      <p className="mt-8 text-center text-muted-foreground">
        <Trans>
          遇到问题？{" "}
          <Link href="/logout" className="underline hover:text-primary">
            退出登录
          </Link>{" "}
          然后重新登录。
        </Trans>
      </p>

      <div className="mt-8">
        <Image
          src="/images/illustrations/falling.svg"
          alt=""
          width={400}
          height={400}
          unoptimized
          className="dark:brightness-90 dark:invert"
        />
      </div>
    </div>
  );
}
