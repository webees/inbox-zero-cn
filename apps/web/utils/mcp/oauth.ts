import {
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientError,
  InvalidGrantError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import { getMcpFetch } from "@/utils/mcp/safe-fetch";
import type { ResolvedMcpIntegration } from "@/utils/mcp/resolve-integration";

const logger = createScopedLogger("mcp-oauth");

// 当 OAuth 服务商不返回 expires_in 时的保守默认过期窗口
// 设为 1 小时以确保令牌被主动刷新
const DEFAULT_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// 略微提前刷新，以免令牌在 agent 运行中途过期
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * 启动 OAuth 流程——使用 PKCE 生成授权 URL
 * 返回要重定向到的 URL 以及要保存在 cookie 中的 code verifier
 */
export async function generateOAuthUrl({
  integration,
  redirectUri,
  state,
}: {
  integration: ResolvedMcpIntegration;
  redirectUri: string;
  state: string;
}): Promise<{
  url: string;
  codeVerifier: string;
}> {
  if (!integration.serverUrl) {
    throw new Error(`No server URL configured for ${integration.name}`);
  }

  const clientInfo = await getOAuthClient(integration, redirectUri);
  const metadata = await discoverMetadata(integration);

  if (!metadata.authorization_endpoint) {
    throw new Error(
      `No authorization endpoint found for ${integration.name}. OAuth discovery may have failed.`,
    );
  }

  const result = await startAuthorization(metadata.authorization_endpoint, {
    metadata,
    clientInformation: clientInfo,
    redirectUrl: redirectUri,
    scope: integration.scopes.join(" "),
    state,
    ...getResourceParam(integration),
  });

  logger.info("OAuth 流程已开始", { integration: integration.name });

  return {
    url: result.authorizationUrl.toString(),
    codeVerifier: result.codeVerifier,
  };
}

/**
 * 完成 OAuth 流程——用授权码交换令牌
 * 将令牌保存到数据库并返回它们
 */
export async function handleOAuthCallback({
  integration,
  code,
  codeVerifier,
  redirectUri,
  emailAccountId,
}: {
  integration: ResolvedMcpIntegration;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  emailAccountId: string;
}): Promise<OAuthTokens> {
  if (!integration.serverUrl) {
    throw new Error(`No server URL configured for ${integration.name}`);
  }

  const clientInfo = await getOAuthClient(integration, redirectUri);
  const metadata = await discoverMetadata(integration);

  const tokens = await exchangeAuthorization(metadata.token_endpoint, {
    metadata,
    clientInformation: clientInfo,
    authorizationCode: code,
    codeVerifier,
    redirectUri,
    fetchFn: getMcpFetch(integration),
    ...getResourceParam(integration),
  });

  // 自定义服务器行由账号拥有，并且可能在用户停留在服务商的
  // 同意屏幕期间被移除；绝不要在此处重新创建它
  const dbIntegration = integration.isCustom
    ? await prisma.mcpIntegration.findFirst({
        where: { name: integration.name, emailAccountId },
        select: { id: true },
      })
    : await prisma.mcpIntegration.upsert({
        where: { name: integration.name },
        update: {},
        create: { name: integration.name },
        select: { id: true },
      });

  if (!dbIntegration) {
    throw new Error(
      `自定义 MCP 服务器 ${integration.name} 在连接完成前已被移除`,
    );
  }

  const expiresAt = calculateTokenExpiration(tokens.expires_in, {
    integration: integration.name,
    isRefresh: false,
  });

  await prisma.mcpConnection.upsert({
    where: {
      emailAccountId_integrationId: {
        emailAccountId,
        integrationId: dbIntegration.id,
      },
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
      isActive: true,
    },
    create: {
      name: integration.name,
      emailAccountId,
      integrationId: dbIntegration.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
      isActive: true,
    },
  });

  logger.info("OAuth 回调已完成", {
    integration: integration.name,
    emailAccountId,
    hasRefreshToken: !!tokens.refresh_token,
  });

  return tokens;
}

/**
 * 获取某个集成的认证令牌
 * 同时处理 OAuth（带自动刷新）和 API 令牌认证
 */
export async function getAuthToken({
  integration,
  emailAccountId,
}: {
  integration: ResolvedMcpIntegration;
  emailAccountId: string;
}): Promise<string | null> {
  if (integration.authType === "none") return null;

  if (integration.authType === "api-token") {
    const connection = await prisma.mcpConnection.findFirst({
      where: {
        emailAccountId,
        integration: { name: integration.name },
        isActive: true,
      },
      select: {
        apiKey: true,
      },
    });

    if (!connection?.apiKey) {
      throw new Error(
        `No API key found for ${integration.name}. Please configure the integration first.`,
      );
    }

    return connection.apiKey;
  }

  // OAuth 流程
  return getValidAccessToken({ integration, emailAccountId });
}

/**
 * 获取某个集成的有效访问令牌
 * 过期时自动刷新
 */
async function getValidAccessToken({
  integration,
  emailAccountId,
}: {
  integration: ResolvedMcpIntegration;
  emailAccountId: string;
}): Promise<string> {
  const connection = await prisma.mcpConnection.findFirst({
    where: {
      emailAccountId,
      integration: { name: integration.name },
      isActive: true,
    },
  });

  if (!connection?.accessToken) {
    throw new Error(
      `No access token found for ${integration.name}. Please connect the integration first.`,
    );
  }

  const isExpired =
    connection.expiresAt &&
    connection.expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now();

  if (isExpired && connection.refreshToken) {
    logger.info("访问令牌已过期，正在刷新", {
      integration: integration.name,
      emailAccountId,
    });

    const tokens = await refreshOAuthTokens({ integration, emailAccountId });
    return tokens.access_token;
  }

  if (isExpired) {
    // 没有刷新令牌，该连接就永久失效了
    await deactivateConnection({ connectionId: connection.id, emailAccountId });
    throw new Error(
      `${integration.name} 的访问令牌已过期，且没有可用的刷新令牌。请重新连接。`,
    );
  }

  return connection.accessToken;
}

/**
 * 刷新某个集成的 OAuth 令牌
 * 更新数据库中的令牌并返回新令牌
 */
async function refreshOAuthTokens({
  integration,
  emailAccountId,
}: {
  integration: ResolvedMcpIntegration;
  emailAccountId: string;
}): Promise<OAuthTokens> {
  if (!integration.serverUrl) {
    throw new Error(`未为 ${integration.name} 配置服务器 URL`);
  }

  const connection = await prisma.mcpConnection.findFirst({
    where: {
      emailAccountId,
      integration: { name: integration.name },
      isActive: true,
    },
    include: {
      integration: true,
    },
  });

  if (!connection?.refreshToken) {
    throw new Error(
      `未找到 ${integration.name} 连接（${emailAccountId}）的刷新令牌`,
    );
  }

  const clientInfo = await getOAuthClient(integration);
  const metadata = await discoverMetadata(integration);

  let tokens: OAuthTokens;
  try {
    tokens = await refreshAuthorization(metadata.token_endpoint, {
      metadata,
      clientInformation: clientInfo,
      refreshToken: connection.refreshToken,
      fetchFn: getMcpFetch(integration),
      ...getResourceParam(integration),
    });
  } catch (error) {
    // 授权已被撤销或客户端不再有效——重试永远不会
    // 成功，因此停用该连接，直到用户重新连接
    if (
      error instanceof InvalidGrantError ||
      error instanceof InvalidClientError
    ) {
      logger.warn("OAuth 授权已失效，正在停用连接", {
        error,
        integration: integration.name,
        emailAccountId,
      });
      await deactivateConnection({
        connectionId: connection.id,
        emailAccountId,
      });
      if (error instanceof InvalidClientError) {
        // 注册的 OAuth 客户端本身被拒绝——清除它，以便
        // 下一次连接尝试重新注册，而不是复用坏的客户端
        await clearRegisteredClient(integration.name);
      }
      throw new Error(
        `${integration.displayName} 连接已不再被授权。请重新连接。`,
      );
    }
    throw error;
  }

  const expiresAt = calculateTokenExpiration(tokens.expires_in, {
    integration: integration.name,
    isRefresh: true,
  });

  await prisma.mcpConnection.update({
    where: { id: connection.id, emailAccountId },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || connection.refreshToken,
      expiresAt,
    },
  });

  logger.info("OAuth 令牌已刷新", {
    integration: integration.name,
    emailAccountId,
  });

  return tokens;
}

