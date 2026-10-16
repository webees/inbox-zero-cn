import { ZodError } from "zod";
import { type NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { captureException, checkCommonErrors, SafeError } from "@/utils/error";
import {
  isPublicApiPath,
  publicApiErrorFromUnknown,
  publicApiErrorResponse,
} from "@/utils/public-api-error";
import { env } from "@/env";
import { logErrorToPosthog } from "@/utils/error.server";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { flushLoggerSafely } from "@/utils/logger-flush";
import { auth } from "@/utils/auth";
import { getEmailAccount } from "@/utils/redis/account-validation";
import { getCallerEmailAccount } from "@/utils/organizations/access";
import { recordRateLimitFromApiError } from "@/utils/email/rate-limit";
import { isProviderRateLimitModeError } from "@/utils/email/rate-limit-mode-error";
import {
  EMAIL_ACCOUNT_HEADER,
  EMAIL_ACCOUNT_ID_REQUIRED_ERROR,
  MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
  NO_REFRESH_TOKEN_ERROR_CODE,
} from "@/utils/config";
import { isAdmin } from "@/utils/admin";
import prisma from "@/utils/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import type { EmailProvider } from "@/utils/email/types";
import { startRequestTimer } from "@/utils/request-timing";
import {
  type AuditActorType,
  runWithAuditContext,
  setAuditContext,
} from "@/utils/audit/context";

const logger = createScopedLogger("middleware");
const SLOW_MIDDLEWARE_STEP_MS = 2000;
const SLOW_MIDDLEWARE_TOTAL_MS = 4000;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NextHandler<T extends NextRequest = NextRequest> = (
  req: T,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface RequestWithLogger extends NextRequest {
  logger: Logger;
}

// 带已验证账号信息的扩展请求类型
export interface RequestWithAuth extends RequestWithLogger {
  auth: { userId: string; emailOtp?: boolean };
}

export interface RequestWithEmailAccount extends RequestWithLogger {
  auth: {
    userId: string;
    emailAccountId: string;
    email: string;
  };
}
export interface RequestWithEmailProvider extends RequestWithEmailAccount {
  emailProvider: EmailProvider;
}

export interface MiddlewareOptions {
  allowOrgAdmins?: boolean;
  requestTiming?: {
    runningWarnAfterMs?: number;
    slowWarnAfterMs?: number;
  };
}

// 处理通用错误逻辑的高阶中间件工厂
function withMiddleware<T extends NextRequest>(
  handler: NextHandler<T>,
  middleware?: (
    req: NextRequest,
    options?: MiddlewareOptions,
  ) => Promise<T | Response>,
  options?: MiddlewareOptions,
  scope?: string,
): NextHandler {
  return async (req, context) => {
    const requestId = getRequestId(req.headers.get("x-request-id"));
    const baseLogger = createScopedLogger(scope || "api").with({
      requestId,
      url: getRequestPath(req),
    });
    const requestTimer =
      options?.requestTiming !== undefined
        ? startRequestTimer({
            logger: baseLogger,
            requestName: `${scope || "api"} 请求`,
            runningWarnAfterMs: options.requestTiming.runningWarnAfterMs,
            slowWarnAfterMs: options.requestTiming.slowWarnAfterMs,
          })
        : undefined;

    const reqWithLogger = req as NextRequest & { logger?: Logger };
    reqWithLogger.logger = baseLogger;
    let requestForError = reqWithLogger as NextRequest;

    return runWithAuditContext(
      {
        actorType: getDefaultAuditActorType(scope),
        requestId,
        source: scope || new URL(req.url).pathname,
      },
      async () => {
        try {
          // 如果提供了中间件则应用
          let enhancedReq = reqWithLogger;
          if (middleware) {
            const middlewareResult = await middleware(reqWithLogger, options);

            // 如果中间件返回了 Response，则直接返回
            if (middlewareResult instanceof Response) {
              flushLogger(reqWithLogger);
              return middlewareResult;
            }

            // 否则继续使用增强后的请求
            enhancedReq = middlewareResult;
          }
          requestForError = enhancedReq;

          // 使用（可能已增强的）请求执行处理函数
          const response = await handler(enhancedReq as T, context);

          flushLogger(enhancedReq);

          return response;
        } catch (error) {
          flushLogger(requestForError);

          // 重定向通过抛出错误来实现。允许这些错误
          if (error instanceof Error && error.message === "NEXT_REDIRECT") {
            throw error;
          }

          const requestPath = getRequestPath(requestForError);
          const publicApiRequest = isPublicApiPath(
            new URL(requestForError.url).pathname,
          );

          if (error instanceof SafeError) {
            if (error.message === "No refresh token") {
              if (publicApiRequest) {
                return publicApiErrorResponse({
                  status: 401,
                  code: "UNAUTHORIZED",
                  message: "需要授权。请授予权限。",
                });
              }

              return NextResponse.json(
                {
                  error: "需要授权。请授予权限。",
                  errorCode: NO_REFRESH_TOKEN_ERROR_CODE,
                  isKnownError: true,
                },
                { status: 401 },
              );
            }

            if (error.message.includes("Microsoft authorization has expired")) {
              if (publicApiRequest) {
                return publicApiErrorResponse({
                  status: 401,
                  code: "UNAUTHORIZED",
                  message:
                    error.safeMessage ||
                    "Microsoft authorization has expired. Please reconnect.",
                });
              }

              return NextResponse.json(
                {
                  error: error.safeMessage,
                  errorCode: MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
                  isKnownError: true,
                },
                { status: 401 },
              );
            }
          }

          const reqLogger = getLogger(requestForError);

          if (error instanceof ZodError) {
            if (!env.DISABLE_LOG_ZOD_ERRORS) {
              reqLogger.error("Zod 校验错误", { error });
            }
            if (publicApiRequest) {
              return publicApiErrorFromUnknown(error);
            }
            return NextResponse.json(
              { error: { issues: error.issues }, isKnownError: true },
              { status: 400 },
            );
          }

          const apiError = checkCommonErrors(error, requestPath, reqLogger);
          if (apiError) {
            await recordRateLimitFromApiError({
              apiErrorType: apiError.type,
              error,
              emailAccountId: getEmailAccountId(requestForError),
              logger: reqLogger,
              source: scope || new URL(requestForError.url).pathname,
            });

            await logErrorToPosthog(
              "api",
              requestPath,
              apiError.type,
              "unknown",
              reqLogger,
            ); // TODO: 添加 emailAccountId

            if (publicApiRequest) {
              return publicApiErrorResponse({
                status: apiError.code,
                message: apiError.message || "请求失败",
              });
            }

            return NextResponse.json(
              { error: apiError.message, isKnownError: true },
              { status: apiError.code },
            );
          }

          if (isErrorWithConfigAndHeaders(error)) {
            error.config.headers = undefined;
          }

          if (error instanceof SafeError) {
            if (publicApiRequest) {
              return publicApiErrorFromUnknown(error);
            }

            return NextResponse.json(
              { error: error.safeMessage, isKnownError: true },
              { status: getSafeErrorStatusCode(error.statusCode) },
            );
          }

          // 临时方案：在开发环境中记录完整错误。TODO: 妥善处理
          if (env.NODE_ENV === "development") {
            // biome-ignore lint/suspicious/noConsole: helpful for debugging
            console.error(error);
          }

          reqLogger.error("未处理的错误", {
            error: error instanceof Error ? error.message : error,
            cause:
              error instanceof Error && error.cause
                ? error.cause instanceof Error
                  ? error.cause.message
                  : error.cause
                : undefined,
            stack: error instanceof Error ? error.stack : undefined,
          });
          captureException(error, {
            extra: { url: requestPath },
          });

          if (publicApiRequest) {
            return publicApiErrorResponse({
              status: 500,
              code: "INTERNAL_ERROR",
              message: "发生了意外错误",
            });
          }

          return NextResponse.json(
            { error: "发生了意外错误" },
            { status: 500 },
          );
        } finally {
          requestTimer?.logSlowCompletion();
          requestTimer?.stop();
        }
      },
    );
  };
}

async function authMiddleware(
  req: NextRequest,
): Promise<RequestWithAuth | Response> {
  const baseLogger = getLogger(req);
  const authLogContext = {
    path: new URL(req.url).pathname,
    method: req.method,
    hasCookie: req.headers.has("cookie"),
    cookieNames: parseCookieNames(req.headers.get("cookie")),
    hasAuthorization: req.headers.has("authorization"),
    expoOrigin: req.headers.get("expo-origin") ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  };

  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth(req.headers);
  } catch (error) {
    baseLogger.warn("认证中间件失败", {
      ...authLogContext,
      authError:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : error,
    });
    throw error;
  }

  if (!session?.user) {
    baseLogger.warn("认证中间件返回 401", {
      ...authLogContext,
      reason:
        session === null || session === undefined
          ? "no_session"
          : "session_without_user",
    });

    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 401 },
    );
  }

  const authReq = req as RequestWithAuth;
  authReq.auth = {
    userId: session.user.id,
    ...(session.session?.emailOtp ? { emailOtp: true } : {}),
  };

  authReq.logger = baseLogger.with({ userId: session.user.id });
  setAuditContext({ actorType: "user", userId: session.user.id });

  return authReq;
}

function parseCookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

async function emailAccountMiddleware(
  req: NextRequest,
  options?: MiddlewareOptions,
): Promise<RequestWithEmailAccount | Response> {
  const authReq = await authMiddleware(req);
  if (authReq instanceof Response) return authReq;

  const userId = authReq.auth.userId;

  const emailAccountId = req.headers.get(EMAIL_ACCOUNT_HEADER);

  if (!emailAccountId) {
    return NextResponse.json(
      { error: EMAIL_ACCOUNT_ID_REQUIRED_ERROR, isKnownError: true },
      { status: 403 },
    );
  }

  const middlewareLogger = authReq.logger.with({ emailAccountId });
  const middlewareStartTime = Date.now();

  try {
    // 如果提供了账号 ID，则校验并获取邮箱账号 ID
    const email = await runTimedMiddlewareStep({
      logger: middlewareLogger,
      step: "validate-email-account",
      operation: () => getEmailAccount({ userId, emailAccountId }),
    });

    const emailAccountLogger = middlewareLogger.with({ email });

    if (!email && options?.allowOrgAdmins) {
      // 检查用户是否为管理员或所有者，并与目标邮箱账号属于同一组织
      const callerEmailAccount = await runTimedMiddlewareStep({
        logger: emailAccountLogger,
        step: "resolve-org-admin-caller-account",
        operation: () => getCallerEmailAccount(userId, emailAccountId),
      });

      if (!callerEmailAccount) {
        emailAccountLogger.error("组织管理员访问被拒绝");
        return NextResponse.json(
          { error: "权限不足", isKnownError: true },
          { status: 403 },
        );
      }

      // 检查目标成员是否已同意组织管理员的分析访问
      const targetMember = await runTimedMiddlewareStep({
        logger: emailAccountLogger,
        step: "check-org-admin-consent",
        operation: () =>
          prisma.member.findFirst({
            where: {
              emailAccountId,
              organization: {
                members: {
                  some: {
                    emailAccountId: callerEmailAccount.id,
                  },
                },
              },
            },
            select: { allowOrgAdminAnalytics: true },
          }),
      });

      if (!targetMember?.allowOrgAdminAnalytics) {
        emailAccountLogger.error("成员尚未启用组织管理员分析访问");
        return NextResponse.json(
          {
            error: "该成员不允许分析访问",
            isKnownError: true,
          },
          { status: 403 },
        );
      }

      const targetEmailAccount = await runTimedMiddlewareStep({
        logger: emailAccountLogger,
        step: "resolve-org-admin-target-account",
        operation: () =>
          prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            select: { email: true },
          }),
      });

      if (targetEmailAccount) {
        setAuditContext({
          actorType: "admin",
          emailAccountId,
          userId,
        });

        const emailAccountReq = authReq as RequestWithEmailAccount;
        emailAccountReq.auth = {
          userId,
          emailAccountId,
          email: targetEmailAccount.email,
        };
        emailAccountReq.logger = emailAccountLogger.with({
          isOrgAdmin: true,
          email: targetEmailAccount.email,
        });
        return emailAccountReq;
      }
    }

    if (!email) {
      emailAccountLogger.error("无效的邮箱账号 ID");
      return NextResponse.json(
        { error: "无效的账号 ID", isKnownError: true },
        { status: 403 },
      );
    }

    Sentry.setTag("emailAccountId", emailAccountId);
    Sentry.setUser({ id: userId, email });
    setAuditContext({
      actorType: "email_account",
      emailAccountId,
      userId,
    });

    const emailAccountReq = authReq as RequestWithEmailAccount;
    emailAccountReq.auth = { userId, emailAccountId, email };
    emailAccountReq.logger = emailAccountLogger;

    return emailAccountReq;
  } finally {
    logSlowMiddlewareTotal({
      logger: middlewareLogger,
      middleware: "email-account",
      startedAt: middlewareStartTime,
    });
  }
}

