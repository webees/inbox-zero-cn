import prisma from "@/utils/prisma";
import { getPremiumUserFilter } from "@/utils/premium";
import { createEmailProvider } from "@/utils/email/provider";
import {
  applyFollowUpLabel,
  getOrCreateFollowUpLabel,
} from "@/utils/follow-up/labels";
import { generateFollowUpDraft } from "@/utils/follow-up/generate-draft";
import {
  getFollowUpNotificationChannels,
  sendFollowUpNotification,
  type FollowUpNotificationChannel,
} from "@/utils/follow-up/send-follow-up-notification";
import { parseFollowUpNotificationDeliveries } from "@/utils/follow-up/notification-deliveries";
import { ThreadTrackerType, SystemType } from "@/generated/prisma/enums";
import type { EmailProvider, EmailLabel } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { captureException, SafeError } from "@/utils/error";
import {
  getProviderRateLimitDelayMs,
  withRateLimitRecording,
} from "@/utils/email/rate-limit";
import {
  isProviderRateLimitModeError,
  toRateLimitProvider,
} from "@/utils/email/rate-limit-mode-error";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import {
  getLabelsFromDb,
  type LabelIds,
} from "@/utils/reply-tracker/label-helpers";
import { getRuleLabel } from "@/utils/rule/consts";
import {
  getElapsedBusinessDaysForDisplay,
  hasElapsedBusinessDays,
  internalDateToDate,
} from "@/utils/date";
import {
  extractEmailAddress,
  extractNameFromEmail,
  isSameEmailAddress,
} from "@/utils/email";
import { emailToContent } from "@/utils/mail";
import { isDuplicateError } from "@/utils/prisma-helpers";
import {
  getEmailUrlForOptionalMessage,
  getOpenInMailboxLabel,
} from "@/utils/url";
import { env } from "@/env";

const FOLLOW_UP_ELIGIBILITY_WINDOW_MINUTES = 15;
const FOLLOW_UP_THREAD_SCAN_LIMIT = 50;
// 已完成的候选不占用扫描额度，否则大量带标签的积压邮件
// 会在每次运行时被完整重读。每个被扫描的会话都是一次
// 服务商读取，无上限的扫描会超出 Gmail 的单用户配额。
const FOLLOW_UP_MAX_SCANNED_THREADS = 250;
// 避免在渠道分发时携带超出任何预览限制的整封邮件。
const FOLLOW_UP_SNIPPET_SOURCE_MAX_CHARS = 3000;

const followUpReminderAccountSelect = {
  id: true,
  email: true,
  about: true,
  userId: true,
  multiRuleSelectionEnabled: true,
  sensitiveDataPolicy: true,
  timezone: true,
  calendarBookingLink: true,
  followUpAwaitingReplyDays: true,
  followUpNeedsReplyDays: true,
  followUpAutoDraftEnabled: true,
  user: {
    select: {
      aiProvider: true,
      aiModel: true,
      aiApiKey: true,
    },
  },
  account: {
    select: {
      provider: true,
    },
  },
} as const;

type FollowUpReminderAccount = EmailAccountWithAI & {
  followUpAwaitingReplyDays: number | null;
  followUpNeedsReplyDays: number | null;
  followUpAutoDraftEnabled: boolean;
};

type FollowUpReminderAccountResult =
  | "success"
  | "error"
  | "rate-limited"
  | "not-eligible";

export async function getEligibleFollowUpReminderEmailAccountIds() {
  const emailAccounts = await prisma.emailAccount.findMany({
    where: getFollowUpReminderEligibilityWhere(),
    select: { id: true },
  });

  return emailAccounts.map((emailAccount) => emailAccount.id);
}

export async function processAllFollowUpReminders(logger: Logger) {
  logger.info("正在为所有用户处理跟进提醒");
  const startTime = Date.now();

  const emailAccounts = await prisma.emailAccount.findMany({
    where: getFollowUpReminderEligibilityWhere(),
    select: followUpReminderAccountSelect,
  });

  logger.info("找到符合条件的账号", { count: emailAccounts.length });

  let successCount = 0;
  let errorCount = 0;
  let rateLimitedCount = 0;

  for (const emailAccount of emailAccounts) {
    const accountLogger = logger.with({
      emailAccountId: emailAccount.id,
    });
    const status = await processLoadedFollowUpReminderAccount({
      emailAccount,
      logger: accountLogger,
    });

    if (status === "success") {
      successCount++;
      continue;
    }

    if (status === "rate-limited") {
      rateLimitedCount++;
      continue;
    }

    if (status === "error") {
      errorCount++;
    }
  }

  logger.info("完成跟进提醒处理", {
    total: emailAccounts.length,
    success: successCount,
    errors: errorCount,
    rateLimited: rateLimitedCount,
    processingTimeMs: Date.now() - startTime,
  });

  return {
    total: emailAccounts.length,
    success: successCount,
    errors: errorCount,
    rateLimited: rateLimitedCount,
  };
}

