import prisma from "@/utils/prisma";
import {
  getPremiumUserFilter,
  getUserTier,
  hasAiAccess,
  premiumEntitlementSelect,
} from "@/utils/premium";
import type { Logger } from "@/utils/logger";
import { createEmailProvider } from "@/utils/email/provider";
import { captureException, isInvalidGrantError } from "@/utils/error";
import { cleanupInvalidTokens } from "@/utils/auth/cleanup-invalid-tokens";
import type { EmailProvider } from "@/utils/email/types";
import { createManagedOutlookSubscription } from "@/utils/outlook/subscription-manager";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { logErrorWithDedupe } from "@/utils/log-error-with-dedupe";
import { clearWatchLapsedErrorIfResolved } from "@/utils/error-messages";
import { syncGoogleEmailFromProfile } from "@/utils/auth/rename-email";

export type WatchEmailAccountResult =
  | {
      emailAccountId: string;
      status: "success";
      expirationDate: Date;
    }
  | {
      emailAccountId: string;
      status: "error";
      message: string;
      errorDetails?: string;
    };

export async function ensureEmailAccountsWatched({
  userIds,
  logger,
}: {
  userIds: string[] | null;
  logger: Logger;
}): Promise<WatchEmailAccountResult[]> {
  const emailAccounts = await getEmailAccountsToWatch(userIds);
  return await watchEmailAccounts(emailAccounts, logger);
}

async function getEmailAccountsToWatch(userIds: string[] | null) {
  return prisma.emailAccount.findMany({
    where: {
      ...(userIds ? { userId: { in: userIds } } : {}),
      ...getPremiumUserFilter(),
      account: { disconnectedAt: null },
    },
    select: {
      id: true,
      email: true,
      watchEmailsExpirationDate: true,
      watchEmailsSubscriptionId: true,
      userId: true,
      accountId: true,
      account: {
        select: {
          provider: true,
          providerAccountId: true,
          access_token: true,
          refresh_token: true,
          expires_at: true,
          disconnectedAt: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          aiApiKey: true,
          premium: {
            select: premiumEntitlementSelect,
          },
        },
      },
    },
    orderBy: {
      watchEmailsExpirationDate: { sort: "asc", nulls: "first" },
    },
  });
}

