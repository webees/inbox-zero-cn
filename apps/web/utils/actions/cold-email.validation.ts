import { z } from "zod";

export const coldEmailBlockerBody = z.object({
  from: z.string(),
  subject: z.string(),
  textHtml: z.string().nullable(),
  textPlain: z.string().nullable(),
  snippet: z.string().nullable(),
  // 临时修复。不确定为什么会这样。internalDate 有时是字符串，有时是数字？
  date: z.string().or(z.number()).optional(),
  threadId: z.string().nullable(),
  messageId: z.string().nullable(),
});
export type ColdEmailBlockerBody = z.infer<typeof coldEmailBlockerBody>;

export const markNotColdEmailBody = z.object({ sender: z.string() });
export type MarkNotColdEmailBody = z.infer<typeof markNotColdEmailBody>;
