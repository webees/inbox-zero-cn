import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2Icon } from "lucide-react";
import { AlertBasic } from "@/components/Alert";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";
import { BRAND_NAME, SUPPORT_EMAIL, getBrandTitle } from "@/utils/branding";

export const metadata: Metadata = {
  title: getBrandTitle("Microsoft 管理员同意"),
  description: `为你的 Microsoft 365 组织批准 ${BRAND_NAME}。`,
  alternates: { canonical: "/login/microsoft-admin-consent" },
};

export default async function MicrosoftAdminConsentPage(props: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const searchParams = await props.searchParams;
  const hasMicrosoftLogin = getEnabledLoginProviders().has("microsoft");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl gap-14 px-6 py-12 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] md:items-center lg:px-8">
        <section className="max-w-xl">
          <Logo className="mb-12 h-auto w-56 text-primary" />
          <h1 className="font-title text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
            为你的组织批准 {BRAND_NAME}
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            授予整个租户的 Microsoft
            管理员同意，让你的组织中的用户能够连接自己的 Outlook
            邮箱，而不必让每次批准都被 IT 拦截。
          </p>

          <AdminConsentStatus
            status={searchParams?.status}
            error={searchParams?.error}
          />

          <div className="mt-12 space-y-6">
            {hasMicrosoftLogin ? (
              <Button
                asChild
                variant="outline"
                size="lg"
                className="w-full py-6"
              >
                <a
                  href="/api/outlook/admin-consent"
                  className="flex items-center justify-center"
                >
                  <Image
                    src="/images/microsoft.svg"
                    alt="Microsoft"
                    width={24}
                    height={24}
                    unoptimized
                  />
                  <span className="ml-3">使用 Microsoft 授予管理员同意</span>
                </a>
              </Button>
            ) : (
              <AlertBasic
                variant="destructive"
                title="未配置 Microsoft 登录"
                description={`在授予管理员同意之前，请先设置 Microsoft OAuth。如需帮助，请联系 ${SUPPORT_EMAIL}。`}
              />
            )}

            <p className="text-center text-sm text-muted-foreground">
              <Link
                href="/login"
                className="font-medium text-foreground hover:underline"
              >
                返回登录
              </Link>
            </p>
          </div>
        </section>

        <section className="space-y-8">
          {ADMIN_CONSENT_POINTS.map((point) => (
            <div key={point.title} className="flex gap-4">
              <CheckCircle2Icon className="mt-1 size-7 shrink-0 text-green-500" />
              <div>
                <h2 className="text-base font-semibold uppercase tracking-normal text-foreground">
                  {point.title}
                </h2>
                <p className="mt-1 text-base leading-7 text-muted-foreground">
                  {point.description}
                </p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

const ADMIN_CONSENT_POINTS = [
  {
    title: "Microsoft 365 集成",
    description: "与你的现有 Microsoft Entra 组织配合使用。",
  },
  {
    title: "整个租户批准",
    description: "为符合条件的用户一次性批准 Microsoft 权限。",
  },
  {
    title: "用户级连接",
    description: "每个用户仍需自行登录并连接自己的邮箱。",
  },
  {
    title: "管理员控制",
    description: "之后可从 Microsoft Entra 企业应用管理访问权限。",
  },
] as const;

function AdminConsentStatus({
  status,
  error,
}: {
  status?: string;
  error?: string;
}) {
  if (status === "success") {
    return (
      <AlertBasic
        className="mt-8"
        variant="success"
        title="已授予管理员同意"
        description="你的组织中的用户现在可以使用 Microsoft 登录并连接自己的 Outlook 邮箱。"
      />
    );
  }

  if (!error) return null;

  return (
    <AlertBasic
      className="mt-8"
      variant="destructive"
      title="管理员同意未完成"
      description="请使用获准授予整个租户同意的 Microsoft 365 管理员账号重试。"
    />
  );
}
