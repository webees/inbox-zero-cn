"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingContent } from "@/components/LoadingContent";
import { TypographyP } from "@/components/Typography";
import {
  Table,
  TableRow,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
} from "@/components/ui/table";
import { useIntegrations } from "@/hooks/useIntegrations";
import type { GetIntegrationsResponse } from "@/app/api/mcp/integrations/route";
import { IntegrationRow } from "@/app/(app)/[emailAccountId]/integrations/IntegrationRow";
import { Card } from "@/components/ui/card";
import { toastError, toastInfo, toastSuccess } from "@/components/Toast";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";

export function Integrations() {
  const { data, isLoading, error, mutate } = useIntegrations();

  const integrations = data?.integrations || [];

  useIntegrationNotifications(data?.integrations);

  return (
    <Card>
      <LoadingContent loading={isLoading} error={error}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>连接</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.length ? (
              integrations.map((integration) => (
                <IntegrationRow
                  key={integration.name}
                  integration={integration}
                  onConnectionChange={mutate}
                />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3}>
                  <TypographyP>未找到集成</TypographyP>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </LoadingContent>
    </Card>
  );
}

function useIntegrationNotifications(
  integrations: GetIntegrationsResponse["integrations"] | undefined,
) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const analytics = useProductAnalytics("integrations");

  useEffect(() => {
    const connectedParam = searchParams.get("connected");
    const pendingParam = searchParams.get("pending");
    const errorParam = searchParams.get("error");
    if (!connectedParam && !pendingParam && !errorParam) return;

    if (errorParam) {
      const errorMessages: Record<
        string,
        { title: string; description: string }
      > = {
        cancelled: {
          title: "连接已取消",
          description: "你取消了授权。准备好后可随时重新连接。",
        },
        oauth_error: {
          title: "连接失败",
          description: "服务返回了授权错误。请重试。",
        },
        connection_failed: {
          title: "连接失败",
          description: "我们无法完成连接。请重试或联系支持人员。",
        },
        tool_sync_failed: {
          title: "已连接，但工具不可用",
          description: "我们无法加载此集成的工具。请重新连接后再试。",
        },
        forbidden: {
          title: "连接失败",
          description: "此账号无权完成连接。请重试。",
        },
      };

      const errorMessage = errorMessages[errorParam] || {
        title: "连接失败",
        description: "我们无法完成连接。请重试或联系支持人员。",
      };

      toastError(errorMessage);
      analytics.captureAction("integration_connect_failed", {
        error_code: errorParam,
      });
    } else if (!integrations) {
      // 成功提示会显示集成名称，因此等待列表加载完成
      return;
    } else if (connectedParam) {
      const displayName = getDisplayName(connectedParam, integrations);
      toastSuccess({
        title: "集成已连接",
        description: `已连接到 ${displayName}`,
      });
      analytics.captureAction("integration_connected", {
        integration: connectedParam,
      });
    } else if (pendingParam) {
      const displayName = getDisplayName(pendingParam, integrations);
      toastInfo({
        title: "连接仍在完成中",
        description: `我们仍在连接到 ${displayName}。请稍后刷新以查看最新状态。`,
      });
      analytics.captureAction("integration_connection_pending", {
        integration: pendingParam,
      });
    }

    router.replace(pathname);
  }, [analytics, integrations, pathname, router, searchParams]);
}

function getDisplayName(
  name: string,
  integrations: GetIntegrationsResponse["integrations"],
) {
  return (
    integrations.find((integration) => integration.name === name)
      ?.displayName || name
  );
}