/**
 * 发现某个集成的 OAuth 元数据
 * 为性能将发现的元数据缓存到数据库中
 * 自动发现失败时回退到静态 oauthConfig
 */
async function discoverMetadata(
  integration: ResolvedMcpIntegration,
): Promise<AuthorizationServerMetadata> {
  const name = integration.name;
  const fetchFn = getMcpFetch(integration);
  const serverUrl = getOAuthServerUrl(integration);

  // 先检查缓存
  const stored = await prisma.mcpIntegration.findUnique({
    where: { name },
    select: {
      oauthClientId: true,
      registeredAuthorizationUrl: true,
      registeredTokenUrl: true,
      registeredServerUrl: true,
    },
  });

  // 缓存的端点缺少注册元数据，因此只有在注册成功后才会复用它们。
  if (
    stored?.oauthClientId &&
    stored.registeredAuthorizationUrl &&
    stored?.registeredTokenUrl &&
    stored.registeredServerUrl === serverUrl
  ) {
    logger.info("使用缓存的 OAuth 元数据", { integration: name });

    return createAuthServerMetadata(
      serverUrl,
      stored.registeredAuthorizationUrl,
      stored.registeredTokenUrl,
    );
  }

  // 通过 RFC 8414/9728 发现
  logger.info("正在从服务器发现 OAuth 元数据", {
    integration: name,
    serverUrl,
  });

  try {
    let authServerUrl = serverUrl;

    // 先尝试受保护资源元数据（RFC 9728）——可选
    try {
      const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        serverUrl,
        undefined,
        fetchFn,
      );
      if (resourceMetadata?.authorization_servers?.[0]) {
        authServerUrl = resourceMetadata.authorization_servers[0];
        logger.info("通过受保护资源元数据找到授权服务器", {
          integration: name,
          authServerUrl,
        });
      }
    } catch {
      // 受保护资源元数据是可选的——许多服务器不实现它
      logger.info("受保护资源元数据不可用，直接使用服务器 URL", {
        integration: name,
        serverUrl,
      });
    }

    // 然后发现授权服务器元数据（RFC 8414）——必需
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl, {
      fetchFn,
    });

    if (!metadata) {
      throw new Error("OAuth 元数据发现未返回结果");
    }

    // 缓存发现的端点以备下次使用
    await upsertMcpIntegration(integration, {
      registeredAuthorizationUrl: metadata.authorization_endpoint,
      registeredTokenUrl: metadata.token_endpoint,
      registeredServerUrl: serverUrl,
    });

    logger.info("已发现并缓存 OAuth 元数据", {
      integration: name,
      authEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      registrationEndpoint: metadata.registration_endpoint,
    });

    return metadata;
  } catch (error) {
    logger.warn("发现 OAuth 元数据失败，尝试回退配置", {
      error,
      integration: name,
    });

    // 发现失败时回退到静态 oauthConfig
    if (integration.oauthConfig) {
      logger.info("使用静态 OAuth 配置回退", {
        integration: name,
        authEndpoint: integration.oauthConfig.authorization_endpoint,
      });

      const metadata = createAuthServerMetadata(
        serverUrl,
        integration.oauthConfig.authorization_endpoint,
        integration.oauthConfig.token_endpoint,
        integration.oauthConfig.registration_endpoint,
      );

      await upsertMcpIntegration(integration, {
        registeredAuthorizationUrl: metadata.authorization_endpoint,
        registeredTokenUrl: metadata.token_endpoint,
        registeredServerUrl: serverUrl,
      });

      return metadata;
    }

    logger.error("没有可用的回退 OAuth 配置", {
      error,
      integration: name,
    });
    throw new Error(
      `Could not discover OAuth endpoints for ${name}. Server may not support OAuth discovery and no fallback config is available.`,
    );
  }
}

