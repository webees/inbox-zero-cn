import { z } from "zod";
import { NewsletterStatus } from "@/generated/prisma/enums";

export const setSenderStatusBody = z.object({
  senderEmail: z.string().email(),
  status: z.nativeEnum(NewsletterStatus).nullable(),
  // 在归档发件人邮件的同时为其打标签。仅与 AUTO_ARCHIVED 一起使用。
  labelId: z.string().optional(),
  labelName: z.string().optional(),
});
export type SetSenderStatusBody = z.infer<typeof setSenderStatusBody>;

export const setSenderStatusRequestBody = setSenderStatusBody.extend({
  // 归档已在收件箱中的邮件。仅与 AUTO_ARCHIVED 一起有效。
  archiveExisting: z.boolean().optional(),
});

export const unsubscribeSenderBody = z.object({
  senderEmail: z.string().email(),
  unsubscribeLink: z.string().optional().nullable(),
  listUnsubscribeHeader: z.string().optional().nullable(),
});
export type UnsubscribeSenderBody = z.infer<typeof unsubscribeSenderBody>;

export const BULK_SENDER_ACTION_LIMIT = 20;

export const bulkSenderActionSchema = z.enum([
  "unsubscribe",
  "approved",
  "auto_archived",
  "clear",
]);
export type BulkSenderActionName = z.infer<typeof bulkSenderActionSchema>;

export const bulkSenderActionsBody = z.object({
  actions: z
    .array(
      z.object({
        senderEmail: z.string().email(),
        action: bulkSenderActionSchema,
      }),
    )
    .min(1)
    .max(BULK_SENDER_ACTION_LIMIT),
});
