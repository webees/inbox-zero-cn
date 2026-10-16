import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/app/(landing)/login/LoginForm";
import {
  getEmailAlreadyLinkedDescription,
  getRequiresReconsentDescription,
} from "@/app/(landing)/login/messages";
import { env } from "@/env";
import { auth } from "@/utils/auth";
import { isGoogleOauthEmulationEnabled } from "@/utils/gmail/oauth";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";
import { AlertBasic } from "@/components/Alert";
import { Button } from "@/components/ui/button";
import { WELCOME_PATH } from "@/utils/config";
import { CrispChatLoggedOutVisible } from "@/components/CrispChat";
import { MutedText } from "@/components/Typography";
import { normalizeInternalPath } from "@/utils/path";
import {
  BRAND_NAME,
  SUPPORT_EMAIL,
  getBrandTitle,
  getPossessiveBrandName,
} from "@/utils/branding";

export const metadata: Metadata = {
  title: getBrandTitle("登录"),
  description: `登录 ${BRAND_NAME}。`,
  alternates: { canonical: "/login" },
};

export default async function AuthenticationPage(props: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const nextPath = normalizeInternalPath(searchParams?.next);
  const isSelfHosted = env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS;

  if (session?.user && !searchParams?.error) {
    redirect(nextPath ?? WELCOME_PATH);
  }

  const enabledProviders = Array.from(getEnabledLoginProviders());

  return (
    <div className="flex min-h-screen flex-col justify-center py-10 text-foreground">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col text-center">
          <h1 className="font-title text-2xl text-foreground">登录</h1>
          <p className="mt-4 text-muted-foreground">你的邮件 AI 个人助手。</p>
        </div>
        <div className="mt-4">
          <Suspense>
            <LoginForm
              enabledProviders={enabledProviders}
              useGoogleOauthEmulator={isGoogleOauthEmulationEnabled()}
            />
          </Suspense>
        </div>

        {searchParams?.error && <ErrorAlert error={searchParams?.error} />}

        {!isSelfHosted ? (
          <MutedText className="px-8 pt-10 text-center">
            点击继续即表示你同意我们的{" "}
            <Link
              href="/terms"
              className="underline underline-offset-4 hover:text-foreground"
            >
              服务条款
            </Link>{" "}
            和{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4 hover:text-foreground"
            >
              隐私政策
            </Link>
            .
          </MutedText>
        ) : null}

        <LoginFooter
          isSelfHosted={isSelfHosted}
          selfHostedLoginFooterText={
            env.NEXT_PUBLIC_SELF_HOSTED_LOGIN_FOOTER_TEXT || undefined
          }
        />
      </div>
    </div>
  );
}

function LoginFooter({
  isSelfHosted,
  selfHostedLoginFooterText,
}: {
  isSelfHosted?: boolean;
  selfHostedLoginFooterText?: string;
}) {
  if (isSelfHosted && selfHostedLoginFooterText !== undefined) {
    const trimmedFooterText = selfHostedLoginFooterText.trim();
    if (!trimmedFooterText || trimmedFooterText.toLowerCase() === "none") {
      return null;
    }

    return (
      <MutedText className="whitespace-pre-line px-4 pt-10 text-center">
        {selfHostedLoginFooterText}
      </MutedText>
    );
  }

  return (
    <MutedText
      className={
        isSelfHosted ? "px-4 pt-10 text-center" : "px-4 pt-4 text-center"
      }
    >
      {getPossessiveBrandName()} 对从 Google API
      接收的信息向任何其他应用的使用和传输都将遵守{" "}
      <a
        href="https://developers.google.com/terms/api-services-user-data-policy"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Google API 服务用户数据
      </a>{" "}
      政策，包括有限使用要求。
    </MutedText>
  );
}

function ErrorAlert({ error }: { error: string }) {
  if (error === "RequiresReconsent") {
    return (
      <AlertBasic
        variant="destructive"
        title="需要重新授权权限"
        description={getRequiresReconsentDescription({
          includeSupportText: true,
        })}
      />
    );
  }

  if (error === "OAuthAccountNotLinked") {
    return (
      <AlertBasic
        variant="destructive"
        title="账号已关联到其他用户"
        description={
          <>
            <span>你可以改为合并账号。</span>
            <Button asChild className="mt-2">
              <Link href="/accounts">合并账号</Link>
            </Button>
          </>
        }
      />
    );
  }

  if (error === "email_already_linked") {
    return (
      <AlertBasic
        variant="destructive"
        title="邮箱已关联"
        description={getEmailAlreadyLinkedDescription({
          includeSupportText: true,
        })}
      />
    );
  }

  return (
    <>
      <AlertBasic
        variant="destructive"
        title="登录出错"
        description={`登录时出错。请再次尝试登录。如果此错误持续存在，请通过 ${SUPPORT_EMAIL} 联系支持`}
      />
      <Suspense>
        <CrispChatLoggedOutVisible />
      </Suspense>
    </>
  );
}
