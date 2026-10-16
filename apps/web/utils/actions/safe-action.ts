import { createSafeActionClient } from "next-safe-action";
import * as Sentry from "@sentry/nextjs";
import { withServerActionInstrumentation } from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { after } from "next/server";
import { auth } from "@/utils/auth";
import { createScopedLogger } from "@/utils/logger";
import { flushLoggerSafely } from "@/utils/logger-flush";
import prisma from "@/utils/prisma";
import { isAdmin } from "@/utils/admin";
import {
  captureException,
  EMAIL_PROVIDER_RATE_LIMIT_MESSAGE,
  SafeError,
  UNEXPECTED_ACTION_ERROR_MESSAGE,
} from "@/utils/error";
import { env } from "@/env";
import { runWithAuditContext, setAuditContext } from "@/utils/audit/context";
import { isEmailProviderRateLimitError } from "@/utils/email/is-provider-rate-limit-error";

const baseClient = createSafeActionClient({
  defineMetadataSchema() {
    return z.object({ name: z.string() });
  },
  defaultValidationErrorsShape: "flattened",
  handleServerError(error, { metadata, ctx, bindArgsClientInputs }) {
    const context = ctx as
      | {
          logger: ReturnType<typeof createScopedLogger>;
          requestId: string;
          userId?: string;
          userEmail?: string;
          emailAccountId?: string;
          provider?: string;
        }
      | undefined;

    const logger =
      context?.logger ??
      createScopedLogger(metadata?.name || "safe-action").with({
        requestId: context?.requestId,
        userId: context?.userId,
        userEmail: context?.userEmail,
        emailAccountId: context?.emailAccountId,
      });
    const isProviderRateLimit = isEmailProviderRateLimitError({
      error,
      provider: context?.provider,
    });

    // 预期面向用户的拒绝会展示给客户端，绝不会发送到 Sentry。
    if (error instanceof SafeError || isProviderRateLimit) {
      logger.warn("服务端操作错误：", {
        metadata,
        bindArgsClientInputs,
        error,
      });
    } else {
      logger.error("服务端操作错误：", {
        metadata,
        bindArgsClientInputs,
        error,
      });
    }
    after(async () => {
      await flushLoggerSafely(logger, {
        action: metadata?.name,
        flushReason: "server-action-error",
        requestId: context?.requestId,
      });
    });

    if (env.NODE_ENV !== "production") {
      // biome-ignore lint/suspicious/noConsole: helpful for debugging
      console.error("服务端操作出错", error);
    }
    if (isProviderRateLimit) return EMAIL_PROVIDER_RATE_LIMIT_MESSAGE;
    if (error instanceof SafeError) return error.message;

    captureException(error, {
      userId: context?.userId,
      userEmail: context?.userEmail,
      emailAccountId: context?.emailAccountId,
      extra: {
        metadata,
        bindArgsClientInputs,
        error: error.message,
      },
    });

    return UNEXPECTED_ACTION_ERROR_MESSAGE;
  },
}).use(async ({ next, metadata }) => {
  const requestId = randomUUID();
  const logger = createScopedLogger(metadata.name).with({ requestId });

  return runWithAuditContext(
    {
      actorType: "anonymous",
      requestId,
      source: metadata.name,
    },
    async () => {
      after(async () => {
        await flushLoggerSafely(logger, {
          action: metadata.name,
          requestId,
        });
      });

      const result = await next({ ctx: { logger, requestId } });

      if (result.validationErrors) {
        logger.warn("操作校验错误", {
          action: metadata.name,
          validationErrors: result.validationErrors,
        });
      }

      return result;
    },
  );
});

export const actionClient = baseClient
  .bindArgsSchemas<[emailAccountId: z.ZodString]>([z.string()])
  .use(async ({ next, metadata, bindArgsClientInputs, ctx }) => {
    const session = await auth();

    if (!session?.user) throw new SafeError("未授权");
    const userEmail = session.user.email;
    if (!userEmail) throw new SafeError("未授权");

    const userId = session.user.id;
    const emailAccountId = bindArgsClientInputs[0] as string;
    setAuditContext({ actorType: "user", userId });

    // 校验该用户拥有此邮箱
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: {
        email: true,
        account: {
          select: {
            userId: true,
            provider: true,
          },
        },
      },
    });
    if (!emailAccount || emailAccount?.account.userId !== userId) {
      // 客户端状态过期时会出现（例如账号被移除或切换）
      ctx.logger.warn("Unauthorized", metadata);
      throw new SafeError("未授权");
    }

    Sentry.setTag("emailAccountId", emailAccountId);
    Sentry.setUser({ id: userId, email: userEmail });
    setAuditContext({
      actorType: "email_account",
      emailAccountId,
      userId,
    });

    const logger = ctx.logger.with({
      userId,
      userEmail,
      emailAccountId,
      provider: emailAccount.account.provider,
    });

    return runInstrumentedAction({
      actionName: metadata.name,
      logger,
      run: () =>
        next({
          ctx: {
            ...ctx,
            logger,
            userId,
            userEmail,
            session,
            emailAccountId,
            emailAccount,
            provider: emailAccount.account.provider,
          },
        }),
    });
  });

// 不绑定到特定邮箱
export const actionClientUser = baseClient.use(
  async ({ next, metadata, ctx }) => {
    const session = await auth();

    if (!session?.user) {
      // 会话已过期或用户已登出时会出现
      ctx.logger.warn("Unauthorized", metadata);
      throw new SafeError("未授权");
    }

    const userId = session.user.id;
    const userEmail = session.user.email;
    setAuditContext({ actorType: "user", userId });

    const logger = ctx.logger.with({ userId, userEmail });

    return runInstrumentedAction({
      actionName: metadata.name,
      logger,
      run: () =>
        next({
          ctx: { ...ctx, userId, userEmail, logger, session },
        }),
    });
  },
);

export const adminActionClient = baseClient.use(
  async ({ next, metadata, ctx }) => {
    const session = await auth();
    if (!session?.user) throw new SafeError("未授权");
    if (!isAdmin({ email: session.user.email })) throw new SafeError("未授权");
    setAuditContext({ actorType: "admin", userId: session.user.id });

    const logger = ctx.logger.with({ admin: true });

    return runInstrumentedAction({
      actionName: metadata.name,
      logger,
      run: () => next({ ctx: { ...ctx, logger, session } }),
    });
  },
);

function runInstrumentedAction<T>({
  actionName,
  logger,
  run,
}: {
  actionName: string;
  logger: ReturnType<typeof createScopedLogger>;
  run: () => Promise<T>;
}) {
  logger.info("调用操作");
  return withServerActionInstrumentation(actionName, run);
}
