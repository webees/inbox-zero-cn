import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { gmail_v1 } from "@googleapis/gmail";
import type Mail from "nodemailer/lib/mailer";
import type { DraftAttachmentMetadata } from "@/utils/actions/draft-attachments.validation";
import {
  assertDraftAttachmentLimits,
  type DraftMessageUploadPart,
  getDraftMessageUploadLength,
} from "@/utils/email/draft-attachment-upload";
import type { DraftAttachmentsResult } from "@/utils/email/types";
import { DraftNotFoundError, SafeError } from "@/utils/error";
import {
  listGmailAttachmentParts,
  readGmailAttachmentParts,
  toGmailMailAttachment,
} from "@/utils/gmail/attachment";
import { getDraft } from "@/utils/gmail/draft";
import { buildMailMessage } from "@/utils/gmail/mail";
import { withGmailRetry } from "@/utils/gmail/retry";
import { convertEmailHtmlToText } from "@/utils/mail";

type GmailDraft = NonNullable<Awaited<ReturnType<typeof getDraft>>>;

type DraftTextUpdate = {
  messageHtml?: string;
  subject?: string;
  to?: string;
  from?: string;
  cc?: string;
  bcc?: string;
};

export async function getGmailDraftAttachments(
  gmail: gmail_v1.Gmail,
  draftId: string,
): Promise<DraftAttachmentsResult | null> {
  const draft = await getDraft(draftId, gmail);
  if (!draft) return null;
  return {
    messageId: draft.id,
    attachments: listGmailAttachmentParts(draft.id, draft.payload).map(
      ({ attachment }) => attachment,
    ),
  };
}

export async function getRequiredGmailDraftAttachments(
  gmail: gmail_v1.Gmail,
  draftId: string,
) {
  const result = await getGmailDraftAttachments(gmail, draftId);
  if (!result) throw draftNotFound();
  return result;
}

/**
 * Gmail 没有按附件的草稿 API：每次更改都会替换整封
 * 邮件。文本编辑和小的附件更改在这里根据草稿已有内容
 * 重建它，因此浏览器绝不会重新发送现有文件。
 */
export async function rewriteGmailDraft({
  gmail,
  draftId,
  text,
  addAttachment,
  removeAttachmentId,
}: {
  gmail: gmail_v1.Gmail;
  draftId: string;
  text?: DraftTextUpdate;
  addAttachment?: DraftAttachmentMetadata & { content: Buffer };
  removeAttachmentId?: string;
}) {
  const current = await getRequiredDraft(gmail, draftId);
  const parts = listGmailAttachmentParts(current.id, current.payload);
  if (
    removeAttachmentId &&
    !parts.some(({ attachment }) => attachment.id === removeAttachmentId)
  )
    throw new SafeError("此文件已不在草稿中。");
  const kept = parts.filter(
    ({ attachment }) =>
      attachment.id !== removeAttachmentId &&
      attachment.id !== addAttachment?.id,
  );
  if (addAttachment)
    assertDraftAttachmentLimits(
      kept.map(({ attachment }) => attachment),
      addAttachment.size,
    );
  const attachments = await readGmailAttachmentParts(gmail, kept);
  if (addAttachment)
    attachments.push(
      toGmailMailAttachment(addAttachment, addAttachment.content),
    );

  const message = await buildMailMessage(
    draftMailOptions(current, attachments, text),
  );
  await uploadGmailDraftMessage(
    gmail,
    { draftId, threadId: current.threadId },
    message,
  );
}

/**
 * 完整草稿邮件，并为每个附件的 base64 预留一个槽位。
 * 服务器写入每个头、HTML 和 MIME 结构；
 * 浏览器只用文件的字节填充这些槽位。
 */
