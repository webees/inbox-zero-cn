"use client";

import { useState } from "react";
import type { GetIntegrationsResponse } from "@/app/api/mcp/integrations/route";
import { Toggle } from "@/components/Toggle";
import { MutedText, TypographyP } from "@/components/Typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import clsx from "clsx";
import { toastError, toastSuccess } from "@/components/Toast";
import { DomainIcon } from "@/components/charts/DomainIcon";
import {
  disconnectMcpConnectionAction,
  removeCustomMcpServerAction,
  toggleMcpConnectionAction,
  toggleMcpToolAction,
} from "@/utils/actions/mcp";
import { useAccount } from "@/providers/EmailAccountProvider";
import { RequestAccessDialog } from "./RequestAccessDialog";
import { startMcpOAuth } from "./startMcpOAuth";
import { truncate } from "@/utils/string";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";

interface IntegrationRowProps {
  integration: GetIntegrationsResponse["integrations"][number];
  onConnectionChange: () => void;
}

export function IntegrationRow({
  integration,
  onConnectionChange,
}: IntegrationRowProps) {
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics("integrations");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expandedTools, setExpandedTools] = useState(false);

  const isCustom = integration.isCustom;
  const conn = integration.connection;

  const connected = !!conn;
  const isActive = conn?.isActive || false;
  const toolsCount = conn?.tools?.filter((t) => t.isEnabled).length || 0;
  const totalTools = conn?.tools?.length || 0;
  const connectionId = conn?.id;
  const tools = conn?.tools || [];

  const handleConnect = async () => {
    analytics.captureAction("integration_connect_started", {
      integration: integration.name,
      auth_type: integration.authType,
    });

    if (integration.authType === "api-token") {
      analytics.captureAction("integration_connect_failed", {
        integration: integration.name,
        reason: "unsupported_auth_type",
      });
      toastError({
        title: "连接集成时出错",
        description: "暂不支持 API 令牌连接",
      });
      return;
    }

    setConnecting(true);

    try {
      await startMcpOAuth({
        integrationName: integration.name,
        emailAccountId,
      });
    } catch (error) {
      analytics.captureAction("integration_connect_failed", {
        integration: integration.name,
        reason: "auth_url_error",
        error_message:
          error instanceof Error && error.message ? error.message : undefined,
      });
      console.error(`无法发起 ${integration.name} 连接：`, error);
      toastError({
        title: `连接 ${integration.displayName} 时出错`,
        description:
          error instanceof Error && error.message
            ? error.message
            : "请重试，如果问题仍然存在，请联系支持人员。",
      });
      setConnecting(false);
    }
  };

  const handleToggleToolsExpanded = () => {
    analytics.captureAction("integration_tools_expanded", {
      integration: integration.name,
      expanded: !expandedTools,
      enabled_tool_count: toolsCount,
      total_tool_count: totalTools,
    });
    setExpandedTools(!expandedTools);
  };

  const handleTogglePause = async () => {
    if (!connectionId) return;

    const nextActive = !isActive;
    analytics.captureAction("integration_toggled", {
      integration: integration.name,
      enabled: nextActive,
    });

    try {
      const result = await toggleMcpConnectionAction(emailAccountId, {
        connectionId,
        isActive: nextActive,
      });

      if (result?.serverError) {
        toastError({
          title: "更新集成时出错",
          description: result.serverError,
        });
      } else {
        toastSuccess({
          description: `${integration.displayName} ${nextActive ? "已恢复" : "已暂停"}`,
        });
        onConnectionChange();
      }
    } catch (error) {
      toastError({
        title: "更新集成时出错",
        description: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleToggleTool = async (toolId: string, isEnabled: boolean) => {
    analytics.captureAction("integration_tool_toggled", {
      integration: integration.name,
      enabled: isEnabled,
    });

    try {
      const result = await toggleMcpToolAction(emailAccountId, {
        toolId,
        isEnabled,
      });

      if (result?.serverError) {
        toastError({
          title: "切换工具时出错",
          description: result.serverError,
        });
      } else {
        toastSuccess({ description: "工具已更新" });
        onConnectionChange();
      }
    } catch (error) {
      toastError({
        title: "切换工具时出错",
        description: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleDisconnect = async () => {
    const confirmMessage = isCustom
      ? "确定要删除此服务器吗？这将永久删除其连接、凭据和工具。"
      : "确定要断开此集成吗？这将移除所有关联的工具。";

    if (!confirm(confirmMessage)) return;

    if (!isCustom && !connectionId) return;

    analytics.captureAction("integration_disconnect_started", {
      integration: integration.name,
    });
    setDisconnecting(true);

    try {
      const result = isCustom
        ? await removeCustomMcpServerAction(emailAccountId, {
            name: integration.name,
          })
        : await disconnectMcpConnectionAction(emailAccountId, {
            connectionId: connectionId!,
          });

      if (result?.serverError) {
        toastError({
          title: "断开连接时出错",
          description: result.serverError,
        });
      } else {
        analytics.captureAction("integration_disconnected", {
          integration: integration.name,
        });
        toastSuccess({
          title: isCustom ? "服务器已删除" : "已成功断开连接",
          description: isCustom
            ? `已删除 ${integration.displayName}`
            : `已断开与 ${integration.displayName} 的连接`,
        });
        onConnectionChange();
      }
    } catch (error) {
      toastError({
        title: "断开连接时出错",
        description: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <TableRow>
        <TableCell className="w-full">
          <div className="flex items-center gap-3">
            <DomainIcon domain={integration.url} size={32} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span>{integration.shortName || integration.displayName}</span>
                {integration.comingSoon && (
                  <Badge variant="secondary">即将推出</Badge>
                )}
                {isCustom && <Badge variant="secondary">自定义</Badge>}
              </div>
              {integration.description && (
                <MutedText>{integration.description}</MutedText>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {integration.comingSoon ? (
            <RequestAccessDialog integrationName={integration.displayName} />
          ) : connected || integration.authType !== "none" ? (
            <div className="flex items-center gap-2">
              {connected ? (
                isActive ? (
                  <span className="text-green-600 text-sm">✓ 已连接</span>
                ) : (
                  <span className="text-muted-foreground text-sm">已暂停</span>
                )
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting
                    ? "正在连接…"
                    : integration.authType === "api-token"
                      ? "使用 API 密钥连接"
                      : "连接"}
                </Button>
              )}
            </div>
          ) : (
            <TypographyP className="text-sm text-gray-500">
              无需身份验证
            </TypographyP>
          )}
        </TableCell>
        <TableCell>
          {(connected || isCustom) && !integration.comingSoon && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="iconSm" aria-label="集成操作">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {connected && (
                  <>
                    {tools.length > 0 && (
                      <DropdownMenuItem onClick={handleToggleToolsExpanded}>
                        {expandedTools
                          ? "隐藏工具"
                          : `管理工具（${totalTools} 个中有 ${toolsCount} 个已开启）`}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={handleTogglePause}>
                      {isActive ? "暂停" : "恢复"}
                    </DropdownMenuItem>
                    {integration.authType === "oauth" && (
                      <DropdownMenuItem
                        onClick={handleConnect}
                        disabled={connecting}
                      >
                        {connecting ? "正在重新连接…" : "重新连接"}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                <DropdownMenuItem
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-red-600"
                >
                  {getDisconnectLabel({ isCustom, disconnecting })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      </TableRow>

      {expandedTools && tools.length > 0 && (
        <ToolsList tools={tools} onToggleTool={handleToggleTool} />
      )}
    </>
  );
}

function getDisconnectLabel({
  isCustom,
  disconnecting,
}: {
  isCustom: boolean;
  disconnecting: boolean;
}) {
  if (isCustom) return disconnecting ? "正在删除…" : "删除";
  return disconnecting ? "正在断开连接…" : "断开连接";
}

interface ToolsListProps {
  onToggleTool: (toolId: string, isEnabled: boolean) => void;
  tools: NonNullable<
    GetIntegrationsResponse["integrations"][number]["connection"]
  >["tools"];
}

function ToolsList({ tools, onToggleTool }: ToolsListProps) {
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <TableRow>
      <TableCell colSpan={3} className="bg-muted/50">
        <div className="space-y-3">
          {sortedTools.map((tool) => (
            <div
              key={tool.id}
              className={clsx(
                "flex items-start gap-4 p-3 rounded-lg border",
                tool.isEnabled
                  ? "bg-card border-border"
                  : "bg-muted border-muted",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={clsx(
                      "font-mono text-sm font-medium",
                      tool.isEnabled
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {tool.name}
                  </span>
                </div>
                {tool.description && (
                  <MutedText className="whitespace-pre-wrap">
                    {truncate(tool.description, 100)}
                  </MutedText>
                )}
              </div>
              <div className="flex-shrink-0">
                <Toggle
                  name={`tool.${tool.id}.enabled`}
                  enabled={tool.isEnabled}
                  onChange={(enabled) => onToggleTool(tool.id, enabled)}
                />
              </div>
            </div>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}