export async function processFollowUpRemindersForEmailAccountId({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}): Promise<FollowUpReminderAccountResult> {
  const accountLogger = logger.with({ emailAccountId });
  const emailAccount = await prisma.emailAccount.findFirst({
    where: {
      id: emailAccountId,
      ...getFollowUpReminderEligibilityWhere(),
    },
    select: followUpReminderAccountSelect,
  });

  if (!emailAccount) {
    accountLogger.info("跳过已不再符合条件的账号");
    return "not-eligible";
  }

  return processLoadedFollowUpReminderAccount({
    emailAccount,
    logger: accountLogger,
  });
}

export async function processAccountFollowUps({
  emailAccount,
  logger,
}: {
  emailAccount: FollowUpReminderAccount;
  logger: Logger;
}) {
  const now = new Date();
  const emailAccountId = emailAccount.id;

  logger.info("正在处理该账号的跟进");

  if (!emailAccount.account?.provider) {
    logger.warn("跳过没有服务商的账号");
    return;
  }

  const providerName = emailAccount.account.provider;
  const provider = await createEmailProvider({
    emailAccountId,
    provider: providerName,
    logger,
  });

  const [dbLabels, providerLabels, notificationChannels] = await Promise.all([
    getLabelsFromDb(emailAccountId),
    provider.getLabels({ includeHidden: true }),
    getFollowUpNotificationChannels(emailAccountId),
  ]);

  logger.info("已加载跟进提醒的前置数据", {
    providerName,
    providerLabelCount: providerLabels.length,
    notificationChannelCount: notificationChannels.length,
  });

  const followUpLabel = await getOrCreateFollowUpLabel(
    provider,
    providerLabels,
  );

  await processFollowUpsForType({
    systemType: SystemType.AWAITING_REPLY,
    thresholdDays: emailAccount.followUpAwaitingReplyDays,
    generateDraft:
      emailAccount.followUpAutoDraftEnabled &&
      !env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED,
    emailAccount,
    provider,
    providerName,
    followUpLabelId: followUpLabel.id,
    dbLabels,
    providerLabels,
    notificationChannels,
    now,
    logger,
  });

  await processFollowUpsForType({
    systemType: SystemType.TO_REPLY,
    thresholdDays: emailAccount.followUpNeedsReplyDays,
    generateDraft: false,
    emailAccount,
    provider,
    providerName,
    followUpLabelId: followUpLabel.id,
    dbLabels,
    providerLabels,
    notificationChannels,
    now,
    logger,
  });

  // 草稿清理暂时停用，以避免删除旧草稿。
  // 由于并非关键路径，包裹在 try/catch 中
  // try {
  //   await cleanupStaleDrafts({
  //     emailAccountId,
  //     provider,
  //     logger,
  //   });
  // } catch (error) {
  //   logger.error("清理过期草稿失败", { error });
  //   captureException(error);
  // }

  logger.info("完成该账号的跟进处理");
}

function getRetryAtFromRateLimitError(
  error: unknown,
  provider?: string | null,
): Date | undefined {
  if (isProviderRateLimitModeError(error) && error.retryAt) {
    const retryAt = new Date(error.retryAt);
    if (!Number.isNaN(retryAt.getTime())) return retryAt;
  }

  const rateLimitProvider = toRateLimitProvider(provider);
  if (!rateLimitProvider) return;

  const delayMs = getProviderRateLimitDelayMs({
    error,
    provider: rateLimitProvider,
    attemptNumber: 1,
  });
  if (!delayMs) return;
  return new Date(Date.now() + delayMs);
}

