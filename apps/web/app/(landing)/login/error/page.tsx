"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";
import {
  getEmailAlreadyLinkedDescription,
  getRequiresReconsentDescription,
} from "@/app/(landing)/login/messages";
import { Button } from "@/components/ui/button";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { ErrorPage } from "@/components/ErrorPage";
import { useUser } from "@/hooks/useUser";
import { LoadingContent } from "@/components/LoadingContent";
import { Loading } from "@/components/Loading";
import { WELCOME_PATH } from "@/utils/config";
import { CrispChatLoggedOutVisible } from "@/components/CrispChat";
import { getAndClearAuthErrorCookie } from "@/utils/auth-cookies";
import { SUPPORT_EMAIL } from "@/utils/branding";
import {
  getPendingAuthProvider,
  trackAuthFailure,
} from "@/utils/analytics/auth-funnel";

const errorMessages: Record<string, { title: string; description: string }> = {
  email_not_found: {
    title: "账号未获授权",
    description:
      "你的账号没有访问此应用的权限。这可能是因为你的邮箱不属于允许的组织。请联系管理员，或尝试使用其他账号登录。",
  },
  signup_not_allowed: {
    title: "注册受限",
    description:
      "此部署仅允许来自特定邮箱地址或域名的注册。请联系管理员，或尝试使用其他账号登录。",
  },
  email_already_linked: {
    title: "邮箱已关联",
    description: getEmailAlreadyLinkedDescription(),
  },
  account_not_linked: {
    title: "登录方式不匹配",
    description:
      "此邮箱已存在账号，但它是使用其他登录方式或不同的服务商账号创建的。请使用你最初注册的方式登录，或联系支持，以便我们重新关联这两者。",
  },
  org_invite_invalid_code: {
    title: "组织邀请登录失败",
    description:
      "在加入此组织时无法完成登录。请从邀请链接重新开始。如果仍然失败，请使用此邮箱的原始账号登录，然后再次接受邀请。",
  },
  invalid_code: {
    title: "登录会话已过期",
    description:
      "你的登录链接已失效。这可能是因为登录流程被打开两次、超时或已被使用。请从登录页面重新开始登录。",
  },
  requiresreconsent: {
    title: "需要重新授权权限",
    description: getRequiresReconsentDescription(),
  },
};

function LoginErrorContent() {
  const posthog = usePostHog();
  const hasTrackedAuthFailure = useRef(false);
  const { data, isLoading, error } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error")?.toLowerCase();
  const reason = searchParams.get("reason")?.toLowerCase();
  const resolvedErrorCode = resolveErrorCode({ errorCode, reason });

  useEffect(() => {
    if (isLoading || data?.id || hasTrackedAuthFailure.current) return;

    hasTrackedAuthFailure.current = true;
    trackAuthFailure(posthog, {
      provider: getPendingAuthProvider(),
      stage: "callback",
      errorCode: resolvedErrorCode,
    });
  }, [data?.id, isLoading, posthog, resolvedErrorCode]);

  // 已登录用户有时会被带到此页面
  // 这会将他们从此页面重定向到应用
  useEffect(() => {
    if (data?.id) {
      const authErrorCookie = getAndClearAuthErrorCookie();

      if (authErrorCookie) {
        router.push("/accounts");
      } else {
        router.push(WELCOME_PATH);
      }
    }
  }, [data, router]);

  if (isLoading) return <Loading />;
  // 用户已登录时会重定向到欢迎页
  if (data?.id) return <Loading />;

  const errorInfo = resolvedErrorCode ? errorMessages[resolvedErrorCode] : null;
  const title = errorInfo?.title || "登录出错";
  const supportText = `如果此错误持续存在，请使用支持聊天，或通过 ${SUPPORT_EMAIL} 给我们发邮件。`;
  const fallbackDescription = resolvedErrorCode
    ? `请再次尝试登录。（错误代码：${resolvedErrorCode}）${supportText}`
    : `请再次尝试登录。${supportText}`;
  const description = errorInfo?.description
    ? `${errorInfo.description} ${supportText}`
    : fallbackDescription;

  return (
    <LoadingContent loading={isLoading} error={error}>
      <ErrorPage
        title={title}
        description={description}
        button={
          <Button asChild>
            <Link href="/login">登录</Link>
          </Button>
        }
      />
      {/* <AutoLogOut loggedIn={!!session?.user.email} /> */}
    </LoadingContent>
  );
}

export default function LogInErrorPage() {
  return (
    <BasicLayout>
      <Suspense fallback={<Loading />}>
        <LoginErrorContent />
      </Suspense>

      <Suspense>
        <CrispChatLoggedOutVisible />
      </Suspense>
    </BasicLayout>
  );
}

function resolveErrorCode({
  errorCode,
  reason,
}: {
  errorCode?: string;
  reason?: string;
}) {
  if (reason === "org_invite" && errorCode === "invalid_code") {
    return "org_invite_invalid_code";
  }

  return errorCode;
}