async function emailProviderMiddleware(
  req: NextRequest,
): Promise<RequestWithEmailProvider | Response> {
  // 先运行邮箱账号中间件
  const emailAccountReq = await emailAccountMiddleware(req);
  if (emailAccountReq instanceof Response) return emailAccountReq;

  const { userId, emailAccountId } = emailAccountReq.auth;
  const middlewareStartTime = Date.now();

  try {
    const emailAccount = await runTimedMiddlewareStep({
      logger: emailAccountReq.logger,
      step: "load-email-account-provider",
      operation: () =>
        prisma.emailAccount.findUnique({
          where: {
            id: emailAccountId,
            userId, // 确保它属于该用户
          },
          include: {
            account: {
              select: {
                provider: true,
              },
            },
          },
        }),
    });

    if (!emailAccount) {
      return NextResponse.json(
        { error: "未找到邮箱账号", isKnownError: true },
        { status: 404 },
      );
    }

    const provider = await runTimedMiddlewareStep({
      logger: emailAccountReq.logger,
      step: "create-email-provider",
      operation: () =>
        createEmailProvider({
          emailAccountId: emailAccount.id,
          provider: emailAccount.account.provider,
          logger: emailAccountReq.logger,
        }),
    });

    const providerReq = emailAccountReq as RequestWithEmailProvider;
    providerReq.auth = emailAccountReq.auth;
    providerReq.emailProvider = provider;
    providerReq.logger = emailAccountReq.logger;

    return providerReq;
  } catch (error) {
    emailAccountReq.logger.error("创建邮件服务商失败", {
      error,
      emailAccountId,
      userId,
    });

    // 重新抛出已知错误，以便 withMiddleware 应用共享的错误处理。
    if (error instanceof SafeError || isProviderRateLimitModeError(error)) {
      throw error;
    }

    return NextResponse.json(
      { error: "初始化邮件服务商失败" },
      { status: 500 },
    );
  } finally {
    logSlowMiddlewareTotal({
      logger: emailAccountReq.logger,
      middleware: "email-provider",
      startedAt: middlewareStartTime,
    });
  }
}

