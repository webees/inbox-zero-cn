"use client";

import { useCallback, use } from "react";
import { useAction } from "next-safe-action/hooks";
import { type SubmitHandler, useForm } from "react-hook-form";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { activateLicenseKeyAction } from "@/utils/actions/premium";
import { AlertBasic } from "@/components/Alert";
import { usePremium } from "@/hooks/usePremium";
import { toastError, toastSuccess } from "@/components/Toast";
import type { ActivateLicenseKeyOptions } from "@/utils/actions/premium.validation";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";

export default function LicensePage(props: {
  searchParams: Promise<{ "license-key"?: string }>;
}) {
  const searchParams = use(props.searchParams);
  const licenseKey = searchParams["license-key"];

  const { premium } = usePremium();

  return (
    <PageWrapper>
      <PageHeader title="激活你的许可证" />

      <div className="max-w-2xl py-4">
        {premium?.lemonLicenseKey && (
          <AlertBasic
            variant="success"
            title="你的许可证已激活"
            description="你有一个有效的许可证密钥。要为你的账号添加用户，请访问设置页面。"
            className="mb-4"
          />
        )}

        <ActivateLicenseForm licenseKey={licenseKey} />
      </div>
    </PageWrapper>
  );
}

function ActivateLicenseForm(props: { licenseKey?: string }) {
  const { execute: activateLicenseKey, isExecuting } = useAction(
    activateLicenseKeyAction,
    {
      onSuccess: () => {
        toastSuccess({ description: "许可证已激活！" });
      },
      onError: () => {
        toastError({ description: "激活许可证时出错！" });
      },
    },
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivateLicenseKeyOptions>({
    defaultValues: { licenseKey: props.licenseKey },
  });

  const onSubmit: SubmitHandler<ActivateLicenseKeyOptions> = useCallback(
    (data) => {
      activateLicenseKey({ licenseKey: data.licenseKey });
    },
    [activateLicenseKey],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        type="text"
        name="licenseKey"
        label="许可证密钥"
        registerProps={register("licenseKey", { required: true })}
        error={errors.licenseKey}
      />
      <Button type="submit" loading={isExecuting}>
        激活
      </Button>
    </form>
  );
}
