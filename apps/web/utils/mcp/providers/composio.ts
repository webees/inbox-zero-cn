import { z } from "zod";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";
import type { IntegrationProvider } from "@/utils/mcp/providers/types";

const logger = createScopedLogger("composio");

const COMPOSIO_API_URL = "https://backend.composio.dev/api/v3";
const COMPOSIO_REQUEST_TIMEOUT_MS = 15_000;

// 认证配置和 MCP 服务器按应用在所有用户间共享。每个
// 实例都解析最早匹配的资源，使并发的首次
// 配置收敛到同一个。
const authConfigIds = new Map<string, Promise<string>>();
const mcpServerUrls = new Map<string, Promise<string>>();

export const composioProvider: IntegrationProvider = {
  isConfigured: () => !!env.COMPOSIO_API_KEY,

  async getConnectUrl({ app, emailAccountId, callbackUrl }) {
    const authConfigId = await getAuthConfigId(app);
    const link = linkSchema.parse(
      await composioFetch("/connected_accounts/link", {
        method: "POST",
        body: {
          auth_config_id: authConfigId,
          user_id: emailAccountId,
          callback_url: callbackUrl,
        },
      }),
    );
    return link.redirect_url;
  },

  async completeConnection({ app, emailAccountId }) {
    const accounts = await listConnectedAccounts({ app, emailAccountId });
    const [newestActive] = accounts
      .filter((account) => account.status === "ACTIVE")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!newestActive) return false;

    await deleteConnectedAccounts(
      accounts.filter((account) => account.id !== newestActive.id),
    );
    return true;
  },

  async disconnect({ app, emailAccountId }) {
    await deleteConnectedAccounts(
      await listConnectedAccounts({ app, emailAccountId }),
    );
  },

  async getMcpServer({ app, emailAccountId, allowedTools }) {
    const serverUrl = await getMcpServerUrl(app, allowedTools);
    const url = new URL(serverUrl);
    url.searchParams.set("user_id", emailAccountId);
    return {
      url: url.toString(),
      headers: { "x-api-key": getApiKey() },
    };
  },
};

function getAuthConfigId(app: string) {
  return memoize(authConfigIds, app, async () => {
    const name = getResourceName(app);
    const { items } = authConfigListSchema.parse(
      await composioFetch(
        `/auth_configs?${new URLSearchParams({ toolkit_slug: app, limit: "100" })}`,
      ),
    );
    const [existing] = items
      .filter((item) => item.name === name && item.status === "ENABLED")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (existing) return existing.id;

    const created = createdAuthConfigSchema.parse(
      await composioFetch("/auth_configs", {
        method: "POST",
        body: {
          toolkit: { slug: app },
          auth_config: { type: "use_composio_managed_auth", name },
        },
      }),
    );
    logger.info("已创建 Composio 认证配置", { app });
    return created.auth_config.id;
  });
}

function getMcpServerUrl(app: string, allowedTools: string[]) {
  return memoize(mcpServerUrls, app, async () => {
    const authConfigId = await getAuthConfigId(app);
    const name = getResourceName(app);
    const { items } = mcpServerListSchema.parse(
      await composioFetch(
        `/mcp/servers?${new URLSearchParams({
          name,
          order_by: "created_at",
          order_direction: "asc",
        })}`,
      ),
    );
    const existing = items.find(
      (item) =>
        item.name === name && item.auth_config_ids.includes(authConfigId),
    );

    if (!existing) {
      const created = mcpServerSchema.parse(
        await composioFetch("/mcp/servers", {
          method: "POST",
          body: {
            name,
            auth_config_ids: [authConfigId],
            allowed_tools: allowedTools,
          },
        }),
      );
      logger.info("已创建 Composio MCP 服务器", { app });
      return created.mcp_url;
    }

    // 服务器会强制执行允许列表，因此要与注册表保持一致
    if (!haveSameItems(existing.allowed_tools, allowedTools)) {
      await composioFetch(`/mcp/${existing.id}`, {
        method: "PATCH",
        body: { allowed_tools: allowedTools },
      });
      logger.info("已更新 Composio MCP 服务器工具", { app });
    }
    return existing.mcp_url;
  });
}

async function listConnectedAccounts({
  app,
  emailAccountId,
}: {
  app: string;
  emailAccountId: string;
}) {
  const authConfigId = await getAuthConfigId(app);
  const { items } = connectedAccountListSchema.parse(
    await composioFetch(
      `/connected_accounts?${new URLSearchParams({
        user_ids: emailAccountId,
        auth_config_ids: authConfigId,
        limit: "100",
      })}`,
    ),
  );
  return items;
}

async function deleteConnectedAccounts(accounts: { id: string }[]) {
  await Promise.all(
    accounts.map((account) =>
      composioFetch(`/connected_accounts/${account.id}`, { method: "DELETE" }),
    ),
  );
}

async function composioFetch(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<unknown> {
  const response = await fetch(`${COMPOSIO_API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "x-api-key": getApiKey(),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(COMPOSIO_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Composio 会在响应正文中说明拒绝原因（例如缺少密钥权限）
    const reason = await response.text().catch(() => "");
    throw new Error(
      `Composio 请求失败：${options.method ?? "GET"} ${path.split("?")[0]} 返回了 ${response.status}${reason ? `：${reason.slice(0, 500)}` : ""}`,
    );
  }

  return response.json();
}

function getApiKey() {
  if (!env.COMPOSIO_API_KEY) throw new Error("未设置 COMPOSIO_API_KEY");
  return env.COMPOSIO_API_KEY;
}

function getResourceName(app: string) {
  return `inbox-zero-${app}`;
}

function memoize(
  cache: Map<string, Promise<string>>,
  key: string,
  load: () => Promise<string>,
) {
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

function haveSameItems(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}

const linkSchema = z.object({ redirect_url: z.string().url() });

const authConfigListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      created_at: z.string(),
    }),
  ),
});

const createdAuthConfigSchema = z.object({
  auth_config: z.object({ id: z.string() }),
});

const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  mcp_url: z.string().url(),
  auth_config_ids: z.array(z.string()),
  allowed_tools: z.array(z.string()),
});

const mcpServerListSchema = z.object({ items: z.array(mcpServerSchema) });

const connectedAccountListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), status: z.string(), created_at: z.string() }),
  ),
});
