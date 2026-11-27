import prisma from "@/utils/prisma";

export const REDACTED_TEXT = "[REDACTED]";

const REDACTED_PARTS = [{ type: "text", text: REDACTED_TEXT }];

/**
 * 软删除归属于 `emailAccountId` 的聊天。
 *
 * Chat 行本身会保留（设置 `deletedAt`），以便平台级
 * 分析和审计记录仍可工作，但所有用户提供或
 * 模型生成的、与聊天相关的内容都会被替换为已脱敏的
 * 占位符。包括：
 *  - `Chat.name`
 *  - `ChatMessage.parts` for every message in the chat
 *  - `ChatCompaction.summary` for every compaction in the chat
 *  - `ChatMemory.content` for memories linked to this chat
 *
 * 如果聊天存在且现已软删除（或此前已是软删除状态）
 * 则返回 `true`；若该 id 对应的聊天不归此
 * 账号所有，则返回 `false`。
 */
export async function softDeleteChat({
  chatId,
  emailAccountId,
}: {
  chatId: string;
  emailAccountId: string;
}): Promise<boolean> {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, emailAccountId },
    select: { id: true, deletedAt: true },
  });

  if (!chat) return false;
  if (chat.deletedAt) return true;

  // 作为单个事务运行，以免脱敏失败导致聊天
  // 被标记为已删除，而消息、压缩记录或记忆仍
  // 可读。
  await prisma.$transaction([
    prisma.chat.update({
      where: { id: chat.id },
      data: { deletedAt: new Date(), name: null },
    }),
    prisma.chatMessage.updateMany({
      where: { chatId: chat.id },
      data: { parts: REDACTED_PARTS },
    }),
    prisma.chatCompaction.updateMany({
      where: { chatId: chat.id },
      data: { summary: REDACTED_TEXT },
    }),
    prisma.chatMemory.updateMany({
      where: { chatId: chat.id },
      data: { content: REDACTED_TEXT },
    }),
  ]);

  return true;
}
