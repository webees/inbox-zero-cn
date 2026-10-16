import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ResolvedMcpIntegration } from "@/utils/mcp/resolve-integration";
import { createMcpTransport } from "@/utils/mcp/transport";
import { getMcpServerConnection } from "@/utils/mcp/server-connection";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("mcp-list-tools");

export async function listMcpTools(
  integration: ResolvedMcpIntegration,
  emailAccountId: string,
): Promise<
  Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    readOnlyHint?: boolean;
  }>
> {
  const transport = createMcpTransport(
    await getMcpServerConnection(integration, emailAccountId),
  );

  const client = new Client({
    name: `inbox-zero-${integration.name}`,
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();

    logger.info("已列出 MCP 工具", {
      integration: integration.name,
      toolCount: result.tools.length,
    });

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnlyHint: tool.annotations?.readOnlyHint,
    }));
  } catch (error) {
    logger.error("列出 MCP 工具失败", {
      error,
      integration: integration.name,
    });
    throw new Error(
      `列出工具失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  } finally {
    await client.close();
    await transport.close();
  }
}