async function watchEmailAccounts(
  emailAccounts: Awaited<ReturnType<typeof getEmailAccountsToWatch>>,
  logger: Logger,
): Promise<WatchEmailAccountResult[]> {
  if (!emailAccounts.length) return [];

  logger.info("正在监控邮箱账号", { count: emailAccounts.length });

  const results: WatchEmailAccountResult[] = [];

  for (const emailAccount of emailAccounts) {
    try {
      const log = logger.with({
        emailAccountId: emailAccount.id,
        email: emailAccount.email,
        provider: emailAccount.account.provider,
      });
      const result = await watchEmailAccount(emailAccount, log);
      if (result) results.push(result);
    } catch (error) {
      if (error instanceof Error) {
        const warn = [
          "Mail service not enabled",
          "Insufficient Permission",
          "AADSTS7000215", // 无效 client secret 的原始 Azure AD 错误（密钥轮换后的旧令牌）
        ];

        if (
          isInvalidGrantError(error) ||
          warn.some((w) => error.message.includes(w))
        ) {
          logger.warn("不为用户监控邮件", {
            email: emailAccount.email,
            error,
          });
          continue;
        }
      }

      logger.error("用户出错", { error });
      results.push({
        emailAccountId: emailAccount.id,
        status: "error",
        message: "为该账号设置监控时发生意外错误。",
        errorDetails: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function watchEmailAccount(
  emailAccount: Awaited<ReturnType<typeof getEmailAccountsToWatch>>[number],
  logger: Logger,
): Promise<WatchEmailAccountResult | null> {
  const { account, user, watchEmailsExpirationDate } = emailAccount;

  const userHasAiAccess = hasAiAccess(
    getUserTier(user.premium),
    !!user.aiApiKey,
  );

  if (!userHasAiAccess) {
    logger.info("用户没有使用 AI 或冷邮件的权限");

    if (
      watchEmailsExpirationDate &&
      new Date(watchEmailsExpirationDate) < new Date()
    ) {
      await prisma.emailAccount.updateMany({
        where: { id: emailAccount.id },
        data: {
          watchEmailsExpirationDate: null,
          watchEmailsSubscriptionId: null,
        },
      });
    }

    return null;
  }

  if (!account?.access_token || !account?.refresh_token) {
    logger.info("用户没有访问令牌或刷新令牌");

    return {
      emailAccountId: emailAccount.id,
      status: "error",
      message: "缺少认证令牌。",
    };
  }

  logger.info("正在为账号监控邮件");

  const provider = await createEmailProvider({
    emailAccountId: emailAccount.id,
    provider: account.provider,
    logger,
  });

  const result = await watchEmails({
    emailAccountId: emailAccount.id,
    provider,
    logger,
  });

  if (!result.success) {
    await logErrorWithDedupe({
      logger,
      message: "监控账号邮件失败",
      error: result.error,
      dedupeKeyParts: {
        scope: "watch/all",
        emailAccountId: emailAccount.id,
        operation: "watch-email-account",
      },
      ttlSeconds: 15 * 60,
      summaryIntervalSeconds: 5 * 60,
    });

    return {
      emailAccountId: emailAccount.id,
      status: "error",
      message: "为该账号设置监控失败。",
      errorDetails:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    };
  }

  if (
    isGoogleProvider(account.provider) &&
    isEmailSyncDue(emailAccount.id, new Date())
  ) {
    try {
      const renamed = await syncGoogleEmailFromProfile({
        account: {
          id: emailAccount.accountId,
          userId: emailAccount.userId,
          providerId: account.provider,
          accountId: account.providerAccountId,
        },
        mailbox: { id: emailAccount.id, email: emailAccount.email },
        userEmail: user.email,
        accessToken: provider.getAccessToken(),
      });
      if (renamed) logger.info("已同步重命名的 Google 邮箱地址");
    } catch (error) {
      logger.warn("同步 Google 邮箱地址失败", { error });
    }
  }

  const wasLapsed =
    !watchEmailsExpirationDate ||
    new Date(watchEmailsExpirationDate) < new Date();

  if (wasLapsed) {
    // watch 已恢复健康，因此清除失效错误。这让我们在
    // 账号将来再次失效时能再次通知。
    await clearWatchLapsedErrorIfResolved({
      userId: user.id,
      emailAccountId: emailAccount.id,
      logger,
    });
  }

  return {
    emailAccountId: emailAccount.id,
    status: "success",
    expirationDate: result.expirationDate,
  };
}

async function watchEmails({
  emailAccountId,
  provider,
  logger,
}: {
  emailAccountId: string;
  provider: EmailProvider;
  logger: Logger;
}): Promise<
  { success: true; expirationDate: Date } | { success: false; error: unknown }
> {
  logger.info("正在监控邮件");
  let failedAccessToken: string | undefined;

  try {
    try {
      failedAccessToken = provider.getAccessToken();
    } catch {
      // watch 请求仍可能刷新缺失的缓存访问令牌。
    }
    if (isMicrosoftProvider(provider.name)) {
      const result = await createManagedOutlookSubscription({
        emailAccountId,
        logger,
      });

      if (result)
        return { success: true, expirationDate: result.expirationDate };
    } else {
      const result = await provider.watchEmails();

      if (result) {
        await prisma.emailAccount.update({
          where: { id: emailAccountId },
          data: { watchEmailsExpirationDate: result.expirationDate },
        });
        return { success: true, expirationDate: result.expirationDate };
      }
    }

    const error = new Error("服务商未返回监控设置结果");
    return { success: false, error };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const isInsufficientPermissions = errorMessage.includes(
      "Request had insufficient authentication scopes.",
    );
    const isInvalidGrant = isInvalidGrantError(error);

    if (isInsufficientPermissions || isInvalidGrant) {
      logger.warn("监控收件箱时认证失败 - 正在清理令牌", {
        error,
      });
      await cleanupInvalidTokens({
        emailAccountId,
        reason: isInvalidGrant ? "invalid_grant" : "insufficient_permissions",
        failedAccessToken,
        logger,
      }).catch((cleanupError) =>
        logger.warn("清理 watch 认证失败时出错", {
          cleanupError,
        }),
      );
    } else {
      captureException(error, { emailAccountId });
    }

    return { success: false, error };
  }
}

export async function stopWatchingEmailAccount({
  emailAccountId,
  provider,
  subscriptionId,
  logger,
}: {
  emailAccountId: string;
  provider: string;
  subscriptionId: string | null;
  logger: Logger;
}) {
  let emailProvider: EmailProvider;
  try {
    emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });
  } catch (error) {
    logger.warn("无法创建服务商以取消监控账号", {
      emailAccountId,
      error,
    });
    return;
  }

  await unwatchEmails({
    emailAccountId,
    provider: emailProvider,
    subscriptionId,
    logger,
  });
}

export async function unwatchEmails({
  emailAccountId,
  provider,
  subscriptionId,
  logger,
}: {
  emailAccountId: string;
  provider: EmailProvider;
  subscriptionId?: string | null;
  logger: Logger;
}) {
  try {
    logger.info("正在取消监控邮件");

    await provider.unwatchEmails(subscriptionId || undefined);
  } catch (error) {
    if (isInvalidGrantError(error)) {
      logger.warn("取消监控邮件时出错，无效授权");
    } else {
      logger.error("取消监控邮件时出错", { error });
      captureException(error, { emailAccountId });
    }
  }

  // 无论服务商如何都清除 watch 数据
  await prisma.emailAccount.updateMany({
    where: { id: emailAccountId },
    data: {
      watchEmailsExpirationDate: null,
      watchEmailsSubscriptionId: null,
    },
  });
}

// 资料查询会为每个账号增加一次请求，而每小时续订已经
// 接近其时间预算，因此每个账号每天在固定小时时段
// 检查一次，而不是每次运行都检查。
function isEmailSyncDue(emailAccountId: string, now: Date) {
  let hash = 0;
  for (const char of emailAccountId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % 24 === now.getUTCHours();
}