async function processFollowUpsForType({
  systemType,
  thresholdDays,
  generateDraft,
  emailAccount,
  provider,
  providerName,
  followUpLabelId,
  dbLabels,
  providerLabels,
  notificationChannels,
  now,
  logger,
}: {
  systemType: SystemType;
  thresholdDays: number | null;
  generateDraft: boolean;
  emailAccount: EmailAccountWithAI;
  provider: EmailProvider;
  providerName: string;
  followUpLabelId: string;
  dbLabels: LabelIds;
  providerLabels: EmailLabel[];
  notificationChannels: FollowUpNotificationChannel[];
  now: Date;
  logger: Logger;
}) {
  if (thresholdDays === null) return;

  const dbLabelInfo = dbLabels[systemType as keyof LabelIds];
  const providerLabelIds = new Set(providerLabels.map((l) => l.id));

  let labelId: string;

  if (dbLabelInfo?.labelId && providerLabelIds.has(dbLabelInfo.labelId)) {
    labelId = dbLabelInfo.labelId;
  } else {
    const found = providerLabels.find(
      (l) => l.name === getRuleLabel(systemType),
    );
    if (!found) {
      logger.info("找不到标签，跳过", { systemType });
      return;
    }
    labelId = found.id;
  }

  const trackerType =
    systemType === SystemType.AWAITING_REPLY
      ? ThreadTrackerType.AWAITING
      : ThreadTrackerType.NEEDS_REPLY;

  let processedCount = 0;
  let skippedAlreadyProcessedCount = 0;
  let skippedNoLatestMessageCount = 0;
  let skippedTooRecentCount = 0;
  let errorCount = 0;
  const skippedAlreadyProcessedThreadIds = new Set<string>();

  const scannedThreadIds = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  // 标签可能在追踪项写入或清理失败后仍保留。只有台账能够
  // 识别出不应占用本次运行额度的已完成候选。
  do {
    const page = await provider.getThreadsWithQuery({
      query: { labelId },
      maxResults: Math.min(
        FOLLOW_UP_THREAD_SCAN_LIMIT -
          (scannedThreadIds.size - skippedAlreadyProcessedCount),
        FOLLOW_UP_MAX_SCANNED_THREADS - scannedThreadIds.size,
      ),
      pageToken,
    });
    const threads = page.threads.filter((thread) => {
      if (scannedThreadIds.has(thread.id)) return false;
      scannedThreadIds.add(thread.id);
      return true;
    });
    pageToken = page.nextPageToken;

    logger.info("找到带标签的会话", {
      systemType,
      count: threads.length,
    });

    const threadIds = threads.map((t) => t.id);
    const processedLedger = await getProcessedFollowUpLedger({
      emailAccountId: emailAccount.id,
      threadIds,
    });
    const processedLedgerStats =
      summarizeProcessedFollowUpLedger(processedLedger);

    logger.info("已加载已处理的跟进台账", {
      systemType,
      candidateThreadCount: threadIds.length,
      ledgerThreadCount: processedLedgerStats.threadCount,
      ledgerMessageIdCount: processedLedgerStats.messageIdCount,
      ledgerSentAtCount: processedLedgerStats.sentAtCount,
    });

    for (const thread of threads) {
      const threadLogger = logger.with({ threadId: thread.id });

      try {
        const lastMessage = await provider.getLatestMessageFromThreadSnapshot({
          id: thread.id,
          messages: thread.messages,
        });
        if (!lastMessage) {
          skippedNoLatestMessageCount++;
          continue;
        }

        const messageDate = internalDateToDate(lastMessage.internalDate);
        if (
          !hasElapsedBusinessDays({
            start: messageDate,
            end: now,
            days: thresholdDays,
            windowMinutes: FOLLOW_UP_ELIGIBILITY_WINDOW_MINUTES,
            timezone: emailAccount.timezone,
          })
        ) {
          skippedTooRecentCount++;
          continue;
        }

        const ledgerEntry = processedLedger.get(thread.id);
        const processedReason = getFollowUpProcessedReason({
          processedLedger,
          threadId: thread.id,
          messageId: lastMessage.id,
          sentAt: messageDate,
        });

        if (processedReason) {
          skippedAlreadyProcessedCount++;
          skippedAlreadyProcessedThreadIds.add(thread.id);
          threadLogger.info("跳过已处理过的跟进候选", {
            systemType,
            messageId: lastMessage.id,
            sentAt: messageDate.toISOString(),
            processedReason,
            ledgerMessageIdCount: ledgerEntry?.messageIds.size ?? 0,
            ledgerSentAtCount: ledgerEntry?.sentAtTimes.size ?? 0,
          });
          continue;
        }

        threadLogger.info("已处理的台账中缺少跟进候选", {
          systemType,
          messageId: lastMessage.id,
          sentAt: messageDate.toISOString(),
          trackerType,
          ledgerThreadKnown: Boolean(ledgerEntry),
          ledgerMessageIdCount: ledgerEntry?.messageIds.size ?? 0,
          ledgerSentAtCount: ledgerEntry?.sentAtTimes.size ?? 0,
        });

        await applyFollowUpLabel({
          provider,
          threadId: thread.id,
          messageId: lastMessage.id,
          labelId: followUpLabelId,
          logger: threadLogger,
        });

        const existingTracker = await prisma.threadTracker.findFirst({
          where: {
            emailAccountId: emailAccount.id,
            threadId: thread.id,
            type: trackerType,
            resolved: false,
          },
          orderBy: { createdAt: "desc" },
        });

        let tracker: { id: string; followUpNotifications: unknown };
        let trackerWritePath: string;
        if (existingTracker) {
          try {
            tracker = await prisma.threadTracker.update({
              where: { id: existingTracker.id },
              data: {
                messageId: lastMessage.id,
                sentAt: messageDate,
                followUpAppliedAt: now,
              },
            });
            trackerWritePath = "updated-existing";
          } catch (error) {
            if (isDuplicateError(error)) {
              tracker = await prisma.threadTracker.update({
                where: {
                  emailAccountId_threadId_messageId: {
                    emailAccountId: emailAccount.id,
                    threadId: thread.id,
                    messageId: lastMessage.id,
                  },
                },
                data: {
                  resolved: false,
                  type: trackerType,
                  sentAt: messageDate,
                  followUpAppliedAt: now,
                },
              });
              trackerWritePath = "updated-duplicate";
            } else {
              throw error;
            }
          }
        } else {
          try {
            tracker = await prisma.threadTracker.create({
              data: {
                emailAccountId: emailAccount.id,
                threadId: thread.id,
                messageId: lastMessage.id,
                type: trackerType,
                sentAt: messageDate,
                followUpAppliedAt: now,
              },
            });
            trackerWritePath = "created";
          } catch (error) {
            if (isDuplicateError(error)) {
              tracker = await prisma.threadTracker.update({
                where: {
                  emailAccountId_threadId_messageId: {
                    emailAccountId: emailAccount.id,
                    threadId: thread.id,
                    messageId: lastMessage.id,
                  },
                },
                data: {
                  resolved: false,
                  type: trackerType,
                  sentAt: messageDate,
                  followUpAppliedAt: now,
                },
              });
              trackerWritePath = "created-duplicate-updated";
            } else {
              throw error;
            }
          }
        }

        threadLogger.info("已存储跟进追踪状态", {
          trackerId: tracker.id,
          messageId: lastMessage.id,
          sentAt: messageDate.toISOString(),
          trackerType,
          trackerWritePath,
        });

        let draftCreated = false;
        if (generateDraft) {
          if (isMessageFromUser(lastMessage, emailAccount.email)) {
            try {
              await generateFollowUpDraft({
                emailAccount,
                threadId: thread.id,
                messageId: lastMessage.id,
                trackerId: tracker.id,
                provider,
                logger: threadLogger,
              });
              draftCreated = true;
            } catch (draftError) {
              threadLogger.error("草稿生成失败，标签仍已应用", {
                error: draftError,
              });
              captureException(draftError);
            }
          } else {
            threadLogger.info("跳过跟进草稿：最新邮件不是用户发送的", {
              messageId: lastMessage.id,
            });
          }
        }

        if (notificationChannels.length > 0) {
          // 即发即忘：我们按 (threadId, messageId) 尝试一次，并依赖
          // 台账在下次运行时跳过。重试会消耗服务商速率
          // 限制（Gmail 重新打标签、Slack API）。
          try {
            const { name: counterpartyName, email: counterpartyEmail } =
              resolveFollowUpCounterparty({
                trackerType,
                fromHeader: lastMessage.headers.from,
                toHeader: lastMessage.headers.to,
              });
            const notificationDeliveries = await sendFollowUpNotification({
              channels: notificationChannels,
              subject: lastMessage.subject || "(无主题)",
              counterpartyName,
              counterpartyEmail,
              trackerType,
              daysSinceSent: getElapsedBusinessDaysForDisplay({
                start: messageDate,
                end: now,
                timezone: emailAccount.timezone,
              }),
              // 服务商预览已被预先截断且没有提示；完整的
              // 解析正文让各渠道改用省略号截断。
              snippet:
                emailToContent(lastMessage, {
                  maxLength: FOLLOW_UP_SNIPPET_SOURCE_MAX_CHARS,
                  extractReply: true,
                }) ||
                lastMessage.snippet ||
                undefined,
              threadLink:
                getEmailUrlForOptionalMessage({
                  messageId: lastMessage.id,
                  threadId: thread.id,
                  emailAddress: emailAccount.email,
                  provider: providerName,
                  externalUrl: lastMessage.externalUrl,
                }) ?? undefined,
              threadLinkLabel: getOpenInMailboxLabel(providerName) ?? undefined,
              trackerId: tracker.id,
              logger: threadLogger,
            });
            if (notificationDeliveries.length > 0) {
              await prisma.threadTracker.update({
                where: { id: tracker.id },
                data: {
                  followUpNotifications: [
                    ...parseFollowUpNotificationDeliveries(
                      tracker.followUpNotifications,
                    ),
                    ...notificationDeliveries,
                  ],
                },
              });
            }
            threadLogger.info("跟进通知投递尝试已完成", {
              trackerId: tracker.id,
              configuredChannelCount: notificationChannels.length,
              deliveryCount: notificationDeliveries.length,
            });
          } catch (notifyError) {
            threadLogger.error("跟进通知失败，标签仍已应用", {
              error: notifyError,
            });
            captureException(notifyError);
          }
        }

        threadLogger.info("已处理跟进", { draftCreated });
        processedCount++;
      } catch (error) {
        errorCount++;
        threadLogger.error("处理会话失败", { error });
        captureException(error);
      }
    }

    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        logger.warn("分页令牌重复，停止跟进扫描", {
          systemType,
        });
        break;
      }
      seenPageTokens.add(pageToken);
    }
  } while (
    pageToken &&
    scannedThreadIds.size < FOLLOW_UP_MAX_SCANNED_THREADS &&
    scannedThreadIds.size - skippedAlreadyProcessedCount <
      FOLLOW_UP_THREAD_SCAN_LIMIT
  );

  if (pageToken && scannedThreadIds.size >= FOLLOW_UP_MAX_SCANNED_THREADS) {
    logger.warn("已达会话上限，停止跟进扫描", {
      systemType,
      scanned: scannedThreadIds.size,
      skippedAlreadyProcessed: skippedAlreadyProcessedCount,
    });
  }

  const skippedCount =
    skippedAlreadyProcessedCount +
    skippedNoLatestMessageCount +
    skippedTooRecentCount;

  if (skippedAlreadyProcessedThreadIds.size > 0) {
    logger.info("跳过已处理的会话", {
      systemType,
      skipped: skippedAlreadyProcessedThreadIds.size,
    });
    logger.trace("已跳过会话 ID（这些会话已处理过）", {
      systemType,
      skippedThreadIds: [...skippedAlreadyProcessedThreadIds],
    });
  }

  logger.info("完成跟进处理", {
    systemType,
    processed: processedCount,
    skipped: skippedCount,
    total: scannedThreadIds.size,
    skippedAlreadyProcessed: skippedAlreadyProcessedCount,
    skippedNoLatestMessage: skippedNoLatestMessageCount,
    skippedTooRecent: skippedTooRecentCount,
    errors: errorCount,
    eligibilityWindowMinutes: FOLLOW_UP_ELIGIBILITY_WINDOW_MINUTES,
    thresholdDays,
  });
}

