import type { Message } from "@microsoft/microsoft-graph-types";
import type { Logger } from "@/utils/logger";
import type { OutlookClient } from "@/utils/outlook/client";
import type { BulkArchiveResult, BulkArchiveThread } from "@/utils/email/types";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import { getFolderIds } from "@/utils/outlook/message";
import { resolveMicrosoftGraphNextLink } from "@/utils/outlook/page-token";
import {
  publishBulkActionToTinybird,
  updateEmailMessagesForSender,
} from "@/utils/email/bulk-action-tracking";

const GRAPH_JSON_BATCH_LIMIT = 20; // Microsoft Graph JSON 批处理上限
const GRAPH_MOVE_BATCH_LIMIT = 4;
const THREAD_PARTICIPANT_SELECT_FIELDS =
  "id,conversationId,from,toRecipients,receivedDateTime";

type GraphBatchRequestItem<TBody = unknown> = {
  id: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: TBody;
};

type GraphBatchResponseItem<TBody = unknown> = {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: TBody | null;
};

type GraphBatchResponse<TBody = unknown> = {
  responses?: GraphBatchResponseItem<TBody>[];
};

type MoveMessagesBatchResult = {
  movedMessageIds: string[];
  hasErrors: boolean;
};

async function batch<TRequestBody = unknown, TResponseBody = unknown>({
  client,
  requests,
  chunkSize,
  onFailure,
  shouldStop,
  context,
  logger,
}: {
  client: OutlookClient;
  requests: GraphBatchRequestItem<TRequestBody>[];
  chunkSize?: number;
  onFailure?: (params: {
    request?: GraphBatchRequestItem<TRequestBody>;
    response: GraphBatchResponseItem<TResponseBody>;
  }) => void;
  shouldStop?: (responses: GraphBatchResponseItem<TResponseBody>[]) => boolean;
  context?: Record<string, unknown>;
  logger: Logger;
}): Promise<GraphBatchResponseItem<TResponseBody>[]> {
  if (requests.length === 0) return [];

  const graphClient = client.getClient();
  const aggregatedResponses: GraphBatchResponseItem<TResponseBody>[] = [];
  const effectiveChunkSize = Math.min(
    chunkSize ?? GRAPH_JSON_BATCH_LIMIT,
    GRAPH_JSON_BATCH_LIMIT,
  );

  for (let start = 0; start < requests.length; start += effectiveChunkSize) {
    const chunk = requests.slice(start, start + effectiveChunkSize);

    try {
      const response = (await graphClient
        .api("/$batch")
        .post({ requests: chunk })) as GraphBatchResponse<TResponseBody>;

      const responses = response?.responses ?? [];
      const requestsById = new Map(
        chunk.map((request) => [request.id, request]),
      );

      responses.forEach((res) => {
        aggregatedResponses.push(res);
        if (res.status >= 400 && onFailure) {
          onFailure({
            request: requestsById.get(res.id),
            response: res,
          });
        }
      });
      if (shouldStop?.(responses)) break;
    } catch (error) {
      logger.error("Graph 批量请求失败", {
        ...context,
        chunkSize: chunk.length,
        error,
      });
      throw error;
    }
  }

  return aggregatedResponses;
}

export async function getThreadParticipantMessagesInBatches({
  client,
  threadIds,
  logger,
}: {
  client: OutlookClient;
  threadIds: string[];
  logger: Logger;
}): Promise<Map<string, Message[]>> {
  const requestIdToThreadId = new Map<string, string>();
  let requests = threadIds.map((threadId, index) => {
    const requestId = `thread-${index}`;
    requestIdToThreadId.set(requestId, threadId);

    const searchParams = new URLSearchParams({
      // 否则未发送的草稿会作为发件人出现在会话名称中。
      $filter: `conversationId eq '${escapeODataString(threadId)}' and isDraft eq false`,
      $select: THREAD_PARTICIPANT_SELECT_FIELDS,
      $top: "100",
    });

    return {
      id: requestId,
      method: "GET",
      url: `/me/messages?${searchParams}`,
    };
  });

  const messagesByThreadId = new Map<string, Message[]>();
  const seenNextLinks = new Set<string>();

  while (requests.length) {
    const responses = await batch<
      never,
      { value?: Message[]; "@odata.nextLink"?: string }
    >({
      client,
      requests,
      logger,
      context: { threadCount: threadIds.length },
      onFailure: ({ request, response }) => {
        logger.warn("获取 Outlook 会话参与者失败", {
          threadId: request ? requestIdToThreadId.get(request.id) : undefined,
          status: response.status,
        });
      },
      shouldStop: (responses) =>
        responses.some((response) => response.status === 429),
    });
    const continuationRequests: typeof requests = [];

    for (const response of responses) {
      if (response.status >= 400) continue;

      const threadId = requestIdToThreadId.get(response.id);
      if (!threadId) continue;

      const messages = messagesByThreadId.get(threadId) ?? [];
      messages.push(...(response.body?.value ?? []));
      messagesByThreadId.set(threadId, messages);

      const nextLink = response.body?.["@odata.nextLink"];
      if (!nextLink || seenNextLinks.has(nextLink)) continue;

      seenNextLinks.add(nextLink);
      continuationRequests.push({
        id: response.id,
        method: "GET",
        url: toGraphBatchUrl(nextLink),
      });
    }

    if (responses.some((response) => response.status === 429)) break;

    requests = continuationRequests;
  }

  return messagesByThreadId;
}

