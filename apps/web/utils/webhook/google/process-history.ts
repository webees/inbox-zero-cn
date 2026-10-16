import uniqBy from "lodash/uniqBy";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { cleanupInvalidTokens } from "@/utils/auth/cleanup-invalid-tokens";
import { GmailLabel } from "@/utils/gmail/label";
import { captureException, isInvalidGrantError } from "@/utils/error";
import { isEmailProviderRateLimitError } from "@/utils/email/is-provider-rate-limit-error";
import {
  HistoryEventType,
  type ProcessHistoryOptions,
} from "@/utils/webhook/google/types";
import { processHistoryItem } from "@/utils/webhook/google/process-history-item";
import { getHistory } from "@/utils/gmail/history";
import {
  validateWebhookAccount,
  getWebhookEmailAccount,
  type ValidatedWebhookAccountData,
} from "@/utils/webhook/validate-webhook-account";
import {
  getEmailProviderRateLimitState,
  withRateLimitRecording,
} from "@/utils/email/rate-limit";
import prisma from "@/utils/prisma";
import {
  clearGmailHistoryCatchUp,
  getGmailHistoryCatchUp,
  markGmailHistoryCatchUp,
} from "@/utils/redis/gmail-history-catch-up";
import type { Logger } from "@/utils/logger";
import type { gmail_v1 } from "@googleapis/gmail";

const MAX_GMAIL_HISTORY_ID_GAP = 3000;
// Gmail 对该账号限流期间跳过的历史记录，是用户仍
// 在等待的邮件，因此它获得比长期断开连接的账号更宽的窗口。
const MAX_GMAIL_CATCH_UP_HISTORY_ID_GAP = 30_000;
const GMAIL_HISTORY_PAGE_SIZE = 500;

