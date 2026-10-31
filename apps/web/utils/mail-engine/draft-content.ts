import type { DraftContent } from "@inboxzero/mail-core/drafts";
import { splitRecipientList } from "@/utils/email";
import type { SendEmailBody } from "@/utils/types/mail";
import type { ComposeAttachmentReference } from "@/utils/mail-engine/reply-drafts";

export function sendEmailToDraftContent(
  email: SendEmailBody,
  conversationId?: string,
  providerDraftMessageIds: string[] = [],
  attachments: ComposeAttachmentReference[] = [],
): DraftContent {
  return {
    ...(email.from ? { from: email.from } : {}),
    to: splitRecipientList(email.to).slice(0, 100),
    cc: splitRecipientList(email.cc ?? "").slice(0, 100),
    bcc: splitRecipientList(email.bcc ?? "").slice(0, 100),
    subject: email.subject,
    editableHtml: email.messageHtml,
    quotedHtml: "",
    ...(conversationId ? { conversationId } : {}),
    ...(email.providerDraftId
      ? { providerDraftId: email.providerDraftId }
      : {}),
    ...(providerDraftMessageIds.length
      ? { providerDraftMessageIds: providerDraftMessageIds.slice(-50) }
      : {}),
    // 为编辑而恢复发送时会列出这些，而无需询问邮箱。
    ...(attachments.length
      ? { clientState: JSON.stringify({ attachments }) }
      : {}),
  };
}
