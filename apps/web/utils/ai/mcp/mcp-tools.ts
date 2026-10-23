import { createMCPClient } from "@ai-sdk/mcp";
import {
  CUSTOM_INTEGRATION_PREFIX,
  resolveMcpIntegration,
} from "@/utils/mcp/resolve-integration";
import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { createMcpTransport } from "@/utils/mcp/transport";
import { getMcpServerConnection } from "@/utils/mcp/server-connection";
import { isValidMcpToolName } from "@/utils/mcp/tool-name";

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

export type MCPToolsResult = {
  tools: Record<string, unknown>;
  cleanup: () => Promise<void>;
};

export async function createMcpToolsForAgent(
  emailAccountId: string,
  { reservedToolNames = [] }: { reservedToolNames?: string[] } = {},
): Promise<MCPToolsResult> {
  const logger = createScopedLogger("ai-mcp-tools").with({ emailAccountId });

  try {
    const connections = await prisma.mcpConnection.findMany({
      where: {
        emailAccountId,
        isActive: true,
        tools: {
          some: {
            isEnabled: true,
            isWrite: false,
          },
        },
      },
      select: {
        id: true,
        integration: {
          select: {
            id: true,
            name: true,
          },
        },
        tools: {
          where: { isEnabled: true, isWrite: false },
          select: {
            name: true,
          },
        },
      },
    });

    if (connections.length === 0) {
      return {
        tools: {},
        cleanup: async () => {},
      };
    }

    const clients: MCPClient[] = [];

    const toolsByIntegration: Map<
      string,
      { toolPrefix: string; tools: Record<string, unknown> }
    > = new Map();

    for (const connection of connections) {
      const integration = connection.integration;
      const integrationConfig = await resolveMcpIntegration({
        name: integration.name,
        emailAccountId,
      });

      if (!integrationConfig) {
        logger.warn("未找到集成配置", {
          integration: integration.name,
        });
        continue;
      }

      try {
        const transport = createMcpTransport(
          await getMcpServerConnection(integrationConfig, emailAccountId),
        );

        const mcpClient = await createMCPClient({ transport });
        clients.push(mcpClient);

        const mcpTools = await mcpClient.tools();

        // 仅保留已启用的工具
        const enabledToolNames = connection.tools.map((tool) => tool.name);
        const filteredTools = Object.fromEntries(
          Object.entries(mcpTools).filter(([toolName]) =>
            enabledToolNames.includes(toolName),
          ),
        );

        toolsByIntegration.set(integration.id, {
          // 自定义名称包含 32 字符的 ID；截短可让带前缀的工具名保持在
          // 服务商的长度限制内
          toolPrefix: integrationConfig.isCustom
            ? integration.name.slice(0, CUSTOM_INTEGRATION_PREFIX.length + 8)
            : integration.name,
          tools: filteredTools,
        });
      } catch (error) {
        logger.error("无法为集成创建 MCP 客户端", {
          error,
          integration: integration.name,
        });
        // 继续处理其他集成
      }
    }

    const allTools = mergeToolsWithConflictResolution(
      toolsByIntegration,
      reservedToolNames,
      logger,
    );

    return {
      tools: allTools,
      cleanup: async () => {
        await Promise.all(
          clients.map(async (client) => {
            try {
              await client.close();
            } catch (error) {
              logger.warn("关闭 MCP 客户端时出错", { error });
            }
          }),
        );
      },
    };
  } catch (error) {
    logger.error("无法为代理创建 MCP 工具", { error });
    return {
      tools: {},
      cleanup: async () => {},
    };
  }
}

/**
 * Merges tools from multiple integrations, adding integration prefix only when there are naming conflicts.
 *
 * @param toolsByIntegration - Map of integration tools grouped by integration
 * @param reservedToolNames - Names owned by non-MCP tools in the same tool set
 * @returns Merged tools with prefixes added only for conflicting names
 */
function mergeToolsWithConflictResolution(
  toolsByIntegration: Map<
    string,
    { toolPrefix: string; tools: Record<string, unknown> }
  >,
  reservedToolNames: string[],
  logger: Logger,
): Record<string, unknown> {
  const allTools: Record<string, unknown> = {};
  const toolNameToIntegrations = new Map<string, string[]>();

  // 构建工具名到其所属集成的映射
  for (const [_, { toolPrefix, tools }] of toolsByIntegration) {
    for (const toolName of Object.keys(tools)) {
      if (!toolNameToIntegrations.has(toolName)) {
        toolNameToIntegrations.set(toolName, []);
      }
      toolNameToIntegrations.get(toolName)!.push(toolPrefix);
    }
  }

  // 合并工具，仅在存在冲突时添加前缀
  for (const [__, { toolPrefix, tools }] of toolsByIntegration) {
    for (const [toolName, toolDef] of Object.entries(tools)) {
      const integrationsWithThisTool = toolNameToIntegrations.get(toolName)!;

      const finalToolName =
        integrationsWithThisTool.length > 1 ||
        reservedToolNames.includes(toolName)
          ? `${toolPrefix}-${toolName}`
          : toolName;

      // 一个无效名称会导致整个模型调用失败，而不只是此工具
      if (!isValidMcpToolName(finalToolName)) {
        logger.warn("跳过名称不受支持的 MCP 工具", {
          toolPrefix,
          nameLength: finalToolName.length,
        });
        continue;
      }

      allTools[finalToolName] = toolDef;
    }
  }

  return allTools;
}
