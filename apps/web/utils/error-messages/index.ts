import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { captureException } from "@/utils/error";
import { sendActionRequiredEmail } from "@inboxzero/transactional-email";
import { env } from "@/env";
import { createUnsubscribeToken } from "@/utils/unsubscribe";
import type { Prisma } from "@/generated/prisma/client";

// 用于存储会在界面中展示给用户的错误消息

export const ErrorType = {
  INCORRECT_API_KEY: "Incorrect API key",
  INVALID_AI_MODEL: "Invalid AI model",
  API_KEY_DEACTIVATED: "API key deactivated",
  AI_QUOTA_ERROR: "AI quota error",
  INSUFFICIENT_CREDITS: "Insufficient AI credits",
  TRIAL_AI_LIMIT_REACHED: "Trial AI limit reached",
  ACCOUNT_DISCONNECTED: "Account disconnected",
  EMAIL_WATCH_LAPSED: "Email automation stopped",
  // 保留的历史键，用于清除旧的已存储错误
  INCORRECT_OPENAI_API_KEY: "Incorrect OpenAI API key",
  OPENAI_API_KEY_DEACTIVATED: "OpenAI API key deactivated",
  ANTHROPIC_INSUFFICIENT_BALANCE: "Anthropic insufficient balance",
} as const;

type ErrorMessageEntry = {
  message: string;
  timestamp: string;
  emailSentAt?: string;
  actionUrl?: string;
  actionLabel?: string;
};

type ErrorMessages = Record<string, ErrorMessageEntry>;
type ErrorTypeValue = (typeof ErrorType)[keyof typeof ErrorType];
export type PersistedErrorType = Exclude<
  ErrorTypeValue,
  typeof ErrorType.TRIAL_AI_LIMIT_REACHED
>;

// 一个用户可能有多个账号，因此 EMAIL_WATCH_LAPSED 按账号作键
// 而不是按 errorType。
export function watchLapsedErrorKey(emailAccountId: string): string {
  return `${ErrorType.EMAIL_WATCH_LAPSED}:${emailAccountId}`;
}

export async function getUserErrorMessages(
  userId: string,
): Promise<ErrorMessages | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { errorMessages: true },
  });
  const errorMessages = (user?.errorMessages as ErrorMessages) || null;

  if (errorMessages?.[ErrorType.TRIAL_AI_LIMIT_REACHED]) {
    const updatedErrorMessages = { ...errorMessages };
    delete updatedErrorMessages[ErrorType.TRIAL_AI_LIMIT_REACHED];

    await prisma.user.update({
      where: { id: userId },
      data: { errorMessages: updatedErrorMessages },
    });

    return Object.keys(updatedErrorMessages).length
      ? addLegacyAccountRecoveryAction(userId, updatedErrorMessages)
      : null;
  }

  return addLegacyAccountRecoveryAction(userId, errorMessages);
}

export function getAccountRecoveryAction(emailAccountId: string) {
  return {
    actionUrl: `/${emailAccountId}/permissions/consent`,
    actionLabel: "重新连接账号",
  };
}

export async function addUserErrorMessage(
  userId: string,
  errorType: PersistedErrorType,
  errorMessage: string,
  logger: Logger,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    logger.warn("未找到用户");
    return;
  }

  const currentErrorMessages = (user?.errorMessages as ErrorMessages) || {};

  const newErrorMessages = {
    ...currentErrorMessages,
    [errorType]: {
      message: errorMessage,
      timestamp: new Date().toISOString(),
    },
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { errorMessages: newErrorMessages },
  });
}

export async function clearUserErrorMessages({
  userId,
  logger,
}: {
  userId: string;
  logger: Logger;
}): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { errorMessages: {} },
    });
  } catch (error) {
    logger.error("清除用户错误消息时出错：", { error });
    captureException(error, { extra: { userId } });
  }
}

