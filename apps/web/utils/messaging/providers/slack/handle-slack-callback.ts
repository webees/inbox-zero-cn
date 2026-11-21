import { z } from "zod";
import { type NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import {
  RedirectError,
  redirectWithMessage,
  redirectWithError,
} from "@/utils/oauth/redirect";
import { SLACK_STATE_COOKIE_NAME } from "./constants";
import prisma from "@/utils/prisma";
import {
  parseSignedOAuthState,
  validateSignedOAuthState,
} from "@/utils/oauth/state";
import { prefixPath } from "@/utils/path";
import { MessagingProvider } from "@/generated/prisma/enums";
import {
  acquireOAuthCodeLock,
  clearOAuthCode,
  getOAuthCodeResult,
  setOAuthCodeResult,
} from "@/utils/redis/oauth-code";
import { syncSlackInstallation } from "@/utils/messaging/chat-sdk/bot";
import { sendSlackOnboardingDirectMessageWithLogging } from "@/utils/messaging/providers/slack/send-onboarding-direct-message";

const slackOAuthStateSchema = z.object({
  emailAccountId: z.string().min(1).max(64),
  type: z.literal("slack"),
  nonce: z.string().min(8).max(128),
});

const slackOAuthResponseSchema = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  bot_user_id: z.string().min(1),
  team: z.object({
    id: z.string().min(1),
    name: z.string(),
  }),
  authed_user: z.object({
    id: z.string().min(1),
  }),
});

type SlackOAuthResponse = z.infer<typeof slackOAuthResponseSchema>;
type SlackOAuthState = z.infer<typeof slackOAuthStateSchema>;

export async function handleSlackCallback(
  request: NextRequest,
  logger: Logger,
): Promise<NextResponse> {
  let redirectHeaders = new Headers();
  let codeForCleanup: string | null = null;
  let callbackLogger = logger;

  try {
    const { code, response, slackState } = validateOAuthCallback(
      request,
      logger,
    );
    codeForCleanup = code;
    redirectHeaders = response.headers;

    const { emailAccountId } = slackState;
    callbackLogger = logger.with({ emailAccountId });

    const finalRedirectUrl = buildChannelsRedirectUrl(emailAccountId);
    finalRedirectUrl.searchParams.set("slack_email_account_id", emailAccountId);
    const cachedResult = await getOAuthCodeResult(code);
    if (cachedResult) {
      callbackLogger.info("Slack OAuth 授权码已处理，返回缓存结果");
      applyRedirectParams(finalRedirectUrl, cachedResult.params);
      await flushLogger(callbackLogger);
      return NextResponse.redirect(finalRedirectUrl, {
        headers: redirectHeaders,
      });
    }

    const acquiredLock = await acquireOAuthCodeLock(code);
    if (!acquiredLock) {
      callbackLogger.warn("Slack OAuth 授权码正在被另一个请求处理");
      const inFlightResult = await getOAuthCodeResult(code);
      if (inFlightResult) {
        applyRedirectParams(finalRedirectUrl, inFlightResult.params);
      } else {
        applyRedirectParams(finalRedirectUrl, { message: "processing" });
      }
      await flushLogger(callbackLogger);
      return NextResponse.redirect(finalRedirectUrl, {
        headers: redirectHeaders,
      });
    }

    const tokens = await exchangeCodeForTokens(code, logger);

    await upsertMessagingChannel({
      teamId: tokens.team.id,
      teamName: tokens.team.name,
      accessToken: tokens.access_token,
      providerUserId: tokens.authed_user.id,
      botUserId: tokens.bot_user_id,
      emailAccountId,
    });

    await prisma.messagingChannel.updateMany({
      where: {
        provider: MessagingProvider.SLACK,
        teamId: tokens.team.id,
        isConnected: true,
      },
      data: {
        accessToken: tokens.access_token,
        botUserId: tokens.bot_user_id,
        teamName: tokens.team.name,
      },
    });

    await syncSlackInstallation({
      teamId: tokens.team.id,
      teamName: tokens.team.name,
      accessToken: tokens.access_token,
      botUserId: tokens.bot_user_id,
      logger: callbackLogger,
    });

    await sendSlackOnboardingDirectMessageWithLogging({
      accessToken: tokens.access_token,
      userId: tokens.authed_user.id,
      botUserId: tokens.bot_user_id,
      teamId: tokens.team.id,
      logger: callbackLogger,
    });

    callbackLogger.info("Slack 连接成功", {
      teamId: tokens.team.id,
      teamName: tokens.team.name,
    });
    await setOAuthCodeResult(code, { message: "slack_connected" });
    await flushLogger(callbackLogger);

    return redirectWithMessage(
      finalRedirectUrl,
      "slack_connected",
      redirectHeaders,
    );
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);

    if (error instanceof RedirectError) {
      const reason = getRedirectReason(error.redirectUrl);
      logger.error("Slack 回调重定向错误", {
        reason,
        hasCode: request.nextUrl.searchParams.has("code"),
        hasState: request.nextUrl.searchParams.has("state"),
        hasStoredState: !!request.cookies.get(SLACK_STATE_COOKIE_NAME)?.value,
      });
      error.redirectUrl.searchParams.set("error_reason", reason);
      error.redirectUrl.searchParams.set("error_detail", errorDetail);
      await flushLogger(logger);
      return redirectWithError(
        error.redirectUrl,
        "connection_failed",
        error.responseHeaders,
      );
    }

    const reason = mapSlackCallbackErrorReason(error);
    callbackLogger.error("Slack 回调出错", { error, reason });
    if (codeForCleanup) {
      await clearOAuthCode(codeForCleanup);
    }

    // 尽力而为：尝试从 state 参数中提取 emailAccountId，以便进行正确的
    // 按账号限定的重定向。若失败，则回退到不带前缀的 /channels。
    // 交由（重定向）页面处理。
    let errorPath = "/channels";
    try {
      const state = request.nextUrl.searchParams.get("state");
      if (state) {
        const parsed = extractEmailAccountIdFromState(state);
        if (parsed) errorPath = prefixPath(parsed, "/channels");
      }
    } catch {
      // 忽略——使用回退路径
    }

    const errorRedirectUrl = new URL(errorPath, env.NEXT_PUBLIC_BASE_URL);
    errorRedirectUrl.searchParams.set("error", "connection_failed");
    errorRedirectUrl.searchParams.set("error_reason", reason);
    errorRedirectUrl.searchParams.set("error_detail", errorDetail);
    await flushLogger(callbackLogger);
    return NextResponse.redirect(errorRedirectUrl, {
      headers: redirectHeaders,
    });
  }
}

