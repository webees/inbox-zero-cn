import {
  Client,
  MiddlewareFactory,
  type Context,
  type Middleware,
} from "@microsoft/microsoft-graph-client";
import type { User } from "@microsoft/microsoft-graph-types";
import { saveTokens } from "@/utils/auth/save-tokens";
import { cleanupInvalidTokens } from "@/utils/auth/cleanup-invalid-tokens";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import {
  getMicrosoftGraphClientOptions,
  getMicrosoftOauthAuthorizeUrl,
  requestMicrosoftToken,
} from "@/utils/outlook/oauth";
import { SCOPES } from "@/utils/outlook/scopes";
import { isInvalidGrantError, SafeError } from "@/utils/error";

// 增加缓冲时间以防止长时间运行的操作期间令牌过期
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

// 同时持有 Microsoft Graph 客户端及其访问令牌的包装类
export class OutlookClient {
  private readonly client: Client;
  private readonly accessToken: string;
  private readonly logger: Logger;
  private folderIdCache: Record<string, string> | null = null;
  private categoryMapCache: Map<string, string> | null = null;

  constructor(accessToken: string, logger: Logger) {
    this.accessToken = accessToken;
    this.logger = logger;
    const graphClientOptions = getMicrosoftGraphClientOptions(accessToken);
    const fetchOptions = {
      headers: {
        Prefer: 'IdType="ImmutableId"',
      },
    };

    if (graphClientOptions.baseUrl?.startsWith("http://")) {
      const authProvider = {
        getAccessToken: async () => this.accessToken,
      };
      const middleware =
        MiddlewareFactory.getDefaultMiddlewareChain(authProvider);
      middleware.splice(
        1,
        0,
        new OutlookEmulatorUrlMiddleware(graphClientOptions.baseUrl),
      );
      this.client = Client.initWithMiddleware({
        defaultVersion: graphClientOptions.defaultVersion,
        fetchOptions,
        middleware,
      });
      return;
    }

    this.client = Client.init({
      authProvider: (done) => {
        done(null, this.accessToken);
      },
      defaultVersion: "v1.0",
      ...graphClientOptions,
      fetchOptions,
    });
  }

