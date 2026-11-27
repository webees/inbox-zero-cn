import { listMcpTools } from "@/utils/mcp/list-tools";
import {
  resolveMcpIntegration,
  type ResolvedMcpIntegration,
} from "@/utils/mcp/resolve-integration";
import { isValidMcpToolName } from "@/utils/mcp/tool-name";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import type { Prisma } from "@/generated/prisma/client";

// 自定义服务器没有精选的允许列表，因此限制单个服务器可存储的数量
const MAX_CUSTOM_TOOLS = 50;
const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;

export async function syncMcpTools(
  integrationName: string,
  emailAccountId: string,
  log: Logger,
) {
  const integration = await resolveMcpIntegration({
    name: integrationName,
    emailAccountId,
  });
  if (!integration) {
    throw new Error(`Unknown integration: ${integrationName}`);
  }

  const logger = log.with({ integration: integrationName, emailAccountId });

  logger.info("Syncing MCP tools");

  try {
    const mcpConnection = await prisma.mcpConnection.findFirst({
      where: {
        emailAccountId,
        integration: {
          name: integrationName,
        },
        isActive: true,
      },
      include: {
        integration: true,
        tools: { select: { name: true, isEnabled: true } },
      },
    });

    if (!mcpConnection) {
      throw new Error(`No active connection found for ${integrationName}`);
    }

    const allTools = await listMcpTools(integration, emailAccountId);

    const tools = integration.isCustom
      ? buildCustomTools(allTools, logger)
      : buildBuiltInTools(integration, allTools, logger);

    logger.info("Fetched and filtered tools from MCP server", {
      totalToolsAvailable: allTools.length,
      storedToolsCount: tools.length,
    });

    // 替换已存储的工具，同时保留用户对
    // 已存在工具的启用/禁用选择
    const existingEnabledByName = new Map(
      mcpConnection.tools.map((tool) => [tool.name, tool.isEnabled]),
    );

    await prisma.$transaction([
      prisma.mcpTool.deleteMany({
        where: { connectionId: mcpConnection.id },
      }),
      ...(tools.length > 0
        ? [
            prisma.mcpTool.createMany({
              data: tools.map((tool) => ({
                connectionId: mcpConnection.id,
                name: tool.name,
                description: tool.description,
                schema: tool.inputSchema as Prisma.InputJsonValue,
                isEnabled:
                  existingEnabledByName.get(tool.name) ?? tool.defaultEnabled,
                isWrite: tool.isWrite,
              })),
            }),
          ]
        : []),
    ]);

    logger.info("已成功同步 MCP 工具", {
      connectionId: mcpConnection.id,
      toolsStored: tools.length,
    });

    return {
      success: true,
      toolsCount: tools.length,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  } catch (error) {
    logger.error("同步 MCP 工具失败", { error });

    throw new Error(
      `同步工具失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}

type ListedTool = Awaited<ReturnType<typeof listMcpTools>>[number];
type StoredTool = ListedTool & { isWrite: boolean; defaultEnabled: boolean };

function buildBuiltInTools(
  integration: ResolvedMcpIntegration,
  allTools: ListedTool[],
  logger: Logger,
): StoredTool[] {
  const writeToolNames = integration.ruleActionWriteTools ?? [];
  const writeTools = allTools.filter((tool) =>
    writeToolNames.includes(tool.name),
  );

  // 所有非写入工具都是读取工具，并在配置声明允许列表时
  // 收窄到该允许列表
  const allowedToolNames = integration.allowedTools;
  let readTools = allTools.filter(
    (tool) =>
      !writeToolNames.includes(tool.name) &&
      (!allowedToolNames || allowedToolNames.includes(tool.name)),
  );

  // Pipedream 暴露的工具目录会变化。在存储工具之前，要求其注解
  // 和操作名称都表明这是读取操作。
  if (integration.filterWriteTools) {
    const beforeCount = readTools.length;
    readTools = readTools.filter(
      (tool) => tool.readOnlyHint === true && isReadOnlyTool(tool.name),
    );
    logger.info("Filtered write tools", {
      before: beforeCount,
      after: readTools.length,
      filtered: beforeCount - readTools.length,
    });
  }

  const defaultEnabled = !integration.filterWriteTools;

  return [
    ...readTools.map((tool) => ({ ...tool, isWrite: false, defaultEnabled })),
    ...writeTools.map((tool) => ({ ...tool, isWrite: true, defaultEnabled })),
  ];
}

function buildCustomTools(
  listedTools: ListedTool[],
  logger: Logger,
): StoredTool[] {
  const allTools = listedTools.filter((tool) => isValidMcpToolName(tool.name));

  if (allTools.length < listedTools.length) {
    logger.warn("Skipped custom MCP tools with unsupported names", {
      skipped: listedTools.length - allTools.length,
    });
  }

  if (allTools.length > MAX_CUSTOM_TOOLS) {
    logger.warn("Custom MCP server exposes more tools than we store", {
      available: allTools.length,
      stored: MAX_CUSTOM_TOOLS,
    });
  }

  // 当数量上限裁掉其余工具时保留被标注为只读的工具：它们是
  // 唯一默认启用的工具
  const prioritized = [
    ...allTools.filter((tool) => tool.readOnlyHint === true),
    ...allTools.filter((tool) => tool.readOnlyHint !== true),
  ];

  // 自定义工具从不作为规则动作运行，因此它们绝不是写入工具。
  // 只有服务器标注为只读的工具才会默认启用。
  return prioritized.slice(0, MAX_CUSTOM_TOOLS).map((tool) => ({
    ...tool,
    description: tool.description?.slice(0, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH),
    isWrite: false,
    defaultEnabled: tool.readOnlyHint === true,
  }));
}

// 只读动作动词——检查第二段是否匹配
const READ_ONLY_ACTIONS = [
  "get",
  "retrieve",
  "find",
  "search",
  "list",
  "fetch",
  "read",
  "query",
  "describe",
  "lookup",
  "view",
  "show",
];

/**
 * 检查工具名称是否表示只读操作。
 * 工具名称遵循模式："app-action-target"（例如 "slack_v2-list-channels"）
 */
export function isReadOnlyTool(toolName: string): boolean {
  const parts = toolName.toLowerCase().split("-");
  if (parts.length < 2) return false;

  const action = parts[1];
  return READ_ONLY_ACTIONS.includes(action);
}
