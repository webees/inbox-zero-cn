import prisma from "@/utils/prisma";
import { encryptToken } from "@/utils/encryption";
import { captureException } from "@/utils/error";
import { createScopedLogger } from "@/utils/logger";
import { clearAccountDisconnectedErrorIfResolved } from "@/utils/error-messages";

const logger = createScopedLogger("auth");

export async function saveTokens({
  tokens,
  accountRefreshToken,
  providerAccountId,
  emailAccountId,
  provider,
  expectedExpiresAt,
}: {
  tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  accountRefreshToken: string | null;
  provider: string;
  expectedExpiresAt?: number | null;
} & (
  | {
      providerAccountId: string;
      emailAccountId?: never;
    }
  | {
      emailAccountId: string;
      providerAccountId?: never;
    }
)) {
  const refreshToken = tokens.refresh_token ?? accountRefreshToken;

  if (!refreshToken) {
    logger.error("尝试保存空的 refresh token", { providerAccountId });
    captureException("无法保存空的 refresh token", {
      extra: { providerAccountId },
    });
    return;
  }

  const data = {
    access_token: tokens.access_token,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000) : null,
    refresh_token: refreshToken,
    disconnectedAt: null,
  };

  if (emailAccountId) {
    if (expectedExpiresAt !== undefined) {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { userId: true },
      });

      const result = await prisma.account.updateMany({
        where: {
          provider,
          emailAccount: { id: emailAccountId },
          expires_at: getExpectedExpiresAtWhere(expectedExpiresAt),
        },
        data,
      });

      if (result.count === 0) {
        logger.info("已跳过过期的 OAuth 令牌更新", {
          emailAccountId,
          provider,
        });
        return { status: "conflict" as const };
      }

      if (emailAccount) {
        await clearAccountDisconnectedErrorIfResolved({
          userId: emailAccount.userId,
          logger,
        });
      }

      return { status: "saved" as const };
    }

    if (data.access_token)
      data.access_token = encryptToken(data.access_token) || undefined;
    if (data.refresh_token)
      data.refresh_token = encryptToken(data.refresh_token) || "";

    const emailAccount = await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { account: { update: data } },
      select: { userId: true },
    });

    await clearAccountDisconnectedErrorIfResolved({
      userId: emailAccount.userId,
      logger,
    });
  } else {
    if (!providerAccountId) {
      logger.error("数据库中未找到 providerAccountId", {
        emailAccountId,
      });
      captureException("数据库中未找到 providerAccountId", {
        extra: { emailAccountId },
      });
      return;
    }

    const account = await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      data,
    });

    await clearAccountDisconnectedErrorIfResolved({
      userId: account.userId,
      logger,
    });

    return account;
  }

  return { status: "saved" as const };
}

function getExpectedExpiresAtWhere(expectedExpiresAt: number | null) {
  if (!expectedExpiresAt) return null;

  return {
    gte: new Date(expectedExpiresAt),
    lt: new Date(expectedExpiresAt + 1),
  };
}
