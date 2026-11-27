import { REQUIRED_SCOPES } from "@/utils/gmail/scopes";
import {
  getAccessTokenFromClient,
  getGmailClientWithRefresh,
} from "@/utils/gmail/client";
import {
  getGoogleTokenInfoUrl,
  isGoogleOauthEmulationEnabled,
} from "@/utils/gmail/oauth";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("Gmail Permissions");

const AUTH_ERRORS = [
  "invalid_token",
  "invalid_grant",
  "invalid_scope",
  "access_denied",
];

async function checkGmailPermissions({
  accessToken,
  emailAccountId,
  grantedScope,
}: {
  accessToken: string;
  emailAccountId: string;
  grantedScope?: string | null;
}): Promise<{
  hasAllPermissions: boolean;
  missingScopes: string[];
  error?: string;
}> {
  if (!accessToken) {
    logger.error("没有可用的访问令牌", { emailAccountId });
    return {
      hasAllPermissions: false,
      missingScopes: [...REQUIRED_SCOPES],
      error: "没有可用的访问令牌",
    };
  }

  if (isGoogleOauthEmulationEnabled()) {
    if (!grantedScope?.trim()) {
      logger.warn("模拟环境中缺少已存储的 Gmail scope，假定权限已授予", {
        emailAccountId,
      });
      return {
        hasAllPermissions: true,
        missingScopes: [],
      };
    }

    const grantedScopes = grantedScope.split(/[,\s]+/).filter(Boolean);
    const missingScopes = getMissingRequiredScopes(grantedScopes);

    if (missingScopes.length > 0) {
      logger.info("缺少 Gmail 权限", {
        emailAccountId,
        missingScopes,
      });
    }

    return {
      hasAllPermissions: missingScopes.length === 0,
      missingScopes,
    };
  }

  try {
    const response = await fetch(getGoogleTokenInfoUrl(accessToken));

    if (!response.ok && response.status >= 500) {
      throw new Error(
        `Token info request failed with status ${response.status}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      if (!AUTH_ERRORS.includes(data.error)) {
        // 无法识别的错误（限流封套、后端故障）：无法确认为
        // 认证失败，宁可放行也不要提示重新认证
        throw new Error(
          `Token info request failed with error ${JSON.stringify(data.error)}`,
        );
      }

      // 已识别的令牌错误（4xx 响应体，或 200 上的错误响应体）：失败关闭
      // 以便刷新流程可以运行
      logger.error("无效的令牌或 Google API 错误", {
        emailAccountId,
        error: data.error,
      });
      return {
        hasAllPermissions: false,
        missingScopes: [...REQUIRED_SCOPES], // 如果无法检查，则假定所有 scope 都缺失
        error: data.error,
      };
    }

    if (!response.ok) {
      throw new Error(
        `Token info request failed with status ${response.status}`,
      );
    }

    const grantedScopes = data.scope?.split(" ") || [];
    const missingScopes = getMissingRequiredScopes(grantedScopes);

    const hasAllPermissions = missingScopes.length === 0;

    if (!hasAllPermissions)
      logger.info("缺少 Gmail 权限", {
        emailAccountId,
        missingScopes,
      });

    return { hasAllPermissions, missingScopes };
  } catch (error) {
    logger.error("检查 Gmail 权限时出错", { emailAccountId, error });
    return {
      hasAllPermissions: true,
      missingScopes: [],
    };
  }
}

export async function handleGmailPermissionsCheck({
  accessToken,
  refreshToken,
  emailAccountId,
  grantedScope,
}: {
  accessToken: string;
  refreshToken: string | null | undefined;
  emailAccountId: string;
  grantedScope?: string | null;
}) {
  const permissionsBeforeRefresh = await checkGmailPermissions({
    accessToken,
    emailAccountId,
    grantedScope,
  });

  if (
    permissionsBeforeRefresh.error &&
    AUTH_ERRORS.includes(permissionsBeforeRefresh.error)
  ) {
    // 仅使用刷新令牌再尝试刷新一次令牌
    if (refreshToken) {
      try {
        const gmailClient = await getGmailClientWithRefresh({
          accessToken: null,
          refreshToken,
          // 即使现有过期时间表明它有效也强制刷新
          expiresAt: null,
          emailAccountId,
          logger,
        });

        // 使用新的访问令牌重新检查权限
        const accessToken = getAccessTokenFromClient(gmailClient);
        const permissionsAfterRefresh = await checkGmailPermissions({
          accessToken,
          emailAccountId,
          grantedScope,
        });

        if (
          permissionsAfterRefresh.error &&
          permissionsAfterRefresh.error === "invalid_grant"
        ) {
          logger.info("正在清理无效的 Gmail 令牌", { emailAccountId });
          const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            select: { accountId: true },
          });
          if (!emailAccount)
            return {
              hasAllPermissions: false,
              error: "未找到邮箱账号",
            };

          await prisma.account.update({
            where: { id: emailAccount.accountId },
            data: {
              access_token: null,
              refresh_token: null,
              expires_at: null,
            },
          });

          return {
            hasAllPermissions: false,
            error: "Gmail 访问已过期。请重新连接你的账号。",
            missingScopes: permissionsBeforeRefresh.missingScopes,
          };
        }

        return permissionsAfterRefresh;
      } catch {
        return {
          hasAllPermissions: false,
          error: "Gmail 访问已过期。请重新连接你的账号。",
          missingScopes: permissionsBeforeRefresh.missingScopes,
        };
      }
    } else {
      logger.warn("没有可用于尝试刷新的刷新令牌", {
        emailAccountId,
      });
    }
  }

  return permissionsBeforeRefresh;
}

function getMissingRequiredScopes(grantedScopes: string[]) {
  const grantedScopeSet = new Set(grantedScopes);
  return REQUIRED_SCOPES.filter((scope) => !grantedScopeSet.has(scope));
}
