import { sendEmailBody } from "@/utils/types/mail";
import { labelVisibility, messageVisibility } from "@/utils/gmail/constants";
import { z } from "zod";

const mailboxItemKind = z.enum(["label", "folder"]);
const mailboxItemName = z
  .string()
  .trim()
  .min(1, "邮箱项目名称为必填项")
  .max(255, "邮箱项目名称最多 255 个字符");

export const unarchiveThreadBody = z.object({ threadId: z.string() });
export type UnarchiveThreadBody = z.infer<typeof unarchiveThreadBody>;

export const untrashThreadBody = z.object({ threadId: z.string() });
export type UntrashThreadBody = z.infer<typeof untrashThreadBody>;

export const updateMailboxItemBody = z
  .object({
    kind: mailboxItemKind,
    id: z.string().min(1, "邮箱项目 ID 为必填项"),
    name: mailboxItemName.optional(),
    color: z
      .object({
        backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i, {
          error: "背景颜色必须是六位十六进制颜色值",
        }),
        textColor: z.string().regex(/^#[0-9a-f]{6}$/i, {
          error: "文字颜色必须是六位十六进制颜色值",
        }),
      })
      .optional(),
    labelListVisibility: z.enum(labelVisibility).optional(),
    messageListVisibility: z.enum(messageVisibility).optional(),
  })
  .superRefine(({ kind, name, color, ...visibility }, context) => {
    const hasVisibility = Boolean(
      visibility.labelListVisibility || visibility.messageListVisibility,
    );
    if (kind === "folder" && hasVisibility) {
      context.addIssue({
        code: "custom",
        message: "文件夹不支持可见性设置",
      });
    }
    if (kind === "folder" && !name) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "文件夹名称为必填项",
      });
    }
    if (kind === "folder" && color) {
      context.addIssue({
        code: "custom",
        path: ["color"],
        message: "文件夹不支持颜色",
      });
    }
    if (kind === "label" && !name && !color && !hasVisibility) {
      context.addIssue({
        code: "custom",
        message: "标签名称、颜色或可见性设置至少需要提供一项",
      });
    }
  });

export const deleteMailboxItemBody = z.object({
  kind: mailboxItemKind,
  id: z.string().min(1, "邮箱项目 ID 为必填项"),
});

export const updateDraftBody = z.object({
  draftMessageId: z.string().min(1),
  draftId: z.string().min(1).optional(),
  messageHtml: z.string().max(1_000_000),
  subject: z.string().max(10_000),
  to: z.string(),
  from: z.string().optional(),
  cc: z.string(),
  bcc: z.string(),
});

export const saveComposeDraftBody = z.object({
  draftId: z.string().min(1).optional(),
  content: sendEmailBody,
});
export const composeDraftParams = z.object({
  draftId: z.string().min(1),
});
export const readComposeDraftQuery = z.object({
  messageId: z.string().min(1),
});
