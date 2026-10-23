import { ensureEmailSendingEnabled } from "@/utils/mail";
import { SafeError } from "@/utils/error";
import type { EmailProvider } from "@/utils/email/types";
import type { SendEmailBody } from "@/utils/types/mail";

export async function saveComposeDraft({
  draftId,
  provider,
  content,
}: {
  draftId?: string;
  provider: EmailProvider;
  content: SendEmailBody;
}) {
  if (!draftId) {
    // 在同步其余内容之前返回引用，以便后续失败
    // 可以重试更新而不会创建另一个邮箱草稿。
    const draft = await provider.createDraft({
      to: content.to,
      from: content.from,
      cc: content.cc,
      bcc: content.bcc,
      subject: content.subject,
      messageHtml: content.messageHtml,
      replyToMessageId: content.replyToEmail?.messageId,
      forwardedMessageId: content.replyToEmail?.messageId
        ? undefined
        : content.replyToEmail?.forwardedMessageId,
    });
    if (!draft.id) throw new SafeError("无法确认邮箱草稿。");
    draftId = draft.id;
  } else {
    await provider.updateDraft(draftId, composeDraftTextUpdate(content));
  }
  const message = await provider.getDraft(draftId).catch(() => null);
  return {
    draftId,
    messageId: message?.id ?? null,
    threadId: message?.threadId ?? null,
  };
}

export async function discardComposeDraft({
  draftId,
  provider,
}: {
  draftId: string;
  provider: EmailProvider;
}) {
  const message = await provider.getDraft(draftId);
  if (!message) return;
  const reference = await provider.getDraftReferenceForMessage(message.id);
  if (
    !reference ||
    !(await provider.deleteDraft(reference.id, reference.version))
  )
    throw new SafeError("邮箱草稿已变更。丢弃前请重新打开。");
}

export async function sendComposeDraft({
  draftId,
  provider,
  email,
}: {
  draftId: string;
  provider: EmailProvider;
  email: SendEmailBody;
}) {
  ensureEmailSendingEnabled();
  await provider.updateDraft(draftId, composeDraftTextUpdate(email));
  return provider.sendDraft(draftId);
}

// 附件会随用户编辑被添加到邮箱草稿或从中移除，
// 因此保存或发送文本时必须保持它们原样。
function composeDraftTextUpdate(content: SendEmailBody) {
  return {
    to: content.to,
    from: content.from,
    cc: content.cc ?? "",
    bcc: content.bcc ?? "",
    subject: content.subject,
    messageHtml: content.messageHtml,
  };
}
