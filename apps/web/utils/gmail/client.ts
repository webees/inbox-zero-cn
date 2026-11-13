import { auth, gmail, type gmail_v1 } from "@googleapis/gmail";
import { people } from "@googleapis/people";
import { saveTokens } from "@/utils/auth/save-tokens";
import { cleanupInvalidTokens } from "@/utils/auth/cleanup-invalid-tokens";
import type { Logger } from "@/utils/logger";
import { SCOPES } from "@/utils/gmail/scopes";
import { SafeError } from "@/utils/error";
import { classifyEmailAccountProviderIssue } from "@/utils/email/provider-health";
import { env } from "@/env";
import {
  getGoogleGmailApiRootUrl,
  getGoogleOauthClientOptions,
  getGooglePeopleApiRootUrl,
} from "@/utils/gmail/oauth";

type AuthOptions = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  expiresAt?: number | null;
};

const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

const getAuth = ({
  accessToken,
  refreshToken,
  expiresAt,
  ...rest
}: AuthOptions) => {
  const expiryDate = expiresAt ? expiresAt : rest.expiryDate;

  const googleAuth = new auth.OAuth2(getGoogleOauthClientOptions());
  googleAuth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
    scope: SCOPES.join(" "),
  });

  return googleAuth;
};

export function getLinkingOAuth2Client() {
  return new auth.OAuth2(
    getGoogleOauthClientOptions(
      `${env.NEXT_PUBLIC_BASE_URL}/api/google/linking/callback`,
    ),
  );
}

// 我们可能应该在各处都使用它而不是 getGmailClient，因为它会处理访问令牌的刷新并保存到数据库
export const getGmailClientWithRefresh = async ({
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
}): Promise<gmail_v1.Gmail> => {
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

  // 我们自己处理刷新，因此不传入 expiresAt
  const auth = getAuth({ accessToken, refreshToken });
  const g = gmail({ version: "v1", auth, rootUrl: getGoogleGmailApiRootUrl() });

  const expiryDate = expiresAt ? expiresAt : null;
  if (expiryDate && expiryDate > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return g;
  }

  // 可能抛出 `invalid_grant` 错误
  try {
    const tokens = await auth.refreshAccessToken();
    const newAccessToken = tokens.credentials.access_token;

    if (newAccessToken !== accessToken) {
      await saveTokens({
        tokens: {
          access_token: newAccessToken ?? undefined,
          expires_at: tokens.credentials.expiry_date
            ? Math.floor(tokens.credentials.expiry_date / 1000)
            : undefined,
        },
        accountRefreshToken: refreshToken,
        emailAccountId,
        provider: "google",
        expectedExpiresAt: expiresAt,
      });
    }

    return g;
  } catch (error) {
    // 只有这次刷新知道哪些凭据失败，因此它负责处理
    // 每一种账号级拒绝（撤销授权、阻止性安全策略）。
    const issue = classifyEmailAccountProviderIssue({
      error,
      provider: "google",
    });
    if (issue) {
      logger.warn("刷新 Gmail 访问令牌时出错", {
        emailAccountId,
        reason: issue.reason,
        error: error instanceof Error ? error.message : String(error),
        // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
        errorDescription: (error as any).response?.data?.error_description,
      });

      try {
        await cleanupInvalidTokens({
          emailAccountId,
          reason: issue.reason,
          failedAccessToken: accessToken ?? undefined,
          failedRefreshToken: refreshToken,
          logger,
        });
      } catch (cleanupError) {
        logger.error(
          "Failed to clean up invalid tokens after refresh failure",
          {
            emailAccountId,
            cleanupError,
          },
        );
      }
    }

    throw error;
  }
};

// 不处理访问令牌的刷新
// 可能应该使用与 getGmailClientWithRefresh 相同的 auth 对象，但目前并不关键
export const getContactsClient = ({
  accessToken,
  refreshToken,
}: AuthOptions) => {
  const auth = getAuth({ accessToken, refreshToken });
  const contacts = people({
    version: "v1",
    auth,
    rootUrl: getGooglePeopleApiRootUrl(),
  });

  return contacts;
};

export const getAccessTokenFromClient = (client: gmail_v1.Gmail): string => {
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  const accessToken = (client.context._options.auth as any).credentials
    .access_token;
  if (!accessToken) throw new Error("没有访问令牌");
  return accessToken;
};
