import { processHistoryForUser } from "@/utils/webhook/outlook/process-history";
import { createEmailProvider } from "@/utils/email/provider";
import {
  isProviderRateLimitModeError,
  type ProviderRateLimitModeError,
} from "@/utils/email/rate-limit-mode-error";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import type { ParsedMessage } from "@/utils/types";
import { runWithBoundedConcurrency } from "@/utils/async";

const OUTLOOK_RECONCILE_PAGE_SIZE = 50;
const OUTLOOK_RECONCILE_MESSAGE_CONCURRENCY = 5;

export async function backfillRecentOutlookMessages({
  emailAccountId,
  emailAddress,
  subscriptionId,
  after,
  maxMessages,
  logger,
}: {
  emailAccountId: string;
  emailAddress: string;
  subscriptionId?: string;
  after: Date;
  maxMessages: number;
  logger: Logger;
}) {
  const provider = await createEmailProvider({
    emailAccountId,
    provider: "microsoft",
    logger,
  });

  const { messages: candidateMessages, pageCount } = await listRecentMessages({
    provider,
    after,
    maxMessages,
  });

  if (!candidateMessages.length) {
    logger.info("未找到用于对账的近期 Outlook 邮件", {
      after,
      maxMessages,
      pageCount,
    });
    return { processedCount: 0, candidateCount: 0, rateLimited: false };
  }

  const existingMessages = await prisma.emailMessage.findMany({
    where: {
      emailAccountId,
      messageId: { in: candidateMessages.map((message) => message.id) },
    },
    select: { messageId: true },
  });
  const existingMessageIds = new Set(
    existingMessages.map((message) => message.messageId),
  );

  const unseenMessages = candidateMessages
    .filter((message) => !existingMessageIds.has(message.id))
    .sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime(),
    );
  const unseenThreads = getOldestMessagePerThread(unseenMessages);

  logger.info("正在对账近期 Outlook 邮件", {
    after,
    maxMessages,
    pageCount,
    candidateCount: candidateMessages.length,
    unseenCount: unseenMessages.length,
    unseenThreadCount: unseenThreads.length,
    subscriptionId,
  });

  // 一旦服务商对该账号限流，剩余的每次调用都会快速失败，
  // 因此跳过其余部分，而不是为每个会话记录一次错误。
  let rateLimitError: ProviderRateLimitModeError | undefined;
  const results = await runWithBoundedConcurrency({
    items: unseenThreads,
    concurrency: OUTLOOK_RECONCILE_MESSAGE_CONCURRENCY,
    run: async (message) => {
      if (rateLimitError) throw rateLimitError;

      try {
        await processHistoryForUser({
          emailAddress,
          subscriptionId,
          resourceData: {
            id: message.id,
            conversationId: message.threadId,
          },
          logger: logger.with({ messageId: message.id }),
        });
      } catch (error) {
        if (isProviderRateLimitModeError(error)) rateLimitError ??= error;
        throw error;
      }
    },
  });

  let processedCount = 0;
  let rateLimitedCount = 0;
  for (const { item: message, result } of results) {
    if (result.status === "fulfilled") {
      processedCount++;
      continue;
    }

    if (isProviderRateLimitModeError(result.reason)) {
      rateLimitedCount++;
      continue;
    }

    logger.error("回填期间处理邮件失败", {
      messageId: message.id,
      error: result.reason,
    });
  }

  if (rateLimitError) {
    logger.warn("因账号被限流而停止 Outlook 回填", {
      rateLimitedCount,
      retryAt: rateLimitError.retryAt,
    });
  }

  logger.info("已完成近期 Outlook 邮件的对账", {
    after,
    maxMessages,
    pageCount,
    candidateCount: candidateMessages.length,
    unseenCount: unseenMessages.length,
    unseenThreadCount: unseenThreads.length,
    processedCount,
    subscriptionId,
  });

  return {
    processedCount,
    candidateCount: candidateMessages.length,
    rateLimited: Boolean(rateLimitError),
  };
}

function getOldestMessagePerThread(messages: ParsedMessage[]) {
  const messagesByThread = new Map<string, ParsedMessage>();

  for (const message of messages) {
    const existing = messagesByThread.get(message.threadId);
    if (!existing) {
      messagesByThread.set(message.threadId, message);
      continue;
    }

    if (new Date(message.date).getTime() < new Date(existing.date).getTime()) {
      messagesByThread.set(message.threadId, message);
    }
  }

  return [...messagesByThread.values()].sort(
    (left, right) =>
      new Date(left.date).getTime() - new Date(right.date).getTime(),
  );
}

async function listRecentMessages({
  provider,
  after,
  maxMessages,
}: {
  provider: EmailProvider;
  after: Date;
  maxMessages: number;
}) {
  const messages: ParsedMessage[] = [];
  const seenMessageIds = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;

  while (messages.length < maxMessages) {
    const response = await provider.getMessagesWithPagination({
      after,
      maxResults: Math.min(
        OUTLOOK_RECONCILE_PAGE_SIZE,
        maxMessages - messages.length,
      ),
      pageToken,
    });
    pageCount++;

    for (const message of response.messages) {
      if (seenMessageIds.has(message.id)) continue;
      seenMessageIds.add(message.id);
      messages.push(message);
    }

    if (!response.nextPageToken || !response.messages.length) break;
    pageToken = response.nextPageToken;
  }

  return { messages, pageCount };
}