async function adminMiddleware(
  req: NextRequest,
): Promise<RequestWithAuth | Response> {
  const authReq = await authMiddleware(req);
  if (authReq instanceof Response) return authReq;

  const user = await prisma.user.findUnique({
    where: { id: authReq.auth.userId },
    select: { email: true },
  });

  if (!isAdmin({ email: user?.email })) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 403 },
    );
  }

  setAuditContext({ actorType: "admin", userId: authReq.auth.userId });

  return authReq;
}

// 基于通用基础设施构建的公开中间件

// withError 重载
export function withError(
  scope: string,
  handler: NextHandler<RequestWithLogger>,
  options?: MiddlewareOptions,
): NextHandler;
export function withError(
  handler: NextHandler<RequestWithLogger>,
  options?: MiddlewareOptions,
): NextHandler;
export function withError(
  scopeOrHandler: string | NextHandler | NextHandler<RequestWithLogger>,
  handlerOrOptions?: NextHandler<RequestWithLogger> | MiddlewareOptions,
  options?: MiddlewareOptions,
): NextHandler {
  if (typeof scopeOrHandler === "string") {
    return withMiddleware(
      handlerOrOptions as NextHandler<RequestWithLogger>,
      undefined,
      options,
      scopeOrHandler,
    );
  }
  return withMiddleware(
    scopeOrHandler as NextHandler,
    undefined,
    handlerOrOptions as MiddlewareOptions,
  );
}

// withAuth 重载
export function withAuth(
  scope: string,
  handler: NextHandler<RequestWithAuth>,
): NextHandler;
export function withAuth(handler: NextHandler<RequestWithAuth>): NextHandler;
export function withAuth(
  scopeOrHandler: string | NextHandler<RequestWithAuth>,
  handler?: NextHandler<RequestWithAuth>,
): NextHandler {
  if (typeof scopeOrHandler === "string") {
    return withMiddleware(handler!, authMiddleware, undefined, scopeOrHandler);
  }
  return withMiddleware(scopeOrHandler, authMiddleware);
}

export function withAdmin(
  scope: string,
  handler: NextHandler<RequestWithAuth>,
): NextHandler {
  return withMiddleware(handler, adminMiddleware, undefined, scope);
}

