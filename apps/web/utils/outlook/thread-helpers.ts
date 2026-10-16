import type { OutlookClient } from "@/utils/outlook/client";
import type { Logger } from "@/utils/logger";
import { runWithBoundedConcurrency } from "@/utils/async";

const OUTLOOK_THREAD_WRITE_CONCURRENCY = 3;

export async function runThreadMessageMutation({
  messageIds,
  threadId,
  logger,
  messageHandler,
  failureMessage,
  continueOnError = false,
  throwIfAllFail = false,
}: {
  messageIds: string[];
  threadId: string;
  logger: Logger;
  messageHandler: (messageId: string) => Promise<unknown>;
  failureMessage: string;
  continueOnError?: boolean;
  throwIfAllFail?: boolean;
}) {
  if (messageIds.length === 0) return;

  const results = await runWithBoundedConcurrency({
    items: messageIds,
    concurrency: OUTLOOK_THREAD_WRITE_CONCURRENCY,
    run: (messageId) => messageHandler(messageId),
  });

  const failures = results.filter(
    (
      entry,
    ): entry is {
      item: string;
      result: PromiseRejectedResult;
    } => entry.result.status === "rejected",
  );

  for (const failure of failures) {
    logger.warn(failureMessage, {
      threadId,
      messageId: failure.item,
      error: failure.result.reason,
    });
  }

  const firstFailure = failures[0];
  if (!firstFailure) return;
  const reason = firstFailure.result.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason));

  if (!continueOnError) {
    throw error;
  }
  if (throwIfAllFail && failures.length === messageIds.length) {
    throw error;
  }
}

/**
 * 按 conversationId 获取邮件并对每封应用操作。
 * 在 OData $filter 方式失败时用作回退。
 */
export async function processThreadMessagesFallback({
  client,
  threadId,
  logger,
  messageHandler,
  noMessagesMessage,
  throwIfAllFail = false,
}: {
  client: OutlookClient;
  threadId: string;
  logger: Logger;
  messageHandler: (messageId: string) => Promise<unknown>;
  noMessagesMessage: string;
  throwIfAllFail?: boolean;
}) {
  const messages = await client
    .getClient()
    .api("/me/messages")
    .select("id,conversationId")
    .get();

  const threadMessages = messages.value.filter(
    (message: { conversationId: string }) =>
      message.conversationId === threadId,
  );

  if (threadMessages.length > 0) {
    await runThreadMessageMutation({
      messageIds: threadMessages.map((message: { id: string }) => message.id),
      threadId,
      logger,
      messageHandler,
      failureMessage: "会话回退中处理邮件失败",
      continueOnError: true,
      throwIfAllFail,
    });
  } else {
    logger.warn(noMessagesMessage, { threadId });
  }
}