type ProcessedFollowUpLedger = Map<
  string,
  { messageIds: Set<string>; sentAtTimes: Set<number> }
>;

async function getProcessedFollowUpLedger({
  emailAccountId,
  threadIds,
}: {
  emailAccountId: string;
  threadIds: string[];
}): Promise<ProcessedFollowUpLedger> {
  if (threadIds.length === 0) return new Map();

  const existingTrackers = await prisma.threadTracker.findMany({
    where: {
      emailAccountId,
      threadId: { in: threadIds },
      OR: [
        { followUpAppliedAt: { not: null } },
        { followUpDraftId: { not: null } },
      ],
    },
    select: { threadId: true, messageId: true, sentAt: true },
  });

  const processedLedger: ProcessedFollowUpLedger = new Map();

  for (const tracker of existingTrackers) {
    const processed = processedLedger.get(tracker.threadId) ?? {
      messageIds: new Set<string>(),
      sentAtTimes: new Set<number>(),
    };
    processed.messageIds.add(tracker.messageId);
    if (tracker.sentAt) {
      processed.sentAtTimes.add(tracker.sentAt.getTime());
    }
    processedLedger.set(tracker.threadId, processed);
  }

  return processedLedger;
}

function summarizeProcessedFollowUpLedger(ledger: ProcessedFollowUpLedger) {
  let messageIdCount = 0;
  let sentAtCount = 0;

  for (const processed of ledger.values()) {
    messageIdCount += processed.messageIds.size;
    sentAtCount += processed.sentAtTimes.size;
  }

  return {
    threadCount: ledger.size,
    messageIdCount,
    sentAtCount,
  };
}

