import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { sendReconnectionEmail } from "@inboxzero/transactional-email";
import { env } from "@/env";
import {
  addUserErrorMessage,
  addUserErrorMessageWithNotification,
  ErrorType,
} from "@/utils/error-messages";
import { createUnsubscribeToken } from "@/utils/unsubscribe";

const clearedCredentials = {
  access_token: null,
  refresh_token: null,
  expires_at: null,
};

/**
 * 在认证永久失败时清理无效令牌。
 * 用于以下情况：
 * - invalid_grant：用户撤销了访问权限或令牌已过期
 * - insufficientPermissions：用户未授予全部必需的权限范围
 * - policy_enforced：服务商策略会阻止访问，直到用户更改设置
 * - mail_service_not_enabled：该账号的服务商邮箱不可用
 */
export async function cleanupInvalidTokens({
  emailAccountId,
  reason,
  failedAccessToken,
  failedRefreshToken,
  logger,
}: {
  emailAccountId: string;
  failedAccessToken?: string | null;
  failedRefreshToken?: string | null;
  reason:
    | "invalid_grant"
    | "insufficient_permissions"
    | "policy_enforced"
    | "mail_service_not_enabled";
  logger: Logger;
}) {
  if (failedAccessToken === undefined && failedRefreshToken === undefined) {
    logger.info("没有失败凭证快照，跳过凭证清理");
    return { status: "skipped" as const };
  }
  logger.info("正在清理无效令牌", { reason });

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      id: true,
      email: true,
      accountId: true,
      userId: true,
      watchEmailsExpirationDate: true,
      user: {
        select: {
          email: true,
        },
      },
      account: {
        select: {
          updatedAt: true,
          disconnectedAt: true,
          access_token: true,
          refresh_token: true,
          expires_at: true,
        },
      },
    },
  });

  if (!emailAccount) {
    logger.warn("未找到邮箱账号");
    return { status: "skipped" as const };
  }

  const account = emailAccount.account;
  if (
    !account ||
    (failedAccessToken !== undefined &&
      account.access_token !== failedAccessToken) ||
    (failedRefreshToken !== undefined &&
      account.refresh_token !== failedRefreshToken)
  ) {
    logger.info("跳过已被取代凭证的清理");
    return { status: "skipped" as const };
  }

  if (account?.disconnectedAt) {
    const hasStaleCredentials =
      !!account.access_token || !!account.refresh_token || !!account.expires_at;

    if (hasStaleCredentials) {
      await prisma.account.updateMany({
        where: {
          id: emailAccount.accountId,
          updatedAt: account.updatedAt,
          disconnectedAt: { not: null },
        },
        data: clearedCredentials,
      });
    }

    logger.info("账号已标记为断开连接");
    return;
  }

  const updated = await prisma.account.updateMany({
    where: {
      id: emailAccount.accountId,
      updatedAt: account.updatedAt,
      disconnectedAt: null,
    },
    data: { ...clearedCredentials, disconnectedAt: new Date() },
  });

  if (updated.count === 0) {
    logger.info("凭证清理前账号已变更");
    return { status: "skipped" as const };
  }

  const errorMessage = getAccountActionRequiredMessage(
    emailAccount.email,
    reason,
  );
  const sentReconnectionEmail =
    reason === "invalid_grant"
      ? await sendWatchedAccountReconnectionEmail({
          emailAccountId: emailAccount.id,
          email: emailAccount.email,
          recipientEmail: emailAccount.email,
          watchEmailsExpirationDate: emailAccount.watchEmailsExpirationDate,
          logger,
        })
      : false;

  if (sentReconnectionEmail) {
    await addUserErrorMessage(
      emailAccount.userId,
      ErrorType.ACCOUNT_DISCONNECTED,
      errorMessage,
      logger,
    );
  } else {
    await addUserErrorMessageWithNotification({
      userId: emailAccount.userId,
      userEmail: emailAccount.email,
      emailAccountId: emailAccount.id,
      errorType: ErrorType.ACCOUNT_DISCONNECTED,
      errorMessage,
      logger,
    });
  }

  logger.info("令牌已清除——用户必须重新认证", { reason });
}

async function sendWatchedAccountReconnectionEmail({
  emailAccountId,
  email,
  recipientEmail,
  watchEmailsExpirationDate,
  logger,
}: {
  emailAccountId: string;
  email: string;
  recipientEmail: string;
  watchEmailsExpirationDate: Date | null;
  logger: Logger;
}) {
  const isWatched =
    !!watchEmailsExpirationDate && watchEmailsExpirationDate > new Date();

  if (!isWatched) {
    logger.info("跳过重连邮件——账号当前未被监听");
    return false;
  }

  try {
    const unsubscribeToken = await createUnsubscribeToken({ emailAccountId });

    await sendReconnectionEmail({
      from: env.RESEND_FROM_EMAIL,
      to: recipientEmail,
      emailProps: {
        baseUrl: env.NEXT_PUBLIC_BASE_URL,
        email,
        unsubscribeToken,
      },
    });
    logger.info("重连邮件已发送", { email, recipientEmail });
    return true;
  } catch (error) {
    logger.error("发送重连邮件失败", {
      email,
      error,
    });
    return false;
  }
}

function getAccountActionRequiredMessage(
  email: string,
  reason:
    | "invalid_grant"
    | "insufficient_permissions"
    | "policy_enforced"
    | "mail_service_not_enabled",
) {
  switch (reason) {
    case "insufficient_permissions":
      return `${email} 的连接缺少必需的权限。请重新连接账号并批准所请求的权限，以恢复自动化。`;
    case "policy_enforced":
      return `${email} 的连接被你的 Google 账号安全策略阻止。请检查你的 Google 安全设置并重新连接账号，以恢复自动化。`;
    case "mail_service_not_enabled":
      return `${email} 未启用 Gmail。请为该账号启用 Gmail 并重新连接，以恢复自动化。`;
    default:
      return `${email} 的连接已断开。请重新连接账号，以恢复自动化。`;
  }
}
