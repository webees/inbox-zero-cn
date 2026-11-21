import { validateEmailAttachmentMetadata } from "@inboxzero/email-editor/core";
import { z } from "zod";

// 这些值最终会出现在 MIME 头中，因此任何可能突破头部行的内容都会被拒绝，
// 而不是进行转义。
const CONTROL_CHARACTER = /\p{Cc}/u;
const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/u;

export const draftAttachmentMetadataSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,64}$/u, "附件 ID 无效。"),
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !CONTROL_CHARACTER.test(value)),
    mimeType: z.string().max(255).regex(MIME_TYPE),
    size: z.number().int().nonnegative(),
    disposition: z.enum(["attachment", "inline"]),
    contentId: z.string().max(255).optional(),
  })
  .superRefine((attachment, context) => {
    const validation = validateEmailAttachmentMetadata([attachment]);
    if (!validation.valid)
      context.addIssue({ code: "custom", message: validation.error });
  });
export type DraftAttachmentMetadata = z.infer<
  typeof draftAttachmentMetadataSchema
>;