export async function clearSpecificErrorMessages({
  userId,
  errorTypes,
  logger,
}: {
  userId: string;
  errorTypes: string[];
  logger: Logger;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { errorMessages: true },
    });

    if (!user) return;

    const currentErrorMessages = (user.errorMessages as ErrorMessages) || {};
    const updatedErrorMessages = { ...currentErrorMessages };

    for (const errorType of errorTypes) {
      delete updatedErrorMessages[errorType];
    }

    await prisma.user.update({
      where: { id: userId },
      data: { errorMessages: updatedErrorMessages },
    });
  } catch (error) {
    logger.error("清除特定错误消息时出错：", {
      userId,
      errorTypes,
      error,
    });
    captureException(error, { extra: { userId, errorTypes } });
  }
}

export async function clearAccountDisconnectedErrorIfResolved({
  userId,
  logger,
}: {
  userId: string;
  logger: Logger;
}): Promise<void> {
  let disconnectedAccounts: number;
  try {
    disconnectedAccounts = await prisma.emailAccount.count({
      where: {
        userId,
        account: { disconnectedAt: { not: null } },
      },
    });
  } catch (error) {
    logger.error("检查账号断开连接错误时出错：", {
      userId,
      error,
    });
    captureException(error, { extra: { userId } });
    return;
  }

  if (disconnectedAccounts > 0) return;

  await clearSpecificErrorMessages({
    userId,
    errorTypes: [ErrorType.ACCOUNT_DISCONNECTED],
    logger,
  });
}

// 调用方必须先确认账号的监听正常，才能调用此方法。
export async function clearWatchLapsedErrorIfResolved({
  userId,
  emailAccountId,
  logger,
}: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  await clearSpecificErrorMessages({
    userId,
    errorTypes: [watchLapsedErrorKey(emailAccountId)],
    logger,
  });
}

const errorTypeConfig: Record<
  PersistedErrorType,
  { label: string; actionUrl: string; actionLabel: string }
> = {
  [ErrorType.INCORRECT_API_KEY]: {
    label: "API 密钥问题",
    actionUrl: "/settings",
    actionLabel: "更新 API 密钥",
  },
  [ErrorType.INVALID_AI_MODEL]: {
    label: "AI 模型无效",
    actionUrl: "/settings",
    actionLabel: "更新设置",
  },
  [ErrorType.API_KEY_DEACTIVATED]: {
    label: "API 密钥已停用",
    actionUrl: "/settings",
    actionLabel: "更新 API 密钥",
  },
  [ErrorType.AI_QUOTA_ERROR]: {
    label: "AI 速率受限",
    actionUrl: "/settings",
    actionLabel: "更新设置",
  },
  [ErrorType.INSUFFICIENT_CREDITS]: {
    label: "额度不足",
    actionUrl: "/settings",
    actionLabel: "更新设置",
  },
  [ErrorType.ACCOUNT_DISCONNECTED]: {
    label: "账号已断开连接",
    actionUrl: "/accounts",
    actionLabel: "重新连接账号",
  },
  [ErrorType.EMAIL_WATCH_LAPSED]: {
    label: "邮件自动化已停止",
    actionUrl: "/accounts",
    actionLabel: "重新连接账号",
  },
  // 历史键 — 仅为让旧的已存储错误仍能渲染
  [ErrorType.INCORRECT_OPENAI_API_KEY]: {
    label: "API 密钥问题",
    actionUrl: "/settings",
    actionLabel: "更新 API 密钥",
  },
  [ErrorType.OPENAI_API_KEY_DEACTIVATED]: {
    label: "API 密钥已停用",
    actionUrl: "/settings",
    actionLabel: "更新 API 密钥",
  },
  [ErrorType.ANTHROPIC_INSUFFICIENT_BALANCE]: {
    label: "额度不足",
    actionUrl: "/settings",
    actionLabel: "更新设置",
  },
};

