import type { Message } from "@microsoft/microsoft-graph-types";
import type { OutlookClient } from "@/utils/outlook/client";
import type { Logger } from "@/utils/logger";
import {
  isNotFoundError,
  isPreconditionFailedError,
} from "@/utils/outlook/errors";
import {
  convertMessage,
  getCategoryMap,
  getFolderIds,
  MESSAGE_EXPAND_ATTACHMENTS,
} from "@/utils/outlook/message";
import {
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";

export async function getDraft({
  client,
  draftId,
  logger,
  includeAttachments = false,
}: {
  client: OutlookClient;
  draftId: string;
  logger: Logger;
  includeAttachments?: boolean;
}) {
  const [draft, categoryMap] = await Promise.all([
    getDraftMessage({ client, draftId, logger, includeAttachments }),
    getCategoryMap(client, logger),
  ]);
  if (!draft) return null;

  return convertMessage(draft.message, draft.folderIds, categoryMap);
}

export async function getDraftReference({
  client,
  messageId,
  logger,
}: {
  client: OutlookClient;
  messageId: string;
  logger: Logger;
}): Promise<{ id: string; version: string } | null> {
  const draft = await getDraftMessage({
    client,
    draftId: messageId,
    logger,
  });
  if (!draft) return null;
  if (!draft.folderIds.drafts) {
    logger.warn("无法验证 Outlook 草稿文件夹");
    return null;
  }

  const version = draftVersionFromMessage(draft.message);
  if (!version) {
    logger.warn(
      "Outlook draft omitted etag and changeKey; using an unconditional version",
      { messageId },
    );
  }

  return { id: messageId, version: version ?? "*" };
}

export async function sendDraft({
  client,
  draftId,
  logger,
}: {
  client: OutlookClient;
  draftId: string;
  logger: Logger;
}): Promise<{ messageId: string; threadId: string }> {
  logger.info("正在发送草稿", { draftId });

  // Graph 在将已发送草稿移动到已发送邮件时可能返回 404。在发送前
  // 捕获会话 ID，以便元数据读取不会导致发送失败。
  const draft = await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${draftId}`)
        .select("conversationId")
        .get() as Promise<Message>,
    logger,
  );

  const threadId = draft.conversationId;
  if (!threadId) {
    throw new Error("未能从草稿获取 threadId");
  }

  await withMicrosoftGraphWriteRetry(
    () => client.getClient().api(`/me/messages/${draftId}/send`).post({}),
    logger,
  );

  logger.info("草稿发送成功", {
    draftId,
    messageId: draftId,
    threadId,
  });

  return { messageId: draftId, threadId };
}

export async function deleteDraft({
  client,
  draftId,
  version,
  logger,
}: {
  client: OutlookClient;
  draftId: string;
  version: string;
  logger: Logger;
}): Promise<boolean> {
  try {
    logger.info("正在删除草稿", { draftId });

    const request = client
      .getClient()
      .api(`/me/messages/${draftId}`)
      .header("If-Match", version);

    await withMicrosoftGraphWriteRetry(() => request.delete(), logger);

    logger.info("草稿删除成功", { draftId });
    return true;
  } catch (error) {
    if (isNotFoundError(error) || isPreconditionFailedError(error)) {
      logger.info("草稿不再匹配可删除的版本", { draftId });
      return false;
    }

    logger.error("删除草稿失败", { draftId, error });
    throw error;
  }
}

async function getDraftMessage({
  client,
  draftId,
  logger,
  includeAttachments = false,
}: {
  client: OutlookClient;
  draftId: string;
  logger: Logger;
  includeAttachments?: boolean;
}) {
  try {
    const [message, folderIds] = await Promise.all([
      withMicrosoftGraphRetry(() => {
        const request = client.getClient().api(`/me/messages/${draftId}`);
        if (includeAttachments) request.expand(MESSAGE_EXPAND_ATTACHMENTS);
        return request.get() as Promise<Message>;
      }, logger),
      getFolderIds(client, logger),
    ]);

    if (folderIds.drafts && message.parentFolderId !== folderIds.drafts) {
      logger.info("草稿不再位于草稿文件夹中，视为已删除。", {
        draftId,
      });
      return null;
    }

    return { message, folderIds };
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.info("未找到草稿，返回 null。", { draftId });
      return null;
    }

    throw error;
  }
}

function draftVersionFromMessage(message: Message): string | undefined {
  const etag = (message as { "@odata.etag"?: string })["@odata.etag"];
  if (etag) return etag;
  if (!message.changeKey) return;
  return message.changeKey.startsWith("W/")
    ? message.changeKey
    : `W/"${message.changeKey}"`;
}
