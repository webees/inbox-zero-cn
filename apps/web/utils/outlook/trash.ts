import type { OutlookClient } from "@/utils/outlook/client";
import { publishDelete, type TinybirdEmailAction } from "@inboxzero/tinybird";
import type { Logger } from "@/utils/logger";
import {
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";
import { runThreadMessageMutation } from "@/utils/outlook/thread-helpers";
import { resolveMicrosoftGraphNextLink } from "@/utils/outlook/page-token";

export async function trashThread(options: {
  client: OutlookClient;
  threadId: string;
  ownerEmail: string;
  actionSource: TinybirdEmailAction["actionSource"];
  logger: Logger;
}) {
  const { client, threadId, ownerEmail, actionSource, logger } = options;
  const messageIds = await getThreadMessageIds({ client, threadId, logger });

  await runThreadMessageMutation({
    messageIds,
    threadId,
    logger,
    failureMessage: "未能将邮件移动到垃圾箱",
    messageHandler: (messageId) =>
      withMicrosoftGraphWriteRetry(
        () =>
          client.getClient().api(`/me/messages/${messageId}/move`).post({
            destinationId: "deleteditems",
          }),
        logger,
      ),
  });

  try {
    await publishDelete({
      ownerEmail,
      threadId,
      actionSource,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error("发布删除操作失败", {
      email: ownerEmail,
      threadId,
      error,
    });
  }

  return { status: 200 };
}

async function getThreadMessageIds({
  client,
  threadId,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  logger: Logger;
}): Promise<string[]> {
  const escapedThreadId = threadId.replace(/'/g, "''");
  let page: { value: { id: string }[]; "@odata.nextLink"?: string } =
    await withMicrosoftGraphRetry(
      () =>
        client
          .getClient()
          .api("/me/messages")
          .filter(`conversationId eq '${escapedThreadId}'`)
          .select("id")
          .get(),
      logger,
    );

  // 在移动邮件改变分页结果集之前完成枚举。
  const messageIds = new Set<string>();
  const visitedPages = new Set<string>();
  while (true) {
    for (const message of page.value) messageIds.add(message.id);
    if (!page["@odata.nextLink"]) break;

    const nextLink = resolveMicrosoftGraphNextLink(page["@odata.nextLink"]);
    if (!nextLink || visitedPages.has(nextLink)) {
      throw new Error("无法完成 Outlook 会话分页");
    }
    visitedPages.add(nextLink);
    page = await withMicrosoftGraphRetry(
      () => client.getClient().api(nextLink).get(),
      logger,
    );
  }

  return [...messageIds];
}
