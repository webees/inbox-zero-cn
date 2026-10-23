import fs from "node:fs";
import path from "node:path";
import { env } from "@/env";
import { auth } from "@/utils/auth";
import { isAdmin } from "@/utils/admin";
import {
  hasGoogleOauthConfig,
  hasMicrosoftOauthConfig,
} from "@/utils/oauth/provider-config";
import { getConfiguredRolePrimaryModelEntry } from "@/utils/llms/model";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";

export default async function AdminConfigPage() {
  const session = await auth();

  const isUserAdmin = await isAdmin({ email: session?.user.email });

  const version = getVersion();
  const defaultLlm = getConfiguredRolePrimaryModelEntry("default");
  const economyLlm = getConfiguredRolePrimaryModelEntry("economy");

  const info = {
    version,
    environment: process.env.NODE_ENV,
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    features: {
      emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
      contactsEnabled: env.NEXT_PUBLIC_CONTACTS_ENABLED,
      gmailOtherContactsEnabled: env.NEXT_PUBLIC_GMAIL_OTHER_CONTACTS_ENABLED,
      aiModelSettingsDisabled: env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED,
      bypassPremiumChecks: env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS ?? false,
    },
    providers: {
      google: hasGoogleOauthConfig(),
      microsoft: hasMicrosoftOauthConfig(),
      microsoftTenantConfigured:
        hasMicrosoftOauthConfig() &&
        !!env.MICROSOFT_TENANT_ID &&
        env.MICROSOFT_TENANT_ID !== "common",
    },
    llm: {
      defaultProvider: defaultLlm?.provider ?? "未配置",
      defaultModel: defaultLlm?.modelName ?? "未配置",
      economyProvider: economyLlm?.provider ?? "未配置",
      economyModel: economyLlm?.modelName ?? "未配置",
    },
    integrations: {
      redis: !!env.REDIS_HTTP_URL || !!env.REDIS_URL,
      qstash: !!env.QSTASH_TOKEN,
      tinybird: !!env.TINYBIRD_TOKEN,
      sentry: !!env.NEXT_PUBLIC_SENTRY_DSN,
      posthog: !!env.NEXT_PUBLIC_POSTHOG_KEY,
      stripe: !!env.STRIPE_SECRET_KEY,
      lemonSqueezy: !!env.LEMON_SQUEEZY_API_KEY,
    },
  };

  return (
    <PageWrapper className="max-w-2xl mx-auto">
      <PageHeader title="应用配置" />

      <div className="space-y-4 mt-4">
        <Section title="应用">
          <Row label="版本" value={info.version} />
          <Row label="环境" value={info.environment} />
          <Row label="基础 URL" value={info.baseUrl} />
        </Section>

        <Section title="功能">
          <Row
            label="邮件发送"
            value={info.features.emailSendEnabled ? "已启用" : "已禁用"}
          />
          <Row
            label="联系人"
            value={info.features.contactsEnabled ? "已启用" : "已禁用"}
          />
          <Row
            label="Gmail 其他联系人"
            value={
              info.features.gmailOtherContactsEnabled ? "已启用" : "已禁用"
            }
          />
          <Row
            label="AI 模型设置"
            value={info.features.aiModelSettingsDisabled ? "已禁用" : "已启用"}
          />
          <Row
            label="绕过高级版"
            value={info.features.bypassPremiumChecks ? "是" : "否"}
          />
        </Section>

        <Section title="认证提供商">
          <Row
            label="Google"
            value={info.providers.google ? "已配置" : "未配置"}
          />
          <Row
            label="Microsoft"
            value={info.providers.microsoft ? "已配置" : "未配置"}
          />
          <Row
            label="Microsoft 租户"
            value={
              info.providers.microsoftTenantConfigured
                ? "单租户"
                : "多租户（common）"
            }
          />
        </Section>

        {isUserAdmin && (
          <>
            <Section title="LLM 配置">
              <Row label="默认提供商" value={info.llm.defaultProvider} />
              <Row label="默认模型" value={info.llm.defaultModel} />
              <Row label="经济型提供商" value={info.llm.economyProvider} />
              <Row label="经济型模型" value={info.llm.economyModel} />
            </Section>

            <Section title="集成">
              <Row
                label="Redis"
                value={info.integrations.redis ? "已配置" : "未配置"}
              />
              <Row
                label="QStash"
                value={info.integrations.qstash ? "已配置" : "未配置"}
              />
              <Row
                label="Tinybird"
                value={info.integrations.tinybird ? "已配置" : "未配置"}
              />
              <Row
                label="Sentry"
                value={info.integrations.sentry ? "已配置" : "未配置"}
              />
              <Row
                label="PostHog"
                value={info.integrations.posthog ? "已配置" : "未配置"}
              />
              <Row
                label="Stripe"
                value={info.integrations.stripe ? "已配置" : "未配置"}
              />
              <Row
                label="Lemon Squeezy"
                value={info.integrations.lemonSqueezy ? "已配置" : "未配置"}
              />
            </Section>
          </>
        )}
      </div>
    </PageWrapper>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">
        {title}
      </h2>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | boolean }) {
  const displayValue =
    typeof value === "boolean" ? (value ? "是" : "否") : value;

  return (
    <div className="flex justify-between px-4 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="font-mono text-sm text-slate-900">{displayValue}</span>
    </div>
  );
}

// 构建时读取版本
function getVersion(): string {
  try {
    const versionPath = path.join(process.cwd(), "../../version.txt");
    return fs.readFileSync(versionPath, "utf-8").trim();
  } catch {
    return "未知";
  }
}
