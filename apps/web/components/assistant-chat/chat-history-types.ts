import type { GetChatsResponse } from "@/app/api/chats/route";

export type ChatHistoryEntry = GetChatsResponse["chats"][number];

export function getChatHistoryLabel(
  chat: Pick<ChatHistoryEntry, "name" | "createdAt">,
): string {
  return chat.name ?? `${new Date(chat.createdAt).toLocaleString()} 的对话`;
}
