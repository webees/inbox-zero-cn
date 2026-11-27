"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toastError } from "@/components/Toast";
import Image from "next/image";
import { MutedText } from "@/components/Typography";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { redirectToSafeUrl } from "@/utils/redirect";

export function AddAccount({ helperText }: { helperText: ReactNode }) {
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingMicrosoft, setIsLoadingMicrosoft] = useState(false);
  const { t } = useLingui();

  const handleAddAccount = async (provider: "google" | "microsoft") => {
    const setLoading = isGoogleProvider(provider)
      ? setIsLoadingGoogle
      : setIsLoadingMicrosoft;
    setLoading(true);

    try {
      const url = await getAccountLinkingUrl(provider);
      redirectToSafeUrl(url, { allowExternal: true });
    } catch (error) {
      console.error(`发起 ${provider} 关联时出错：`, error);
      toastError({
        title: isGoogleProvider(provider)
          ? t`发起 Google 关联时出错`
          : t`发起 Microsoft 关联时出错`,
        description:
          error instanceof Error ? error.message : t`请重试或联系支持团队`,
      });
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[90px]">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleAddAccount("google")}
          loading={isLoadingGoogle}
          disabled={isLoadingGoogle || isLoadingMicrosoft}
        >
          <Image
            src="/images/google.svg"
            alt=""
            width={24}
            height={24}
            unoptimized
          />
          <span className="ml-2">
            <Trans>添加 Google</Trans>
          </span>
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleAddAccount("microsoft")}
          loading={isLoadingMicrosoft}
          disabled={isLoadingGoogle || isLoadingMicrosoft}
        >
          <Image
            src="/images/microsoft.svg"
            alt=""
            width={24}
            height={24}
            unoptimized
          />
          <span className="ml-2">
            <Trans>添加 Microsoft</Trans>
          </span>
        </Button>
      </div>

      <MutedText>{helperText}</MutedText>
    </div>
  );
}
