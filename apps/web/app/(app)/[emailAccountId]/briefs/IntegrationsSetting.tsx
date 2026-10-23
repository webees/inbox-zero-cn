"use client";

import Link from "next/link";
import { SettingCard } from "@/components/SettingCard";
import { Button } from "@/components/ui/button";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useIntegrationsEnabled } from "@/hooks/useFeatureFlags";

export function IntegrationsSetting() {
  const { emailAccountId } = useAccount();
  const { data, isLoading } = useIntegrations();
  const integrationsEnabled = useIntegrationsEnabled();

  // 等待数据加载完成，避免闪现未连接状态
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

  return (
    <SettingCard
      title="集成"
      description={
        hasConnectedIntegrations
          ? `已连接到 ${connectedIntegrations.map((i) => i.shortName || i.displayName).join("、")}，已启用 ${enabledToolsCount} 个工具`
          : "连接到 CRM、数据库和其他工具，为简报补充更多背景信息"
      }
      right={
        <Button variant="outline" asChild>
          <Link href={`/${emailAccountId}/integrations`}>
            {hasConnectedIntegrations ? "管理" : "连接"}
          </Link>
        </Button>
      }
    />
  );
}
