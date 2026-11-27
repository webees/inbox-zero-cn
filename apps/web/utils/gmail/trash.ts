import type { gmail_v1 } from "@googleapis/gmail";
import { publishDelete, type TinybirdEmailAction } from "@inboxzero/tinybird";
import { createScopedLogger } from "@/utils/logger";
import { withGmailRetry } from "@/utils/gmail/retry";

const logger = createScopedLogger("gmail/trash");

// trash 将会话/邮件移动到垃圾箱文件夹
// delete 立即删除会话/邮件
// trash 不需要来自 Gmail API 的删除访问权限

export async function trashThread(options: {
  gmail: gmail_v1.Gmail;
  threadId: string;
  ownerEmail: string;
  actionSource: TinybirdEmailAction["actionSource"];
}) {
  const { gmail, threadId, ownerEmail, actionSource } = options;

  const trashPromise = withGmailRetry(() =>
    gmail.users.threads.trash({
      userId: "me",
      id: threadId,
    }),
  );

  const publishPromise = publishDelete({
    ownerEmail,
    threadId,
    actionSource,
    timestamp: Date.now(),
  });

  const [trashResult, publishResult] = await Promise.allSettled([
    trashPromise,
    publishPromise,
  ]);

  if (trashResult.status === "rejected") {
    const error = trashResult.reason;

    if (error.message === "Requested entity was not found.") {
      // 会话不存在，因此它已被删除
      logger.warn("未能将不存在的会话移入垃圾箱", {
        email: ownerEmail,
        threadId,
        error,
      });
      return { status: 200 };
    } else {
      logger.error("将会话移入垃圾箱失败", {
        email: ownerEmail,
        threadId,
        error,
      });
      throw error;
    }
  }

  if (publishResult.status === "rejected") {
    logger.error("发布删除操作失败", {
      email: ownerEmail,
      threadId,
      error: publishResult.reason,
    });
  }

  return trashResult.value;
}

/**
 * 恢复已删除的会话。Gmail 会将其恢复到删除前所持有的
 * 标签，因此从收件箱删除的会话会回到收件箱。
 */
export async function untrashThread(options: {
  gmail: gmail_v1.Gmail;
  threadId: string;
}) {
  const { gmail, threadId } = options;

  return withGmailRetry(() =>
    gmail.users.threads.untrash({
      userId: "me",
      id: threadId,
    }),
  );
}

export async function trashMessage(options: {
  gmail: gmail_v1.Gmail;
  messageId: string;
}) {
  const { gmail, messageId } = options;

  return withGmailRetry(() =>
    gmail.users.messages.trash({
      userId: "me",
      id: messageId,
    }),
  );
}
