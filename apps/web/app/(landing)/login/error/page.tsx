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
import { ClientBasicLayout } from "@/components/layouts/ClientBasicLayout";
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
      "你的账号无权访问此应用。这可能是因为你的邮箱不属于允许的组织。请联系管理员，或尝试使用其他账号登录。",
  },
  signup_not_allowed: {
    title: "注册受限",
    description:
      "此部署仅允许特定电子邮件地址或域名注册。请联系管理员，或尝试使用其他账号登录。",
  },
  email_already_linked: {
    title: "邮箱已关联",
    description: getEmailAlreadyLinkedDescription(),
  },
  account_not_linked: {
    title: "登录方式不匹配",
    description:
      "此电子邮件已有账号，但该账号是通过不同的登录方式或其他服务商账号创建的。请使用最初注册时的登录方式登录，或联系支持人员，以便我们重新关联这两个账号。",
  },
  org_invite_invalid_code: {
    title: "组织邀请登录失败",
    description:
      "加入此组织时无法完成登录。请再次从邀请链接开始操作。如果仍然失败，请使用此邮箱的原始账号登录，然后再次接受邀请。",
  },
  invalid_code: {
    title: "登录会话已过期",
    description:
      "你的登录链接已失效。这可能是因为登录流程被打开两次、已超时或已被使用。请从登录页重新开始登录。",
  },
  requiresreconsent: {
    title: "需要刷新权限",
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

  // For some reason users are being sent to this page when logged in
  // This will redirect them out of this page to the app
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
  // will redirect to welcome if user is logged in
  if (data?.id) return <Loading />;

  const errorInfo = resolvedErrorCode ? errorMessages[resolvedErrorCode] : null;
  const title = errorInfo?.title || "Error Logging In";
  const supportText = `If this error persists, please use the support chat or email us at ${SUPPORT_EMAIL}.`;
  const fallbackDescription = resolvedErrorCode
    ? `Please try signing in again. (Error code: ${resolvedErrorCode}) ${supportText}`
    : `Please try signing in again. ${supportText}`;
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
            <Link href="/login">Log In</Link>
          </Button>
        }
      />
      {/* <AutoLogOut loggedIn={!!session?.user.email} /> */}
    </LoadingContent>
  );
}

export default function LogInErrorPage() {
  return (
    <ClientBasicLayout>
      <Suspense fallback={<Loading />}>
        <LoginErrorContent />
      </Suspense>

      <Suspense>
        <CrispChatLoggedOutVisible />
      </Suspense>
    </ClientBasicLayout>
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
