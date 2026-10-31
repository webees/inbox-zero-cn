import { z } from "zod";

export const deleteChatBody = z.object({
  chatId: z.string().trim().min(1),
});
export type DeleteChatBody = z.infer<typeof deleteChatBody>;

export const renameChatFormBody = z.object({
  name: z.string().trim().min(1, "名称为必填项").max(200),
});
export type RenameChatFormBody = z.infer<typeof renameChatFormBody>;

export const renameChatBody = renameChatFormBody.extend({
  chatId: z.string().trim().min(1),
});
export type RenameChatBody = z.infer<typeof renameChatBody>;
