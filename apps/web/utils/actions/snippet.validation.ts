import { z } from "zod";
import {
  isValidSnippetShortcut,
  normalizeSnippetShortcut,
} from "@/utils/snippets/snippet-shortcut";

const snippetShortcutSchema = z
  .string()
  .trim()
  .transform(normalizeSnippetShortcut)
  .refine(isValidSnippetShortcut, {
    message: "以字母开头，可使用小写字母、数字和连字符",
  });

export const createSnippetBody = z.object({
  content: z.string().trim().min(1, "内容为必填项").max(10_000),
  shortcut: snippetShortcutSchema,
});
export type CreateSnippetBody = z.infer<typeof createSnippetBody>;

export const updateSnippetBody = z.object({
  content: z.string().trim().min(1, "内容为必填项").max(10_000),
  id: z.string().min(1),
  shortcut: snippetShortcutSchema,
});
export type UpdateSnippetBody = z.infer<typeof updateSnippetBody>;

export const deleteSnippetBody = z.object({
  id: z.string().min(1),
});
export type DeleteSnippetBody = z.infer<typeof deleteSnippetBody>;