type FollowUpProcessedReason = "message-id" | "sent-at";

// 需要检查 sentAt，因为 Outlook 可能对同一封已发送邮件返回不同的服务商消息 ID
// 在多次运行之间（包括标记完成之后）。该台账
// 只包含已有跟进历史的记录，因此普通的 Reply Zero
// 追踪项仍会收到首次跟进。
function getFollowUpProcessedReason({
  processedLedger,
  threadId,
  messageId,
  sentAt,
}: {
  processedLedger: ProcessedFollowUpLedger;
  threadId: string;
  messageId: string;
  sentAt: Date;
}): FollowUpProcessedReason | null {
  const processed = processedLedger.get(threadId);
  if (!processed) return null;

  if (processed.messageIds.has(messageId)) return "message-id";
  if (processed.sentAtTimes.has(sentAt.getTime())) return "sent-at";
  return null;
}

async function processLoadedFollowUpReminderAccount({
  emailAccount,
  logger,
}: {
  emailAccount: FollowUpReminderAccount;
  logger: Logger;
}): Promise<Exclude<FollowUpReminderAccountResult, "not-eligible">> {
  let recordedRetryAt: Date | undefined;
  const provider = emailAccount.account?.provider;

  try {
    await withRateLimitRecording(
      {
        emailAccountId: emailAccount.id,
        provider,
        logger,
        source: "follow-up-reminders",
        onRateLimitRecorded: (state) => {
          recordedRetryAt = state?.retryAt;
        },
      },
      async () =>
        processAccountFollowUps({
          emailAccount,
          logger,
        }),
    );
    return "success";
  } catch (error) {
    const retryAtFromError = getRetryAtFromRateLimitError(error, provider);
    const retryAt = recordedRetryAt || retryAtFromError;

    if (retryAt) {
      logger.warn("服务商限流生效期间，跳过跟进提醒", {
        retryAt: retryAt.toISOString(),
      });
      return "rate-limited";
    }

    if (error instanceof SafeError && error.message === "No refresh token") {
      logger.warn("账号缺少刷新令牌，跳过跟进提醒");
      return "error";
    }

    logger.error("处理用户的跟进提醒失败", {
      error,
    });
    captureException(error);
    return "error";
  }
}

function getFollowUpReminderEligibilityWhere() {
  return {
    OR: [
      { followUpAwaitingReplyDays: { not: null } },
      { followUpNeedsReplyDays: { not: null } },
    ],
    ...getPremiumUserFilter(),
  };
}

function isMessageFromUser(
  message: { headers: { from: string } },
  userEmail: string,
) {
  return isSameEmailAddress(message.headers.from, userEmail);
}

function resolveFollowUpCounterparty({
  trackerType,
  fromHeader,
  toHeader,
}: {
  trackerType: ThreadTrackerType;
  fromHeader: string;
  toHeader: string;
}): { name: string; email: string } {
  // AWAITING：用户给对方发了邮件——返回收件人。
  // NEEDS_REPLY：对方给用户发了邮件——返回发件人。
  const header =
    trackerType === ThreadTrackerType.AWAITING ? toHeader : fromHeader;
  const email = extractEmailAddress(header || "") || header || "";
  const name = extractNameFromEmail(header || "") || email || "某人";
  return { name, email };
}
