"use client";

import Link from "next/link";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { SettingCard } from "@/components/SettingCard";
import { Button } from "@/components/ui/button";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useIntegrationsEnabled } from "@/hooks/useFeatureFlags";

export function IntegrationsSetting() {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const { data, isLoading } = useIntegrations();
  const integrationsEnabled = useIntegrationsEnabled();

  // Wait for data so we don't flash the unconnected state
  if (!integrationsEnabled || isLoading) {
    return null;
  }

  const connectedIntegrations =
    data?.integrations.filter((i) => i.connection?.isActive && !i.comingSoon) ||
    [];

  const enabledToolsCount = connectedIntegrations.reduce(
    (count, i) =>
      count + (i.connection?.tools?.filter((t) => t.isEnabled).length || 0),
    0,
  );

  const hasConnectedIntegrations = connectedIntegrations.length > 0;
  const connectedNames = connectedIntegrations
    .map((i) => i.shortName || i.displayName)
    .join(", ");

  return (
    <SettingCard
      title={t`集成`}
      description={
        hasConnectedIntegrations
          ? t`已连接到 ${connectedNames}，并启用了 ${plural(enabledToolsCount, {
              one: "# 个工具",
              other: "# 个工具",
            })}`
          : t`连接 CRM、数据库和其他工具，为简报提供更多上下文`
      }
      right={
        <Button variant="outline" asChild>
          <Link href={`/${emailAccountId}/integrations`}>
            {hasConnectedIntegrations ? (
              <Trans>管理</Trans>
            ) : (
              <Trans>连接</Trans>
            )}
          </Link>
        </Button>
      }
    />
  );
}