function validateOAuthCallback(
  request: NextRequest,
  logger: Logger,
): {
  code: string;
  response: NextResponse;
  slackState: SlackOAuthState;
} {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const storedState = request.cookies.get(SLACK_STATE_COOKIE_NAME)?.value;

  const redirectUrl = new URL("/channels", env.NEXT_PUBLIC_BASE_URL);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.delete(SLACK_STATE_COOKIE_NAME);

  if (oauthError) {
    logger.warn("Slack 回调返回 OAuth 错误", { oauthError });
    redirectUrl.searchParams.set(
      "error",
      `oauth_${sanitizeReason(oauthError)}`,
    );
    throw new RedirectError(redirectUrl, response.headers);
  }

  if (!code || code.length < 10) {
    logger.warn("Slack 回调中的 code 缺失或无效");
    redirectUrl.searchParams.set("error", "missing_code");
    throw new RedirectError(redirectUrl, response.headers);
  }

  if (!receivedState) {
    logger.warn("Slack 回调中缺少 state");
    redirectUrl.searchParams.set("error", "missing_state");
    throw new RedirectError(redirectUrl, response.headers);
  }

  const stateValidation = validateSignedOAuthState<{
    emailAccountId: string;
    type: "slack";
  }>({
    receivedState,
    storedState,
  });
  if (!stateValidation.success) {
    logger.warn("Slack 回调期间 state 无效", {
      receivedStateFingerprint: getOAuthStateFingerprint(receivedState),
      hasStoredState: !!storedState,
      error: stateValidation.error,
    });
    redirectUrl.searchParams.set("error", stateValidation.error);
    throw new RedirectError(redirectUrl, response.headers);
  }

  const slackState = parseAndValidateSlackState(
    stateValidation.state,
    logger,
    redirectUrl,
    response.headers,
  );

  return {
    code,
    response,
    slackState,
  };
}