export async function processHistoryForUser(
  decodedData: {
    emailAddress: string;
    historyId: number | string;
  },
  options: {
    startHistoryId?: string;
    preloadedEmailAccount?: ValidatedWebhookAccountData | null;
  },
  logger: Logger,
) {
  const { emailAddress } = decodedData;
  const historyId = normalizeHistoryId(decodedData.historyId);
  // 数据库中的所有邮箱都存储为小写
  // 但 webhook 中的邮箱地址可能不是小写
  // 因此我们需要将其转换为小写
  const email = emailAddress.toLowerCase();

  const emailAccount =
    options.preloadedEmailAccount !== undefined
      ? options.preloadedEmailAccount
      : await getWebhookEmailAccount({ email }, logger);

  // biome-ignore lint/style/noParameterAssign: allowed for logging
  logger = logger.with({ email, emailAccountId: emailAccount?.id });

  const validation = await validateWebhookAccount(emailAccount, logger);

  if (!validation.success) {
    return validation.response;
  }

  const {
    emailAccount: validatedEmailAccount,
    hasAutomationRules,
    hasAiAccess: userHasAiAccess,
  } = validation.data;

  // biome-ignore lint/style/noParameterAssign: allowed for logging
  logger = logger.with({ userId: validatedEmailAccount.userId });

  Sentry.setTag("emailAccountId", validatedEmailAccount.id);
  Sentry.setUser({
    id: validatedEmailAccount.userId,
    email: validatedEmailAccount.email,
  });

  if (
    !validatedEmailAccount.account?.access_token ||
    !validatedEmailAccount.account?.refresh_token
  ) {
    logger.error("校验后缺少令牌");
    return NextResponse.json({ error: true });
  }

  const accountAccessToken = validatedEmailAccount.account.access_token;
  const accountRefreshToken = validatedEmailAccount.account.refresh_token;
  const accountProvider = validatedEmailAccount.account.provider || "google";

  try {
    let activeRateLimit: Awaited<
      ReturnType<typeof getEmailProviderRateLimitState>
    > = null;
    try {
      activeRateLimit = await getEmailProviderRateLimitState({
        emailAccountId: validatedEmailAccount.id,
        logger,
      });
    } catch (error) {
      logger.warn("Failed to read provider rate-limit state for webhook", {
        error: error instanceof Error ? error.message : error,
      });
    }

    if (activeRateLimit?.provider === "google") {
      await markGmailHistoryCatchUp(validatedEmailAccount.id, logger);
      logger.warn("由于 Gmail 处于限流状态，跳过 webhook 处理", {
        retryAt: activeRateLimit.retryAt.toISOString(),
        rateLimitSource: activeRateLimit.source,
      });
      return NextResponse.json({ ok: true });
    }

    return await withRateLimitRecording(
      {
        emailAccountId: validatedEmailAccount.id,
        provider: "google",
        logger,
        source: "google/webhook",
        onRateLimitRecorded: async (state, error) => {
          if (
            state ||
            isEmailProviderRateLimitError({ error, provider: "google" })
          ) {
            await markGmailHistoryCatchUp(validatedEmailAccount.id, logger);
          }
        },
      },
      async () => {
        const gmail = await getGmailClientWithRefresh({
          accessToken: accountAccessToken,
          refreshToken: accountRefreshToken,
          expiresAt:
            validatedEmailAccount.account.expires_at?.getTime() || null,
          emailAccountId: validatedEmailAccount.id,
          logger,
        });

        const catchUpToken = await getGmailHistoryCatchUp(
          validatedEmailAccount.id,
          logger,
        );
        const maxHistoryIdGap = catchUpToken
          ? MAX_GMAIL_CATCH_UP_HISTORY_ID_GAP
          : MAX_GMAIL_HISTORY_ID_GAP;

        const historyResult = await fetchGmailHistoryResilient({
          gmail,
          emailAccount: validatedEmailAccount,
          webhookHistoryId: historyId,
          maxHistoryIdGap,
          options,
          logger,
        });

        if (historyResult.status === "expired") {
          await updateLastSyncedHistoryId({
            emailAccountId: validatedEmailAccount.id,
            lastSyncedHistoryId: historyId,
          });
          if (catchUpToken) {
            await clearGmailHistoryCatchUp({
              emailAccountId: validatedEmailAccount.id,
              token: catchUpToken,
              logger,
            });
          }
          return NextResponse.json({ ok: true });
        }

        const historyEntries = historyResult.history;

        if (historyEntries.length > 0) {
          logger.info("Processing history", {
            startHistoryId: historyResult.startHistoryId,
            historyIdGap: historyResult.historyIdGap,
            maxHistoryIdGap,
            skippedHistoryIds: historyResult.skippedHistoryIds,
            pageCount: historyResult.pageCount,
            historyItemCount: historyResult.historyItemCount,
          });

          await processHistory(
            {
              history: historyEntries,
              spamLearnedThreadIds: new Set<string>(),
              gmail,
              accessToken: accountAccessToken,
              hasAutomationRules,
              hasAiAccess: userHasAiAccess,
              rules: validatedEmailAccount.rules,
              emailAccount: {
                ...validatedEmailAccount,
                account: {
                  provider: accountProvider,
                },
              },
            },
            logger,
          );
        } else {
          // 当我们截断较大的空缺时，Gmail 可能返回一个空的近期窗口。
          // 我们仍需要推进到 webhook 的 historyId，以免一直
          // 落后并持续跳过。
          logger.info("No history", {
            startHistoryId: historyResult.startHistoryId,
            historyIdGap: historyResult.historyIdGap,
            maxHistoryIdGap,
            skippedHistoryIds: historyResult.skippedHistoryIds,
            pageCount: historyResult.pageCount,
          });

          // 保存这一点很重要，否则我们可能陷入永远收不到历史记录的循环
          await updateLastSyncedHistoryId({
            emailAccountId: validatedEmailAccount.id,
            lastSyncedHistoryId: historyId,
          });
        }

        if (catchUpToken) {
          await clearGmailHistoryCatchUp({
            emailAccountId: validatedEmailAccount.id,
            token: catchUpToken,
            logger,
          });
        }

        return NextResponse.json({ ok: true });
      },
    );
  } catch (error) {
    if (isInvalidGrantError(error)) {
      logger.warn("Invalid grant", { email });
      await cleanupInvalidTokens({
        emailAccountId: validatedEmailAccount.id,
        reason: "invalid_grant",
        // 创建客户端时可能在保留此授权的同时轮换访问令牌。
        failedRefreshToken: accountRefreshToken,
        logger,
      }).catch((cleanupError) =>
        logger.error("清理 webhook 认证失败状态时出错", {
          cleanupError,
        }),
      );
      return NextResponse.json({ ok: true });
    }

    captureException(error, { userEmail: email, extra: { decodedData } });
    logger.error("处理 webhook 时出错", {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    });
    // 这里返回 200，否则 PubSub 会反复调用该 webhook
    return NextResponse.json({ error: true });
  }
}