async function moveMessagesInBatches({
  client,
  messageIds,
  destinationId,
  action,
  stopOnError = false,
  logger,
}: {
  client: OutlookClient;
  messageIds: string[];
  destinationId: string;
  action: "archive" | "trash";
  stopOnError?: boolean;
  logger: Logger;
}): Promise<MoveMessagesBatchResult> {
  if (messageIds.length === 0) {
    return { movedMessageIds: [], hasErrors: false };
  }

  const requestIdToMessageId = new Map<string, string>();
  const requests = messageIds.map((messageId, index) => {
    const requestId = `${action}-${index}`;
    requestIdToMessageId.set(requestId, messageId);

    return {
      id: requestId,
      method: "POST",
      url: `/me/messages/${messageId}/move`,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        destinationId,
      },
    };
  });

  const responses = await batch({
    client,
    requests,
    chunkSize: GRAPH_MOVE_BATCH_LIMIT,
    context: {
      action,
      destinationId,
      messageCount: messageIds.length,
    },
    logger,
    onFailure: ({ request, response }) => {
      const messageId = request ? requestIdToMessageId.get(request.id) : null;
      const body = response.body;
      const errorMessage =
        body && typeof body === "object" && body !== null && "error" in body
          ? (body as { error?: { message?: string } }).error?.message
          : body
            ? JSON.stringify(body)
            : undefined;

      const context = {
        action,
        messageId,
        status: response.status,
        error: errorMessage,
      };
      if (response.status === 429) {
        logger.warn("通过批量操作移动邮件失败", context);
      } else {
        logger.error("通过批量操作移动邮件失败", context);
      }
    },
    shouldStop: (responses) =>
      responses.some((response) => response.status === 429),
  });

  const movedMessageIds = responses.flatMap((response) => {
    if (response.status >= 400) return [];

    const messageId = requestIdToMessageId.get(response.id);
    return messageId ? [messageId] : [];
  });
  const hasErrors = responses.some((response) => response.status >= 400);

  if (hasErrors && stopOnError) {
    logger.error("Graph 批量响应包含错误", {
      action,
      destinationId,
      errorCount: responses.filter((response) => response.status >= 400).length,
      messageCount: messageIds.length,
      statuses: responses
        .filter((response) => response.status >= 400)
        .map((response) => response.status),
    });
  }

  return {
    movedMessageIds,
    hasErrors,
  };
}

export async function moveThreadsInBatches({
  client,
  threads,
  destinationId,
  ownerEmail,
  logger,
}: {
  client: OutlookClient;
  threads: BulkArchiveThread[];
  destinationId: string;
  ownerEmail: string;
  logger: Logger;
}): Promise<BulkArchiveResult> {
  const messageIds = [
    ...new Set(threads.flatMap((thread) => thread.messageIds)),
  ];
  const { movedMessageIds } = await moveMessagesInBatches({
    client,
    messageIds,
    destinationId,
    action: "archive",
    logger,
  });
  const movedMessageIdSet = new Set(movedMessageIds);
  const succeededThreadIds = threads
    .filter(
      (thread) =>
        thread.messageIds.length > 0 &&
        thread.messageIds.every((messageId) =>
          movedMessageIdSet.has(messageId),
        ),
    )
    .map((thread) => thread.threadId);
  const succeededThreadIdSet = new Set(succeededThreadIds);
  const failedThreadIds = threads
    .map((thread) => thread.threadId)
    .filter((threadId) => !succeededThreadIdSet.has(threadId));

  if (succeededThreadIds.length > 0) {
    await publishBulkActionToTinybird({
      threadIds: succeededThreadIds,
      action: "archive",
      ownerEmail,
    });
  }

  return { succeededThreadIds, failedThreadIds };
}