function parseAndValidateSlackState(
  rawState: unknown,
  logger: Logger,
  redirectUrl: URL,
  responseHeaders: Headers,
) {
  const validationResult = slackOAuthStateSchema.safeParse(rawState);
  if (!validationResult.success) {
    logger.error("state 校验失败", {
      errors: validationResult.error.issues,
    });
    redirectUrl.searchParams.set("error", "invalid_state_format");
    throw new RedirectError(redirectUrl, responseHeaders);
  }

  return validationResult.data;
}

function extractEmailAccountIdFromState(state: string): string | null {
  try {
    const parsed = parseSignedOAuthState<{ emailAccountId?: string }>(state);
    return parsed.emailAccountId ?? null;
  } catch {
    return null;
  }
}

function getOAuthStateFingerprint(state: string) {
  return `sha256:${createHash("sha256").update(state).digest("hex").slice(0, 12)}`;
}

function buildChannelsRedirectUrl(emailAccountId: string): URL {
  const url = new URL(
    prefixPath(emailAccountId, "/channels"),
    env.NEXT_PUBLIC_BASE_URL,
  );
  return url;
}

async function exchangeCodeForTokens(
  code: string,
  logger: Logger,
): Promise<SlackOAuthResponse> {
  const redirectUri = `${env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL}/api/slack/callback`;

  logger.info("正在用 Slack code 换取令牌", {
    redirectUri,
    clientId: env.SLACK_CLIENT_ID,
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    webhookUrl: env.WEBHOOK_URL ?? null,
    codeLength: code.length,
  });

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const raw = await response.json();

  if (!raw.ok) {
    logger.error("Slack 令牌交换失败", {
      slackError: raw.error,
      redirectUri,
      clientId: env.SLACK_CLIENT_ID,
    });
    // 前缀是抛出方与 mapSlackCallbackErrorReason 之间的机器可读约定，必须保持英文
    throw new Error(`Slack OAuth 错误：${raw.error}`);
  }

  const result = slackOAuthResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid Slack OAuth response: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  return result.data;
}

async function upsertMessagingChannel(params: {
  teamId: string;
  teamName: string;
  accessToken: string;
  providerUserId: string;
  botUserId: string;
  emailAccountId: string;
}) {
  return prisma.messagingChannel.upsert({
    where: {
      emailAccountId_provider_teamId: {
        emailAccountId: params.emailAccountId,
        provider: MessagingProvider.SLACK,
        teamId: params.teamId,
      },
    },
    update: {
      teamName: params.teamName,
      accessToken: params.accessToken,
      providerUserId: params.providerUserId,
      botUserId: params.botUserId,
      isConnected: true,
    },
    create: {
      provider: MessagingProvider.SLACK,
      teamId: params.teamId,
      teamName: params.teamName,
      accessToken: params.accessToken,
      providerUserId: params.providerUserId,
      botUserId: params.botUserId,
      emailAccountId: params.emailAccountId,
      isConnected: true,
    },
  });
}

function getRedirectReason(redirectUrl: URL): string {
  const reason = redirectUrl.searchParams.get("error");
  if (!reason) return "redirect_error";

  return sanitizeReason(reason);
}

function mapSlackCallbackErrorReason(error: unknown): string {
  if (!(error instanceof Error)) return "unexpected_error";

  const oauthErrorPrefix = "Slack OAuth 错误：";
  if (error.message.startsWith(oauthErrorPrefix)) {
    const oauthError = error.message.slice(oauthErrorPrefix.length);
    if (!oauthError) return "oauth_error";

    return `oauth_${sanitizeReason(oauthError)}`;
  }

  return "unexpected_error";
}

function sanitizeReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 80);
}

function applyRedirectParams(url: URL, params: Record<string, string>) {
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
}

async function flushLogger(logger: Logger): Promise<void> {
  try {
    await logger.flush();
  } catch {
    // 忽略 OAuth 回调响应中的 flush 错误
  }
}