/**
 * 获取某个集成的 OAuth 客户端凭据
 * 如果有存储的凭据则使用，否则动态注册
 */
async function getOAuthClient(
  integration: ResolvedMcpIntegration,
  redirectUri?: string,
): Promise<OAuthClientInformation> {
  const name = integration.name;

  // 检查数据库中是否有动态注册的凭据
  const stored = await prisma.mcpIntegration.findUnique({
    where: { name },
    select: {
      oauthClientId: true,
      oauthClientSecret: true,
    },
  });

  if (stored?.oauthClientId) {
    logger.info("使用已存储的 OAuth 凭证", { integration: name });
    return {
      client_id: stored.oauthClientId,
      client_secret: stored.oauthClientSecret || undefined,
    };
  }

  if (!integration.serverUrl) {
    throw new Error(`${name} 未配置服务器 URL`);
  }

  if (!redirectUri) {
    throw new Error(`动态客户端注册需要 ${name} 提供 redirectUri`);
  }

  logger.info("正在执行动态客户端注册", { integration: name });

  const metadata = await discoverMetadata(integration);

  if (!metadata.registration_endpoint) {
    throw new Error(`${name} 不支持动态注册。请配置静态 OAuth 凭据。`);
  }

  const scope = integration.scopes.join(" ");

  const clientMetadata: OAuthClientMetadata = {
    client_name: "Inbox Zero",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // 使用 PKCE 的公共客户端
    // 省略而不是发送空字符串：某些服务器会拒绝 `scope: ""`
    // 并返回 invalid_scope，而不是回退到其默认值
    ...(scope && { scope }),
    logo_uri: "https://getinboxzero.com/icon.png",
    tos_uri: "https://getinboxzero.com/terms",
  };

  const registered = await registerClient(metadata.registration_endpoint, {
    metadata,
    clientMetadata,
    fetchFn: getMcpFetch(integration),
  });

  await upsertMcpIntegration(integration, {
    oauthClientId: registered.client_id,
    oauthClientSecret: registered.client_secret,
  });

  logger.info("动态客户端注册成功", {
    integration: name,
    clientId: registered.client_id,
  });

  return {
    client_id: registered.client_id,
    client_secret: registered.client_secret,
  };
}

