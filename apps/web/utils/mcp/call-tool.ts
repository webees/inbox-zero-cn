import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getIntegration, type IntegrationKey } from "@/utils/mcp/integrations";
import { getIntegrationRemoteSelectTools } from "@/utils/mcp/tool-specs";
import { createMcpTransport } from "@/utils/mcp/transport";
import { getMcpServerConnection } from "@/utils/mcp/server-connection";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("mcp-call-tool");

export async function callMcpTool({
  emailAccountId,
  integration,
  toolName,
  args,
}: {
  emailAccountId: string;
  integration: IntegrationKey;
  toolName: string;
  args: Record<string, unknown>;
}) {
  const integrationConfig = getIntegration(integration);

  // 写入工具来自注册表；应用自身调用的读取工具
  // 派生自声明它们的 spec，因此两者不会偏离。
  const callableTools = [
    ...(integrationConfig.ruleActionWriteTools ?? []),
    ...getIntegrationRemoteSelectTools(integration),
  ];
  if (!callableTools.includes(toolName)) {
    throw new Error(`工具 ${toolName} 不可用于 ${integration}`);
  }

  const transport = createMcpTransport(
    await getMcpServerConnection(
      { ...integrationConfig, isCustom: false },
      emailAccountId,
    ),
  );

  const client = new Client({
    name: `inbox-zero-${integration}`,
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });

    if (result.isError) {
      throw new Error("MCP 工具返回错误");
    }

    logger.info("已调用 MCP 工具", { integration, toolName });

    return result.content;
  } catch (error) {
    logger.error("调用 MCP 工具失败", {
      integration,
      toolName,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    logger.trace("MCP 工具调用失败详情", () => ({ error }));
    throw new Error(`调用 ${integration} 工具 ${toolName} 失败`);
  } finally {
    await client.close();
    await transport.close();
  }
}