export async function moveMessagesForSenders({
  client,
  senders,
  destinationId,
  action,
  ownerEmail,
  emailAccountId,
  continueOnError = true,
  logger,
}: {
  client: OutlookClient;
  senders: string[];
  destinationId: string;
  action: "archive" | "trash";
  ownerEmail: string;
  emailAccountId: string;
  continueOnError?: boolean;
  logger: Logger;
}): Promise<number> {
  if (senders.length === 0) return 0;

  // 解析用于归档过滤的实际收件箱文件夹 ID
  // 邮件上的 parentFolderId 是真实文件夹 ID（GUID），而不是已知名称
  let inboxFolderId: string | undefined;
  if (action === "archive") {
    const folderIds = await getFolderIds(client, logger, {
      includeDrafts: false,
    });
    inboxFolderId = folderIds.inbox;
    if (!inboxFolderId) {
      logger.error(
        "无法解析收件箱文件夹 ID——中止批量归档，以免从所有文件夹归档",
      );
      if (!continueOnError) {
        throw new Error("无法为批量归档解析收件箱文件夹 ID");
      }
      return 0;
    }
  }

  let movedMessagesCount = 0;

  for (const sender of senders) {
    if (!sender) continue;

    const processedMessageIds = new Set<string>();
    const publishedThreadIds = new Set<string>();
    const fromFilter = `from/emailAddress/address eq '${escapeODataString(sender)}'`;
    const filterExpression = inboxFolderId
      ? `${fromFilter} and parentFolderId eq '${escapeODataString(inboxFolderId)}'`
      : fromFilter;

    // 分页时直接使用 @odata.nextLink，而不是提取 $skiptoken
    // 这更可靠，因为 Microsoft Graph 可能使用不同的令牌格式
    // See: https://learn.microsoft.com/en-us/graph/paging
    let nextLink: string | undefined;

    // 获取一页邮件的辅助函数
    const fetchPage = async (url?: string) => {
      if (url) {
        // 对后续页面使用完整的 @odata.nextLink URL
        return client.getClient().api(url).get();
      }
      // 第一页：使用流式 API
      return client
        .getClient()
        .api("/me/messages")
        .filter(filterExpression)
        .top(100)
        .select("id,conversationId")
        .get();
    };

    // 处理所有页面
    do {
      try {
        const response: {
          value?: Array<{ id?: string | null; conversationId?: string | null }>;
          "@odata.nextLink"?: string;
        } = await fetchPage(nextLink);

        const allMessages = (response.value ?? []).filter(
          (message): message is { id: string; conversationId: string } =>
            !!message.id &&
            !!message.conversationId &&
            !processedMessageIds.has(message.id),
        );

        const messageIds = allMessages.map((msg) => msg.id);

        if (messageIds.length > 0) {
          try {
            const { movedMessageIds, hasErrors } = await moveMessagesInBatches({
              client,
              messageIds,
              destinationId,
              action,
              stopOnError: !continueOnError,
              logger,
            });

            const movedMessageIdSet = new Set(movedMessageIds);
            const batchThreadIds = new Set(
              allMessages
                .filter((message) => movedMessageIdSet.has(message.id))
                .map((message) => message.conversationId),
            );

            const newThreadIds = Array.from(batchThreadIds).filter(
              (threadId) => !publishedThreadIds.has(threadId),
            );

            const promises: Promise<unknown>[] = [];

            if (movedMessageIds.length > 0) {
              movedMessagesCount += movedMessageIds.length;
              promises.push(
                updateEmailMessagesForSender({
                  sender,
                  messageIds: movedMessageIds,
                  emailAccountId,
                  action,
                }),
              );
            }

            if (newThreadIds.length > 0) {
              promises.push(
                publishBulkActionToTinybird({
                  threadIds: newThreadIds,
                  action,
                  ownerEmail,
                }),
              );
            }

            await Promise.all(promises);

            newThreadIds.forEach((threadId) =>
              publishedThreadIds.add(threadId),
            );

            if (hasErrors && !continueOnError) {
              throw new Error("Graph 批处理返回了一个或多个错误响应。");
            }
          } catch (error) {
            logger.error("移动或跟踪邮件失败", {
              action,
              sender,
              ownerEmail,
              destinationId,
              messageIds,
              error,
            });
            if (!continueOnError) throw error;
          } finally {
            messageIds.forEach((id) => processedMessageIds.add(id));
          }
        }

        nextLink = response["@odata.nextLink"];
        logger.info("分页状态", {
          processedCount: processedMessageIds.size,
          hasNextLink: !!nextLink,
        });
      } catch (error) {
        logger.error("获取来自发件人的邮件失败", {
          sender,
          action,
          error,
        });
        if (!continueOnError) throw error;
        nextLink = undefined;
      }
    } while (nextLink);
  }

  return movedMessagesCount;
}

function toGraphBatchUrl(nextLink: string): string {
  const resolvedNextLink = resolveMicrosoftGraphNextLink(nextLink);
  if (!resolvedNextLink) {
    throw new Error("无效的 Outlook 参与者页面令牌");
  }

  const url = new URL(resolvedNextLink);
  const pathname = url.pathname.replace(/^\/(?:v1\.0|beta)(?=\/)/, "");
  return `${pathname}${url.search}`;
}