async function processHistory(options: ProcessHistoryOptions, logger: Logger) {
  const { history, emailAccount } = options;
  const { email: userEmail, id: emailAccountId } = emailAccount;

  if (!history?.length) return;

  for (const h of history) {
    const historyMessages = [
      ...(h.messagesAdded || []),
      ...(h.labelsAdded || []),
      ...(h.labelsRemoved || []),
    ];

    if (!historyMessages.length) continue;

    const allEvents = [
      ...(h.messagesAdded || [])
        .filter((m) => {
          const isRelevant = isInboxOrSentMessage(m);
          if (!isRelevant) {
            logger.info("跳过不在收件箱或已发送中的邮件", {
              messageId: m.message?.id,
              labelIds: m.message?.labelIds,
            });
          }
          return isRelevant;
        })
        .map((m) => ({ type: HistoryEventType.MESSAGE_ADDED, item: m })),
      ...(h.labelsAdded || []).map((m) => ({
        type: HistoryEventType.LABEL_ADDED,
        item: m,
      })),
      ...(h.labelsRemoved || []).map((m) => ({
        type: HistoryEventType.LABEL_REMOVED,
        item: m,
      })),
    ];

    const uniqueEvents = uniqBy(
      allEvents,
      (e) => `${e.type}:${e.item.message?.id}`,
    );

    for (const event of uniqueEvents) {
      const log = logger.with({
        messageId: event.item.message?.id,
        threadId: event.item.message?.threadId,
      });

      try {
        await processHistoryItem(event, options, log);
      } catch (error) {
        // 在游标越过 Gmail 拒绝提供的邮件之前停下，以便
        // 限流后的追赶再次拾取它。
        if (isEmailProviderRateLimitError({ error, provider: "google" })) {
          throw error;
        }
        captureException(error, {
          userEmail,
          extra: { messageId: event.item.message?.id },
        });
        logger.error("处理历史记录项时出错", { error });
      }
    }

    // 追赶可能超过函数超时时间，因此保留已取得的进度。
    await updateLastSyncedHistoryId({
      emailAccountId,
      lastSyncedHistoryId: h.id,
    });
  }

  const lastSyncedHistoryId = history[history.length - 1].id;

  await updateLastSyncedHistoryId({
    emailAccountId,
    lastSyncedHistoryId,
  });
}

/**
 * 使用单调/条件更新来更新 lastSyncedHistoryId，以防止
 * 并发的 webhook 处理器回退该指针的竞态条件。
 * 仅当新值大于当前值时才更新。
 */
async function updateLastSyncedHistoryId({
  emailAccountId,
  lastSyncedHistoryId,
}: {
  emailAccountId: string;
  lastSyncedHistoryId?: string | null;
}) {
  if (!lastSyncedHistoryId) return;

  // 使用条件更新：仅当新值 > 当前值（或当前值为 null）时才设置
  // 这可以防止较慢、history ID 较旧的 webhook 处理器
  // 覆盖较快的、ID 较新的处理器所取得进度的竞态条件
  await prisma.$executeRaw`
    UPDATE "EmailAccount"
    SET "lastSyncedHistoryId" = ${lastSyncedHistoryId}, "updatedAt" = NOW()
    WHERE id = ${emailAccountId}
    AND (
      "lastSyncedHistoryId" IS NULL
      OR CAST("lastSyncedHistoryId" AS NUMERIC) < CAST(${lastSyncedHistoryId} AS NUMERIC)
    )
  `;
}

const isInboxOrSentMessage = (message: {
  message?: { labelIds?: string[] | null };
}) => {
  const labels = message.message?.labelIds;

  if (!labels) return false;

  if (labels.includes(GmailLabel.INBOX) && !labels.includes(GmailLabel.DRAFT))
    return true;

  if (labels.includes(GmailLabel.SENT)) return true;

  return false;
};

function isHistoryIdExpiredError(error: unknown): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  const err = error as any;
  const statusCode =
    err.response?.data?.error?.code ??
    err.response?.status ??
    err.status ??
    err.code;

  return statusCode === 404;
}

/**
 * 以更强的韧性从 Gmail 拉取历史记录：
 * 1. 限制向前追溯的范围，以避免处理巨大的空缺（例如用户断开连接数月）。
 * 2. 通过重置同步点来处理已过期的 history ID（404）。
 */
