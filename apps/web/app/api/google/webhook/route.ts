import { after, NextResponse } from "next/server";
import { z } from "zod";
import { withError } from "@/utils/middleware";
import { env } from "@/env";
import { processHistoryForUser } from "@/utils/webhook/google/process-history";
import type { Logger } from "@/utils/logger";
import { handleWebhookError } from "@/utils/webhook/error-handler";
import { runWithBackgroundLoggerFlush } from "@/utils/logger-flush";
import {
  cleanupWebhookAccountOnRateLimitSkip,
  getWebhookEmailAccount,
} from "@/utils/webhook/validate-webhook-account";
import { getEmailProviderRateLimitState } from "@/utils/email/rate-limit";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { markGmailHistoryCatchUp } from "@/utils/redis/gmail-history-catch-up";

import { notifyMailboxChanged } from "@/utils/mailbox-push";

export const maxDuration = 300;

// 每当用户收到邮件时，Google PubSub 都会调用此端点。我们通过 `api/google/watch` 订阅更新
export const POST = withError("google/webhook", async (request) => {
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get("token");

  let logger = request.logger;

  const verificationToken = env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;

  if (verificationToken == null) {
    logger.error("Google webhook 校验令牌未配置");
    return NextResponse.json(
      { message: "Google webhook 未配置" },
      { status: 503 },
    );
  }

  // 空字符串会有意禁用查询参数校验，适用于请求已在上游通过身份验证的情况，
  // 例如经由 OIDC 网关。
  if (verificationToken !== "" && token !== verificationToken) {
    logger.error("校验令牌无效");
    return NextResponse.json({ message: "验证令牌无效" }, { status: 403 });
  }

  const body = await request.json();
  const decodedData = decodeHistoryId(body);

  // 格式错误的载荷无法处理；将其报告为客户端错误，
  // 而不是让 TypeError 以 500 的形式暴露。
  if (!decodedData) {
    logger.warn("Gmail Pub/Sub 通知载荷无效");
    return NextResponse.json(
      { message: "Pub/Sub 消息载荷无效" },
      { status: 400 },
    );
  }

  logger = logger.with({
    email: decodedData.emailAddress,
    historyId: decodedData.historyId,
    queueMessageId: body.message?.messageId,
    subscriptionId: body.subscription,
    sentAt: body.message?.publishTime,
  });

  logger.info("已收到 webhook，立即确认");

  const emailAccount = await getWebhookEmailAccount(
    { email: decodedData.emailAddress.toLowerCase() },
    logger,
  );

  logger = logger.with({ emailAccountId: emailAccount?.id });
  logger.info("Gmail webhook 邮箱账号查询完成", {
    emailAccountFound: !!emailAccount,
    lastSyncedHistoryId: emailAccount?.lastSyncedHistoryId,
  });

  if (emailAccount) {
    // 在历史记录处理前通知，使提前返回仍能送达客户端，
    // 且此响应无需等待 Apple。
    after(() =>
      notifyMailboxChanged({
        emailAccountId: emailAccount.id,
        logger,
      }),
    );
    const activeRateLimit = await getEmailProviderRateLimitState({
      emailAccountId: emailAccount.id,
      logger,
    }).catch((error) => {
      logger.warn("入队前读取服务商限流状态失败", {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    });

    if (isGoogleProvider(activeRateLimit?.provider)) {
      await cleanupWebhookAccountOnRateLimitSkip(emailAccount, logger).catch(
        (error) => {
          logger.warn("限流跳过期间清理 webhook 邮箱账号失败", {
            error: error instanceof Error ? error.message : error,
          });
        },
      );
      await markGmailHistoryCatchUp(emailAccount.id, logger);
      logger.warn("因 Gmail 限流生效而跳过 webhook 入队", {
        retryAt: activeRateLimit.retryAt.toISOString(),
        rateLimitSource: activeRateLimit.source,
      });
      return NextResponse.json({ ok: true });
    }
  }

  // 使用 after() 异步处理历史记录，避免 Pub/Sub 确认超时
  // 这样既能快速确认消息，又能完整处理它
  after(() =>
    runWithBackgroundLoggerFlush({
      logger,
      task: () => processWebhookAsync(decodedData, logger, emailAccount),
      extra: { url: "/api/google/webhook" },
    }),
  );

  return NextResponse.json({ ok: true });
});

async function processWebhookAsync(
  decodedData: { emailAddress: string; historyId: string },
  logger: Logger,
  emailAccount?: Awaited<ReturnType<typeof getWebhookEmailAccount>> | null,
) {
  try {
    await processHistoryForUser(
      decodedData,
      { preloadedEmailAccount: emailAccount },
      logger,
    );
  } catch (error) {
    await handleWebhookError(error, {
      email: decodedData.emailAddress,
      emailAccountId: emailAccount?.id || "unknown",
      url: "/api/google/webhook",
      logger,
    });
  }
}

const gmailNotificationSchema = z.object({
  emailAddress: z.string().min(1),
  historyId: z
    .union([z.number(), z.string()])
    .transform((historyId) =>
      typeof historyId === "number" ? historyId.toString() : historyId.trim(),
    )
    .pipe(z.string().regex(/^\d+$/)),
});

function decodeHistoryId(body: { message?: { data?: string } }) {
  const data = body?.message?.data;
  if (!data) return null;

  // data is base64url-encoded JSON
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(base64, "base64").toString());
  } catch {
    return null;
  }

  const result = gmailNotificationSchema.safeParse(decoded);
  return result.success ? result.data : null;
}