async function upsertMcpIntegration(
  integration: ResolvedMcpIntegration,
  data: {
    registeredAuthorizationUrl?: string;
    registeredTokenUrl?: string;
    registeredServerUrl?: string;
    oauthClientId?: string;
    oauthClientSecret?: string | null;
  },
) {
  // 自定义服务器行由其所有者创建；如果在流程中途被移除，
  // 缓存元数据绝不能把它复活成无主的行
  if (integration.isCustom) {
    return prisma.mcpIntegration.updateMany({
      where: { name: integration.name },
      data,
    });
  }

  return prisma.mcpIntegration.upsert({
    where: { name: integration.name },
    update: data,
    create: { name: integration.name, ...data },
  });
}

function createAuthServerMetadata(
  issuer: string,
  authorizationEndpoint: string,
  tokenEndpoint: string,
  registrationEndpoint?: string,
): AuthorizationServerMetadata {
  return {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    ...(registrationEndpoint && {
      registration_endpoint: registrationEndpoint,
    }),
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256", "plain"],
  };
}

function calculateTokenExpiration(
  expiresIn: number | undefined,
  context?: { integration: string; isRefresh?: boolean },
): Date {
  if (expiresIn) {
    return new Date(Date.now() + expiresIn * 1000);
  }

  // OAuth 服务商未返回 expires_in——使用保守默认值
  logger.warn("OAuth 服务商未返回 expires_in，使用默认过期时间", {
    integration: context?.integration,
    isRefresh: context?.isRefresh ?? false,
    defaultExpiryMs: DEFAULT_TOKEN_EXPIRY_MS,
  });

  return new Date(Date.now() + DEFAULT_TOKEN_EXPIRY_MS);
}

function getOAuthServerUrl(integration: ResolvedMcpIntegration): string {
  const serverUrl = integration.serverUrl || "";

  // 如果 serverUrl 以 /mcp 结尾，OAuth 发现位于基础 URL
  // 这是标准模式：OAuth 在 https://mcp.example.com，MCP 协议在 https://mcp.example.com/mcp
  if (serverUrl.endsWith("/mcp")) {
    return serverUrl.slice(0, -4);
  }

  return serverUrl;
}

/**
 * 如果集成支持，则返回 OAuth 请求的 resource 参数。
 * 某些 OAuth 服务器（例如 Pipedream）不支持 RFC 8707 resource 参数。
 */
function getResourceParam(
  integration: ResolvedMcpIntegration,
): { resource: URL } | Record<string, never> {
  if (integration.skipResourceParam || !integration.serverUrl) {
    return {};
  }
  return { resource: new URL(integration.serverUrl) };
}

async function deactivateConnection({
  connectionId,
  emailAccountId,
}: {
  connectionId: string;
  emailAccountId: string;
}) {
  try {
    await prisma.mcpConnection.update({
      where: { id: connectionId, emailAccountId },
      data: { isActive: false },
    });
  } catch (error) {
    logger.error("停用 MCP 连接失败", {
      error,
      connectionId,
      emailAccountId,
    });
  }
}

async function clearRegisteredClient(integration: string) {
  try {
    // 同时清除缓存的发现元数据：缓存变体缺少
    // 新的动态注册所需的注册端点
    await prisma.mcpIntegration.update({
      where: { name: integration },
      data: {
        oauthClientId: null,
        oauthClientSecret: null,
        registeredAuthorizationUrl: null,
        registeredTokenUrl: null,
        registeredServerUrl: null,
      },
    });
  } catch (error) {
    logger.error("清除已注册的 OAuth 客户端失败", {
      error,
      integration,
    });
  }
}