export async function buildGmailDraftUploadTemplate({
  gmail,
  draftId,
  attachment,
}: {
  gmail: gmail_v1.Gmail;
  draftId: string;
  attachment: DraftAttachmentMetadata;
}) {
  const current = await getRequiredDraft(gmail, draftId);
  const existing = listGmailAttachmentParts(current.id, current.payload)
    .map((part) => part.attachment)
    .filter((item) => item.id !== attachment.id);
  assertDraftAttachmentLimits(existing, attachment.size);
  // 作为附件的邮件不能是 base64（RFC 2046），因此它们没有槽位。
  if (
    [...existing, attachment].some((item) =>
      item.mimeType.startsWith("message/"),
    )
  )
    throw new SafeError(
      "无法向带有附加邮件的草稿添加大型文件。请附加小于 3 MB 的文件，或移除该附加邮件。",
    );

  const slots = [
    ...existing.map((item) => ({
      attachment: item,
      part: {
        type: "attachment" as const,
        attachmentId: item.id,
        size: item.size,
        source: {
          messageId: item.messageId,
          providerAttachmentId: item.providerAttachmentId,
        },
      },
    })),
    {
      attachment,
      part: {
        type: "attachment" as const,
        attachmentId: attachment.id,
        size: attachment.size,
      },
    },
  ].map((slot) => {
    // 一个简短的占位符，其 base64 可放入一行，因此可以在
    // 构建好的邮件中找到并替换为真实文件。
    const content = Buffer.from(randomBytes(15).toString("hex"));
    return { ...slot, content, encoded: content.toString("base64") };
  });
  const built = await buildMailMessage(
    draftMailOptions(
      current,
      slots.map((slot) => toGmailMailAttachment(slot.attachment, slot.content)),
    ),
  );
  // 浏览器会重新编码文本部分，因此 ASCII 之外的字节会
  // 改变它们的长度并破坏声明的上传大小。
  if (built.some((byte) => byte > 0x7f)) throw new Error("无法准备草稿上传。");
  const message = built.toString("latin1");

  // 内联图片位于常规附件之前的相关部分中，因此
  // 邮件顺序可能与槽位顺序不同。
  const located = slots
    .map((slot) => ({ ...slot, index: message.indexOf(slot.encoded) }))
    .sort((a, b) => a.index - b.index);
  const parts: DraftMessageUploadPart[] = [];
  let cursor = 0;
  for (const { part, encoded, index } of located) {
    if (index < cursor) throw new Error("无法准备草稿上传。");
    parts.push({ type: "text", text: message.slice(cursor, index) }, part);
    cursor = index + encoded.length;
  }
  parts.push({ type: "text", text: message.slice(cursor) });

  return {
    threadId: current.threadId,
    parts,
    totalBytes: getDraftMessageUploadLength(parts),
  };
}

/**
 * 使用 Gmail 的媒体上传，它最多可处理 35 MB 的邮件，
 * 而不是小得多的 JSON 请求限制。
 */
export async function uploadGmailDraftMessage(
  gmail: gmail_v1.Gmail,
  draft: { draftId?: string; threadId?: string | null },
  message: Buffer,
) {
  const { draftId, threadId } = draft;
  // 客户端的根 URL 不会应用到上传 URL，因此每次调用都传入它。
  const options = { rootUrl: gmail.context._options.rootUrl };
  const result = await withGmailRetry(() => {
    // 每次尝试都重新构建，因为重试需要新的流。
    const upload = {
      requestBody: { message: { threadId } },
      media: { mimeType: "message/rfc822", body: Readable.from(message) },
    };
    return draftId
      ? gmail.users.drafts.update(
          { userId: "me", id: draftId, ...upload },
          options,
        )
      : gmail.users.drafts.create({ userId: "me", ...upload }, options);
  });
  return result.data;
}

function draftMailOptions(
  current: GmailDraft,
  attachments: Mail.Attachment[],
  text?: DraftTextUpdate,
): Mail.Options {
  const html = text?.messageHtml ?? current.textHtml;
  return {
    from: text?.from || current.headers?.from,
    to: text?.to ?? current.headers?.to ?? "",
    cc: text?.cc ?? current.headers?.cc,
    bcc: text?.bcc ?? current.headers?.bcc,
    replyTo: current.headers?.["reply-to"],
    subject: text?.subject ?? current.subject ?? "",
    // 纯文本草稿保持为纯文本。
    ...(html == null
      ? { text: current.textPlain ?? "" }
      : { html, text: convertEmailHtmlToText({ htmlText: html }) }),
    attachments,
    inReplyTo: current.headers?.["in-reply-to"],
    references: current.headers?.references,
    headers: { "X-Mailer": "Inbox Zero Web" },
  };
}

async function getRequiredDraft(gmail: gmail_v1.Gmail, draftId: string) {
  const draft = await getDraft(draftId, gmail);
  if (!draft) throw draftNotFound();
  return draft;
}

function draftNotFound() {
  return new DraftNotFoundError(
    "此草稿在 Gmail 中已不可用。请先检查“已发送”文件夹，然后重试。",
  );
}
