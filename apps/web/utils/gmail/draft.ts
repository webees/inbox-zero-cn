import type { gmail_v1 } from "@googleapis/gmail";
import { createScopedLogger } from "@/utils/logger";
import { parseMessage } from "@/utils/gmail/message";
import { GmailLabel } from "@/utils/gmail/label";
import type { MessageWithPayload } from "@/utils/types";
import { isGmailError } from "@/utils/error";
import {
  withGmailRetry,
  withGmailNonIdempotentWriteRetry,
} from "@/utils/gmail/retry";

const logger = createScopedLogger("gmail/draft");
const MAX_DRAFT_LOOKUP_PAGES = 10;

export async function getDraft(draftId: string, gmail: gmail_v1.Gmail) {
  try {
    logger.info("正在获取草稿", { draftId });
    const response = await withGmailRetry(() =>
      gmail.users.drafts.get({
        userId: "me",
        id: draftId,
        format: "full",
      }),
    );

    logger.info("已收到草稿 API 响应", {
      draftId,
      responseDraftId: response.data.id,
      embeddedMessageId: response.data.message?.id,
      embeddedThreadId: response.data.message?.threadId,
    });

    const message = parseMessage(response.data.message as MessageWithPayload);

    // 安全措施：Gmail 有时会在已发送（移动到已发送）的邮件周围
    // 保留 Draft 包装。将这些视为“无草稿”，以免清理
    // 流程意外删除已发送邮件。
    const labelIds = message.labelIds ?? [];
    const hasDraftLabel = labelIds.includes(GmailLabel.DRAFT);
    const hasSentLabel = labelIds.includes(GmailLabel.SENT);

    if (!hasDraftLabel || hasSentLabel) {
      logger.info(
        "Draft embedded message is not a draft anymore, returning null",
        {
          draftId,
          embeddedMessageId: message.id,
          embeddedThreadId: message.threadId,
          hasDraftLabel,
          hasSentLabel,
          labelIds,
        },
      );
      return null;
    }

    return { ...message, payload: response.data.message?.payload };
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.info("未找到草稿，返回 null。", { draftId });
      return null;
    }
    throw error;
  }
}

export async function getDraftIdForMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<string | null> {
  // Gmail 草稿 id（r-NNN）不同于草稿的邮件 id；drafts.list 是
  // 将两者相互映射的唯一方式。
  let pageToken: string | undefined;
  const seenPageTokens = new Set<string>();
  for (let pageCount = 0; pageCount < MAX_DRAFT_LOOKUP_PAGES; pageCount++) {
    const response = await withGmailRetry(() =>
      gmail.users.drafts.list({
        userId: "me",
        maxResults: 500,
        pageToken,
      }),
    );

    const draft = response.data.drafts?.find(
      (draft) => draft.message?.id === messageId,
    );
    if (draft?.id) return draft.id;

    const nextPageToken = response.data.nextPageToken ?? undefined;
    if (!nextPageToken || seenPageTokens.has(nextPageToken)) return null;
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  logger.warn("达到页数上限后停止草稿查找", {
    maxPages: MAX_DRAFT_LOOKUP_PAGES,
  });

  return null;
}

function isNotFoundError(error: unknown): boolean {
  if (isGmailError(error) && error.code === 404) return true;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  const err = error as any;

  const statusCode =
    err.response?.data?.error?.code ??
    err.response?.status ??
    err.status ??
    err.code ??
    err.error?.response?.data?.error?.code ??
    err.error?.response?.status ??
    err.error?.status ??
    err.error?.code;

  return statusCode === 404;
}

/**
 * 校验草稿 ID 是否具有预期格式。
 * Gmail 草稿 ID 以 'r-' 开头，后跟数字（例如 'r-2497042748957023124'）。
 * 这有助于防止意外将邮件 ID 传给草稿删除 API。
 */
function isValidGmailDraftId(draftId: string): boolean {
  return /^r-\d+$/.test(draftId);
}

export async function sendDraft(
  gmail: gmail_v1.Gmail,
  draftId: string,
): Promise<{ messageId: string; threadId: string }> {
  logger.info("正在发送草稿", { draftId });

  const response = await withGmailNonIdempotentWriteRetry(() =>
    gmail.users.drafts.send({
      userId: "me",
      requestBody: {
        id: draftId,
      },
    }),
  );

  const messageId = response.data.id;
  const threadId = response.data.threadId;

  if (!messageId || !threadId) {
    throw new Error("发送草稿失败：缺少 messageId 或 threadId");
  }

  logger.info("草稿发送成功", { draftId, messageId, threadId });

  return { messageId, threadId };
}

export async function deleteDraft(
  gmail: gmail_v1.Gmail,
  draftId: string,
): Promise<boolean> {
  // 记录草稿 ID 格式的详细信息以便调试
  logger.info("正在尝试删除草稿", {
    draftId,
    draftIdLength: draftId.length,
    startsWithR: draftId.startsWith("r-"),
    isValidFormat: isValidGmailDraftId(draftId),
  });

  // 如果草稿 ID 格式意外，则发出警告但不阻止
  // 这有助于我们在不破坏功能的情况下识别潜在问题
  if (!isValidGmailDraftId(draftId)) {
    logger.warn(
      "Draft ID does not match expected Gmail format (r-NNNNN). This may indicate an issue.",
      { draftId },
    );
  }

  try {
    // 防御性检查：仅当这仍是真正的草稿时才删除。
    const existingDraft = await getDraft(draftId, gmail);
    if (!existingDraft) {
      logger.warn("未找到草稿或它不再是草稿，跳过删除。", {
        draftId,
      });
      return false;
    }

    const response = await withGmailRetry(() =>
      gmail.users.drafts.delete({
        userId: "me",
        id: draftId,
      }),
    );
    if (response.status !== 200 && response.status !== 204) {
      throw new Error(`Unexpected draft deletion status: ${response.status}`);
    }
    logger.info("已成功删除草稿", { draftId });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.warn("未找到草稿或它已被删除，跳过删除。", {
        draftId,
      });
      return false;
    } else {
      logger.error("删除草稿失败", { draftId, error });
      throw error;
    }
  }
}