async function fetchGmailHistoryResilient({
  gmail,
  emailAccount,
  webhookHistoryId,
  maxHistoryIdGap,
  options,
  logger,
}: {
  gmail: gmail_v1.Gmail;
  emailAccount: ValidatedWebhookAccountData;
  webhookHistoryId: string;
  maxHistoryIdGap: number;
  options: { startHistoryId?: string };
  logger: Logger;
}): Promise<
  | {
      status: "success";
      startHistoryId: string;
      history: gmail_v1.Schema$History[];
      historyIdGap: number;
      skippedHistoryIds: number;
      pageCount: number;
      historyItemCount: number;
    }
  | { status: "expired" }
> {
  const lastSyncedHistoryId = normalizeHistoryId(
    emailAccount?.lastSyncedHistoryId || "0",
  );
  const lastSyncedHistoryIdBig = BigInt(lastSyncedHistoryId);
  const webhookHistoryIdBig = BigInt(webhookHistoryId);
  const maxGap = BigInt(maxHistoryIdGap);

  const historyIdGap = boundedHistoryCount(
    maxBigInt(BigInt(0), webhookHistoryIdBig - lastSyncedHistoryIdBig),
  );

  // history ID 不是条目计数，因此让此窗口足够大以容纳正常的
  // 活跃账号突发流量，同时仍能限制旧/断开连接账号的追赶。
  const startHistoryIdBig = maxBigInt(
    lastSyncedHistoryIdBig,
    webhookHistoryIdBig - maxGap,
  );
  const startHistoryId = options?.startHistoryId
    ? normalizeHistoryId(options.startHistoryId)
    : startHistoryIdBig.toString();
  const skippedHistoryIds = options?.startHistoryId
    ? 0
    : boundedHistoryCount(
        maxBigInt(BigInt(0), startHistoryIdBig - lastSyncedHistoryIdBig),
      );

  // 如果我们有意跳过 Gmail history ID 以保持系统稳定，则记录日志。
  if (skippedHistoryIds > 0) {
    logger.warn("由于空缺过大，跳过 Gmail history ID", {
      lastSyncedHistoryId,
      webhookHistoryId,
      historyIdGap,
      maxHistoryIdGap,
      effectiveStartHistoryId: startHistoryId,
      skippedHistoryIds,
    });
  }

  logger.info("Listing history", {
    startHistoryId,
    lastSyncedHistoryId: emailAccount?.lastSyncedHistoryId,
    gmailHistoryId: startHistoryId,
    webhookHistoryId,
    historyIdGap,
    maxHistoryIdGap,
    skippedHistoryIds,
  });

  try {
    const historyEntries: gmail_v1.Schema$History[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const data = await getHistory(
        gmail,
        {
          startHistoryId,
          historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
          maxResults: GMAIL_HISTORY_PAGE_SIZE,
          pageToken,
        },
        logger,
      );

      const pageHistory = data.history ?? [];
      historyEntries.push(...pageHistory);
      pageCount += 1;
      pageToken = data.nextPageToken || undefined;

      logger.info("已拉取 Gmail 历史记录页", {
        startHistoryId,
        pageCount,
        pageHistoryItemCount: pageHistory.length,
        accumulatedHistoryItemCount: historyEntries.length,
        hasNextPage: !!pageToken,
      });
    } while (pageToken);

    return {
      status: "success",
      history: historyEntries,
      startHistoryId,
      historyIdGap,
      skippedHistoryIds,
      pageCount,
      historyItemCount: historyEntries.length,
    };
  } catch (error) {
    // Gmail history ID 通常有效约 1 周。如果更早，Gmail 会返回 404。
    // 在这种情况下，我们将同步点重置为当前 history ID。
    if (isHistoryIdExpiredError(error)) {
      logger.warn("HistoryId expired, resetting to current", {
        expiredHistoryId: startHistoryId,
        newHistoryId: webhookHistoryId,
      });
      return { status: "expired" };
    }
    throw error;
  }
}

function normalizeHistoryId(historyId: number | string) {
  const normalized =
    typeof historyId === "number" ? historyId.toString() : historyId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("Invalid historyId");
  return normalized;
}

function maxBigInt(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function boundedHistoryCount(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}
