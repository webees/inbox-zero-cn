import { z } from "zod";
import { bcp47LanguageTag } from "@/app/api/ai/translate/validation";

export const translateThreadBody = z.object({
  // 翻译器 20 条文本的限制中，有一个名额用于主题。
  messageIds: z.array(z.string().trim().min(1)).min(1).max(19),
  targetLanguage: bcp47LanguageTag,
});