  getClient(): Client {
    return this.client;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  getFolderIdCache(): Record<string, string> | null {
    return this.folderIdCache;
  }

  setFolderIdCache(cache: Record<string, string>): void {
    this.folderIdCache = cache;
  }

  getCategoryMapCache(): Map<string, string> | null {
    return this.categoryMapCache;
  }

  setCategoryMapCache(cache: Map<string, string>): void {
    this.categoryMapCache = cache;
  }

  invalidateCategoryMapCache(): void {
    this.categoryMapCache = null;
  }

  // 常见操作的辅助方法
  async getUserProfile(): Promise<User> {
    return await this.client
      .api("/me")
      .select("id,displayName,mail,userPrincipalName")
      .get();
  }

  async getUserPhoto(): Promise<string | null> {
    try {
      const photoResponse = await this.client.api("/me/photo/$value").get();

      if (photoResponse) {
        const arrayBuffer = await photoResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:image/jpeg;base64,${base64}`;
      }
      return null;
    } catch {
      this.logger.warn("获取用户照片时出错");
      return null;
    }
  }
}

class OutlookEmulatorUrlMiddleware implements Middleware {
  private next?: Middleware;
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setNext(next: Middleware) {
    this.next = next;
  }

  async execute(context: Context) {
    const requestUrl =
      typeof context.request === "string"
        ? context.request
        : context.request.url;
    const rewrittenUrl = requestUrl.replace(
      "https://graph.microsoft.com",
      this.baseUrl,
    );
    context.request =
      typeof context.request === "string"
        ? rewrittenUrl
        : new Request(rewrittenUrl, context.request);

    if (!this.next) throw new Error("Outlook 模拟器中间件不完整");
    await this.next.execute(context);
  }
}

// 创建 OutlookClient 实例的辅助函数
export const createOutlookClient = (accessToken: string, logger: Logger) => {
  if (!accessToken) throw new SafeError("未提供访问令牌");
  return new OutlookClient(accessToken, logger);
};

// 类似 Gmail 的 getGmailClientWithRefresh
export const getOutlookClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  logger,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  logger: Logger;
}): Promise<OutlookClient> => {
  if (!refreshToken) {
    // 对于已断开连接的账号是预期行为
    logger.warn("没有刷新令牌", { emailAccountId });
    await cleanupInvalidTokens({
      emailAccountId,
      reason: "invalid_grant",
      failedAccessToken: accessToken ?? undefined,
      failedRefreshToken: null,
      logger,
    }).catch((error) => logger.warn("记录缺失的刷新令牌失败", { error }));
    throw new SafeError("No refresh token");
  }

  // 检查令牌是否需要刷新
  const expiryDate = expiresAt ? expiresAt : null;
  if (
    accessToken &&
    expiryDate &&
    expiryDate > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return createOutlookClient(accessToken, logger);
  }

  // 刷新令牌
  try {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
      throw new Error("Microsoft 登录未启用 - 缺少凭据");
    }

    const response = await requestMicrosoftToken({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const tokens = await response.json();

    if (!response.ok) {
      const errorMessage = tokens.error_description || "刷新令牌失败";

      // AADSTS7000215 = 无效的客户端密钥
      // 当 Azure AD 客户端密钥轮换或刷新令牌过期时发生
      // 后台进程（watch-manager）会捕获并将其记录为警告
      // 面向用户的流程会显示错误并提示重新连接
      if (errorMessage.includes("AADSTS7000215")) {
        logger.warn("Microsoft 刷新令牌失败——用户可能需要重新连接", {
          emailAccountId,
        });
      }

      // 需要用户重新认证的 Microsoft 身份平台错误：
      // AADSTS70000 = 范围未授权或已过期
      // AADSTS70008 = 刷新令牌因不活动而过期
      // AADSTS70011 = 无效范围
      // AADSTS700082 = 刷新令牌已过期
      // AADSTS65001 = 用户未同意权限
      // AADSTS500011 = 找不到资源主体（范围问题）
      // AADSTS54005 = 授权码已被兑换
      // AADSTS50076 = 需要 MFA（条件访问策略）
      // AADSTS50079 = 需要注册 MFA
      // AADSTS50158 = 外部安全质询未满足
      // AADSTS530003 = 设备必须受管理（条件访问策略）
      // AADSTS9002313 = 格式错误的请求，例如损坏的刷新令牌
      // 无效授权由 isInvalidGrantError 处理。
      const requiresReauth =
        isInvalidGrantError(errorMessage) ||
        errorMessage.includes("AADSTS70000") ||
        errorMessage.includes("AADSTS70008") ||
        errorMessage.includes("AADSTS70011") ||
        errorMessage.includes("AADSTS700082") ||
        errorMessage.includes("AADSTS65001") ||
        errorMessage.includes("AADSTS500011") ||
        errorMessage.includes("AADSTS54005") ||
        errorMessage.includes("AADSTS50076") ||
        errorMessage.includes("AADSTS50079") ||
        errorMessage.includes("AADSTS50158") ||
        errorMessage.includes("AADSTS530003") ||
        errorMessage.includes("AADSTS9002313");

      if (requiresReauth) {
        logger.warn("Microsoft 授权已过期——用户需要重新连接", {
          emailAccountId,
          errorMessage,
        });

        await cleanupInvalidTokens({
          emailAccountId,
          reason: "invalid_grant",
          failedAccessToken: accessToken ?? undefined,
          failedRefreshToken: refreshToken,
          logger,
        }).catch((cleanupError) =>
          logger.warn("清理无效的 Outlook 令牌失败", {
            cleanupError,
          }),
        );

        throw new SafeError(
          "Your Microsoft authorization has expired. Please sign out and log in again to reconnect your account.",
        );
      }

      throw new Error(errorMessage);
    }

    // 保存新令牌
    await saveTokens({
      tokens: {
        access_token: tokens.access_token,
        expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
      },
      accountRefreshToken: refreshToken,
      emailAccountId,
      provider: "microsoft",
      expectedExpiresAt: expiresAt,
    });

    return createOutlookClient(tokens.access_token, logger);
  } catch (error) {
    if (isInvalidGrantError(error)) {
      logger.warn("刷新 Outlook 访问令牌时出错", { error });
    }

    throw error;
  }
};

export const getAccessTokenFromClient = (client: OutlookClient): string =>
  client.getAccessToken();

// 获取用于关联账号的 OAuth2 URL 的辅助函数
export function getLinkingOAuth2Url({
  loginHint,
}: {
  loginHint?: string;
} = {}) {
  if (!env.MICROSOFT_CLIENT_ID) {
    throw new Error("Microsoft 登录未启用 - 缺少客户端 ID");
  }

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/linking/callback`,
    scope: SCOPES.join(" "),
    // 不能使用 select_account，因为如果用户已过期我们需要新的刷新令牌
    prompt: "consent",
  });

  // 重新连接针对单个邮箱，因此让 Microsoft 指向它，而不是让
  // 浏览器已登录的账号来决定。
  if (loginHint) params.set("login_hint", loginHint);

  return `${getMicrosoftOauthAuthorizeUrl()}?${params.toString()}`;
}

// 常见 Microsoft Graph 操作的辅助类型
export type { Client as GraphClient };
