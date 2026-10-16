"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Suspense, useCallback, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeInternalPath } from "@/utils/path";
import type {
  GetSsoSignInParams,
  GetSsoSignInResponse,
} from "@/app/api/sso/signin/route";
import {
  trackAuthFailure,
  trackAuthStarted,
} from "@/utils/analytics/auth-funnel";

const ssoLoginSchema = z.object({
  email: z.string().email("请输入有效的邮箱地址"),
  organizationSlug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "请输入有效的组织标识")
    .max(63, "组织标识不能超过 63 个字符"),
});

type SsoLoginBody = z.infer<typeof ssoLoginSchema>;

export default function SSOLoginPage() {
  return (
    <Suspense>
      <SSOLoginForm />
    </Suspense>
  );
}

function SSOLoginForm() {
  const posthog = usePostHog();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath =
    normalizeInternalPath(searchParams?.get("next")) ?? "/accounts";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SsoLoginBody>({
    resolver: zodResolver(ssoLoginSchema),
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit: SubmitHandler<SsoLoginBody> = useCallback(
    async (data) => {
      setIsSubmitting(true);
      trackAuthStarted(posthog, "sso");
      try {
        const params: GetSsoSignInParams = {
          email: data.email,
          organizationSlug: data.organizationSlug,
        };

        const paramsString = new URLSearchParams({
          ...params,
          next: nextPath,
        }).toString();
        const url = new URL(
          `/api/sso/signin?${paramsString}`,
          window.location.origin,
        );

        const response = await fetch(url.toString());
        const responseData = await response.json();

        if (!response.ok) {
          trackAuthFailure(posthog, {
            provider: "sso",
            stage: "start",
            errorCode: "sso_start_rejected",
          });
          toastError({
            title: "SSO 登录出错",
            description: responseData.error || "无法发起 SSO 登录",
          });
          return;
        }

        const res: GetSsoSignInResponse = responseData;

        if (res.redirectUrl) {
          toastSuccess({ description: "正在重定向到 SSO 服务商..." });
          router.push(res.redirectUrl);
        }
      } catch {
        trackAuthFailure(posthog, {
          provider: "sso",
          stage: "start",
          errorCode: "network_error",
        });
        toastError({
          title: "SSO 登录出错",
          description: "发生了意外错误。请重试。",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [posthog, router, nextPath],
  );

  return (
    <div className="flex h-screen flex-col justify-center text-foreground">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col text-center">
          <h1 className="font-title text-2xl text-foreground">SSO 登录</h1>
          <p className="mt-4 text-muted-foreground">登录你的组织账号</p>
        </div>

        <div className="mt-4">
          <div className="space-y-4">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <Input
                type="email"
                name="email"
                label="邮箱"
                registerProps={register("email")}
                error={errors.email}
              />

              <Input
                type="text"
                name="organizationSlug"
                label="组织标识"
                placeholder="your-org-slug"
                registerProps={register("organizationSlug")}
                error={errors.organizationSlug}
              />

              <Button type="submit" size="lg" full loading={isSubmitting}>
                使用 SSO 继续
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