export async function addUserErrorMessageWithNotification({
  userId,
  userEmail,
  emailAccountId,
  errorType,
  errorMessage,
  storageKey = errorType,
  actionUrl,
  actionLabel,
  logger,
}: {
  userId: string;
  userEmail: string;
  emailAccountId: string;
  errorType: PersistedErrorType;
  errorMessage: string;
  storageKey?: string;
  actionUrl?: string;
  actionLabel?: string;
  logger: Logger;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { errorMessages: true },
    });

    if (!user) {
      logger.warn("未找到用户");
      return;
    }

    const currentErrorMessages = (user.errorMessages as ErrorMessages) || {};
    const existingEntry = currentErrorMessages[storageKey];
    const shouldSendEmail = !existingEntry?.emailSentAt;
    const config = errorTypeConfig[errorType];
    const isAccountRecoveryError =
      errorType === ErrorType.ACCOUNT_DISCONNECTED ||
      errorType === ErrorType.EMAIL_WATCH_LAPSED;
    const defaultAction = isAccountRecoveryError
      ? getAccountRecoveryAction(emailAccountId)
      : config;
    const resolvedActionUrl = actionUrl ?? defaultAction.actionUrl;
    const resolvedActionLabel = actionLabel ?? defaultAction.actionLabel;

    // 自上次写入以来没有变化 - 跳过。
    if (
      !shouldSendEmail &&
      existingEntry?.message === errorMessage &&
      existingEntry.actionUrl === resolvedActionUrl &&
      existingEntry.actionLabel === resolvedActionLabel
    ) {
      return;
    }

    const newEntry: ErrorMessageEntry = {
      message: errorMessage,
      timestamp: new Date().toISOString(),
      emailSentAt: existingEntry?.emailSentAt,
      actionUrl: resolvedActionUrl,
      actionLabel: resolvedActionLabel,
    };

    if (shouldSendEmail) {
      try {
        const unsubscribeToken = await createUnsubscribeToken({
          emailAccountId,
        });

        await sendActionRequiredEmail({
          from: env.RESEND_FROM_EMAIL,
          to: userEmail,
          emailProps: {
            baseUrl: env.NEXT_PUBLIC_BASE_URL,
            email: userEmail,
            unsubscribeToken,
            errorType: config.label,
            errorMessage,
            actionUrl: resolvedActionUrl,
            actionLabel: resolvedActionLabel,
          },
        });

        newEntry.emailSentAt = new Date().toISOString();
        logger.info("已发送需要操作的邮件", { errorType });
      } catch (emailError) {
        logger.error("发送需要操作的邮件失败", {
          error: emailError,
        });
        // 即使邮件发送失败也继续保存错误消息
      }
    }

    const newErrorMessages = {
      ...currentErrorMessages,
      [storageKey]: newEntry,
    };

    await prisma.user.update({
      where: { id: userId },
      data: { errorMessages: newErrorMessages },
    });
  } catch (error) {
    logger.error("addUserErrorMessageWithNotification 出错", { error });
    captureException(error, { extra: { userId, errorType } });
  }
}

async function addLegacyAccountRecoveryAction(
  userId: string,
  errorMessages: ErrorMessages | null,
): Promise<ErrorMessages | null> {
  const accountError = errorMessages?.[ErrorType.ACCOUNT_DISCONNECTED];
  if (!accountError || accountError.actionUrl) return errorMessages;

  const disconnectedAccounts = await prisma.emailAccount.findMany({
    where: {
      userId,
      account: { disconnectedAt: { not: null } },
    },
    select: { id: true, email: true },
  });

  const matchingDisconnectedAccounts = disconnectedAccounts.filter(
    ({ email }) => accountError.message.includes(email),
  );
  const action =
    matchingDisconnectedAccounts.length === 1
      ? getAccountRecoveryAction(matchingDisconnectedAccounts[0].id)
      : { actionUrl: "/accounts", actionLabel: "管理账号" };
  const updatedErrorMessages = {
    ...errorMessages,
    [ErrorType.ACCOUNT_DISCONNECTED]: {
      ...accountError,
      ...action,
    },
  };

  const updateResult = await prisma.user.updateMany({
    where: {
      id: userId,
      errorMessages: { equals: errorMessages as Prisma.InputJsonValue },
    },
    data: { errorMessages: updatedErrorMessages },
  });

  if (updateResult.count === 0) {
    const latestUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { errorMessages: true },
    });

    return (latestUser?.errorMessages as ErrorMessages) || null;
  }

  return updatedErrorMessages;
}
