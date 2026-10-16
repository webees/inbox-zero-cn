import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("mcp-server-url");

// 生产环境会忽略覆盖项，以防止重定向 bearer 令牌。
export function getMcpServerUrl(integration: {
  name: string;
  serverUrl?: string;
}): string | undefined {
  if (env.NODE_ENV === "production") return integration.serverUrl;
  if (!env.MCP_SERVER_URL_OVERRIDES) return integration.serverUrl;

  try {
    const overrides: unknown = JSON.parse(env.MCP_SERVER_URL_OVERRIDES);
    if (overrides && typeof overrides === "object") {
      const override = (overrides as Record<string, unknown>)[integration.name];
      if (typeof override === "string") return override;
    }
  } catch (error) {
    logger.warn("Invalid MCP_SERVER_URL_OVERRIDES, ignoring", { error });
  }

  return integration.serverUrl;
}
