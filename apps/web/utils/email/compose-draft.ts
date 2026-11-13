import { completeDraftRecipients } from "@/utils/email/draft-recipients";
import { ensureEmailSendingEnabled } from "@/utils/mail";
import { SafeError } from "@/utils/error";
import type { EmailProvider } from "@/utils/email/types";
import type { SendEmailBody } from "@/utils/types/mail";
import type { Logger } from "@/utils/logger";
import {
  markComposeSessionSent,
  recordComposeSessionDraft,
} from "@/utils/redis/compose-session-draft";

export async function saveComposeDraft({
  draftId,
  provider,
  content,
  composeSession,
}: {
  draftId?: string;
  provider: EmailProvider;
  content: SendEmailBody;
  /** Lets a send that replaces this draft find and remove it. */
  composeSession?: { id: string; emailAccountId: string; logger: Logger };
}) {
  // Local recovery keeps unfinished input; mailbox MIME headers need complete addresses.
  content = {
    ...content,
    to: completeDraftRecipients(content.to),
    cc: content.cc == null ? content.cc : completeDraftRecipients(content.cc),
    bcc:
      content.bcc == null ? content.bcc : completeDraftRecipients(content.bcc),
  };
  if (!draftId) {
    // Return the reference before syncing the rest of the content so later
    // failures can retry an update without creating another mailbox draft.
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
    if (!draft.id) throw new SafeError("Could not confirm the mailbox draft.");
    draftId = draft.id;
  } else {
    await provider.updateDraft(draftId, composeDraftTextUpdate(content));
  }
  // Recording runs alongside the read the save already makes, so it adds no
  // wait. A send may have replaced this session's draft while the save was on
  // its way; the draft it just wrote is then removed instead of left in Drafts.
  const [sessionSent, message] = await Promise.all([
    composeSession
      ? recordSessionDraft(composeSession, draftId)
      : Promise.resolve(false),
    provider.getDraft(draftId).catch(() => null),
  ]);
  if (sessionSent && composeSession) {
    if (!(await discardWithRetry({ draftId, provider })))
      composeSession.logger.warn(
        "Could not remove a draft saved after its send",
      );
    // Tells the composer the session is over, so it stops saving to a draft
    // that no longer exists.
    return {
      draftId,
      messageId: null,
      threadId: null,
      sessionSent: true as const,
    };
  }
  return {
    draftId,
    messageId: message?.id ?? null,
    threadId: message?.threadId ?? null,
  };
}

/**
 * 替换撰写会话草稿的发送操作送达后，将会话标记为已发送，并移除其保存的所有
 * 草稿。之后落地的保存操作会看到该标记并移除自己的草稿。可安全重复执行。
 */
export async function discardDraftReplacedBySend({
  emailAccountId,
  sessionId,
  provider,
}: {
  emailAccountId: string;
  sessionId: string;
  provider: EmailProvider;
}) {
  const draftIds = await markComposeSessionSent({ emailAccountId, sessionId });
  const kept: string[] = [];
  for (const draftId of draftIds)
    if (!(await discardWithRetry({ draftId, provider }))) kept.push(draftId);
  if (kept.length) throw new Error(`无法移除 ${kept.length} 个被替换的草稿`);
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
    reference &&
    (await provider.deleteDraft(reference.id, reference.version))
  )
    return;
  // 其他操作（例如邮件引擎自身的丢弃）可能在此期间已将其删除；只有仍然存在的
  // 草稿才确实发生了变化。
  if (await provider.getDraft(draftId))
    throw new SafeError("邮箱草稿已发生变化。请重新打开后再丢弃。");
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

// Attachments are added to and removed from the mailbox draft as the user
// edits, so saving or sending the text must leave them as they are.
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

async function recordSessionDraft(
  composeSession: { id: string; emailAccountId: string; logger: Logger },
  draftId: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await recordComposeSessionDraft({
        emailAccountId: composeSession.emailAccountId,
        sessionId: composeSession.id,
        draftId,
      });
    } catch (error) {
      if (attempt === 1)
        composeSession.logger.warn(
          "Could not record the compose session draft",
          {
            error,
          },
        );
    }
  }
  return false;
}

// Provider calls fail now and then; a replaced draft is worth a few tries.
async function discardWithRetry({
  draftId,
  provider,
}: {
  draftId: string;
  provider: EmailProvider;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await discardComposeDraft({ draftId, provider });
      return true;
    } catch {
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
    }
  }
  return false;
}