// withEmailAccount 重载
export function withEmailAccount(
  scope: string,
  handler: NextHandler<RequestWithEmailAccount>,
  options?: MiddlewareOptions,
): NextHandler;
export function withEmailAccount(
  handler: NextHandler<RequestWithEmailAccount>,
  options?: MiddlewareOptions,
): NextHandler;
export function withEmailAccount(
  scopeOrHandler: string | NextHandler<RequestWithEmailAccount>,
  handlerOrOptions?: NextHandler<RequestWithEmailAccount> | MiddlewareOptions,
  options?: MiddlewareOptions,
): NextHandler {
  if (typeof scopeOrHandler === "string") {
    return withMiddleware(
      handlerOrOptions as NextHandler<RequestWithEmailAccount>,
      emailAccountMiddleware,
      options,
      scopeOrHandler,
    );
  }
  return withMiddleware(
    scopeOrHandler,
    emailAccountMiddleware,
    handlerOrOptions as MiddlewareOptions,
  );
}

// withEmailProvider 重载
export function withEmailProvider(
  scope: string,
  handler: NextHandler<RequestWithEmailProvider>,
  options?: MiddlewareOptions,
): NextHandler;
export function withEmailProvider(
  handler: NextHandler<RequestWithEmailProvider>,
  options?: MiddlewareOptions,
): NextHandler;
export function withEmailProvider(
  scopeOrHandler: string | NextHandler<RequestWithEmailProvider>,
  handlerOrOptions?: NextHandler<RequestWithEmailProvider> | MiddlewareOptions,
  options?: MiddlewareOptions,
): NextHandler {
  if (typeof scopeOrHandler === "string") {
    return withMiddleware(
      handlerOrOptions as NextHandler<RequestWithEmailProvider>,
      emailProviderMiddleware,
      options,
      scopeOrHandler,
    );
  }
  return withMiddleware(
    scopeOrHandler,
    emailProviderMiddleware,
    handlerOrOptions as MiddlewareOptions,
  );
}

function isErrorWithConfigAndHeaders(
  error: unknown,
): error is { config: { headers: unknown } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "config" in error &&
    "headers" in (error as { config: Record<string, unknown> }).config
  );
}

function getLogger(req: NextRequest): Logger {
  const reqWithLogger = req as RequestWithLogger;
  return reqWithLogger.logger || logger;
}

function getEmailAccountId(req: NextRequest): string | undefined {
  const authReq = req as Partial<RequestWithEmailAccount>;
  return authReq.auth?.emailAccountId;
}

function getDefaultAuditActorType(scope?: string): AuditActorType {
  return scope?.startsWith("cron/") ? "system" : "anonymous";
}

function getRequestId(rawRequestId: string | null) {
  if (rawRequestId && UUID_V4_REGEX.test(rawRequestId)) return rawRequestId;
  return randomUUID();
}

function getRequestPath(req: NextRequest) {
  return req.nextUrl.pathname;
}

function flushLogger(req: NextRequest) {
  const reqWithLogger = req as RequestWithLogger;
  if (reqWithLogger.logger) {
    const loggerToFlush = reqWithLogger.logger;
    after(async () => {
      await flushLoggerSafely(loggerToFlush, { url: getRequestPath(req) });
    });
  }
}

async function runTimedMiddlewareStep<T>({
  logger,
  step,
  operation,
}: {
  logger: Logger;
  step: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  const slowStepLogTimeout = setTimeout(() => {
    logger.warn("中间件步骤仍在运行", {
      step,
      elapsedMs: Date.now() - startedAt,
    });
  }, SLOW_MIDDLEWARE_STEP_MS);

  try {
    return await operation();
  } finally {
    clearTimeout(slowStepLogTimeout);
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_MIDDLEWARE_STEP_MS) {
      logger.warn("中间件步骤完成较慢", {
        step,
        durationMs,
      });
    }
  }
}

function logSlowMiddlewareTotal({
  logger,
  middleware,
  startedAt,
}: {
  logger: Logger;
  middleware: string;
  startedAt: number;
}) {
  const durationMs = Date.now() - startedAt;
  if (durationMs > SLOW_MIDDLEWARE_TOTAL_MS) {
    logger.warn("中间件完成较慢", {
      middleware,
      durationMs,
    });
  }
}

function getSafeErrorStatusCode(statusCode?: number) {
  return typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : 400;
}
