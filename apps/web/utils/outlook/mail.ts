import type { Message, UploadSession } from "@microsoft/microsoft-graph-types";
import type { OutlookClient } from "@/utils/outlook/client";
import type { Attachment } from "nodemailer/lib/mailer";
import type { SendEmailBody, WithMailerAttachments } from "@/utils/types/mail";
import type { ParsedMessage } from "@/utils/types";
import type { EmailForAction } from "@/utils/ai/types";
import { createOutlookReplyContent } from "@/utils/outlook/reply";
import { textToHtmlParagraphs } from "@/utils/string";
import { forwardEmailHtml, forwardEmailSubject } from "@/utils/gmail/forward";
import {
  buildReplyAllRecipients,
  mergeAndDedupeRecipients,
} from "@/utils/email/reply-all";
import {
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";
import { extractEmailAddress, extractNameFromEmail } from "@/utils/email";
import { isOutlookItemNotFoundError, SafeError } from "@/utils/error";
import { ensureEmailSendingEnabled } from "@/utils/mail";
import { uploadResumableChunks } from "@/utils/outlook/upload-session";
import type { Logger } from "@/utils/logger";
import type { SendEmailOptions } from "@/utils/email/types";

type GraphRecipient = {
  emailAddress: { address: string; name?: string };
};
type MailSendEmailBody = WithMailerAttachments<SendEmailBody>;

const MAX_GRAPH_ATTACHMENT_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_GRAPH_UPLOAD_SESSION_SIZE_BYTES = 150 * 1024 * 1024;
const GRAPH_UPLOAD_CHUNK_SIZE_BYTES = 320 * 1024;
type SentEmailResult = Pick<Message, "id" | "conversationId">;

export async function sendEmailWithHtml(
  client: OutlookClient,
  body: MailSendEmailBody,
  logger: Logger,
  options?: SendEmailOptions,
): Promise<SentEmailResult> {
  ensureEmailSendingEnabled();

  const toRecipients = buildGraphRecipients(body.to);
  if (!toRecipients?.length)
    throw new SafeError("Recipient address is required");

  // 对于带 message ID 的回复，使用 createReply 以正确建立会话关联
  // Microsoft Graph 的 sendMail 不支持 In-Reply-To/References 头
  if (body.replyToEmail?.messageId) {
    return sendReplyUsingCreateReply(client, body, logger, options);
  }

  if (body.replyToEmail?.forwardedMessageId) {
    return sendForwardUsingCreateForward(
      client,
      body,
      body.replyToEmail.forwardedMessageId,
      logger,
    );
  }

  return sendNewDraft(client, body, logger);
}

export async function sendEmailWithPlainText(
  client: OutlookClient,
  body: Omit<MailSendEmailBody, "messageHtml"> & { messageText: string },
  logger: Logger,
) {
  const messageHtml = convertTextToHtmlParagraphs(body.messageText);
  return sendEmailWithHtml(client, { ...body, messageHtml }, logger);
}

export async function replyToEmail(
  client: OutlookClient,
  message: EmailForAction,
  reply: string,
  logger: Logger,
  options?: {
    replyTo?: string;
    from?: string;
    attachments?: Attachment[];
  },
) {
  ensureEmailSendingEnabled();

  const { html } = createOutlookReplyContent({
    textContent: reply,
    message,
  });

  // 使用 createReply 创建正确建立会话关联的草稿
  // Microsoft Graph 的 sendMail 不支持设置 In-Reply-To/References 头
  // 只有 createReply/createReplyAll 端点能确保正确的会话关联
  const replyDraft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      client.getClient().api(`/me/messages/${message.id}/createReply`).post({}),
    logger,
  );

  const fromField = buildGraphFromField(
    options?.from,
    replyDraft.from?.emailAddress?.address,
  );

  // 用我们的内容更新草稿
  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${replyDraft.id}`)
        .patch({
          body: {
            contentType: "html",
            content: html,
          },
          ...(fromField ? { from: fromField } : {}),
          ...(options?.replyTo
            ? {
                replyTo: [{ emailAddress: { address: options.replyTo } }],
              }
            : {}),
        }),
    logger,
  );

  if (options?.attachments?.length) {
    await addAttachmentsToDraft({
      client,
      draftId: replyDraft.id || "",
      attachments: options.attachments,
      logger,
    });
  }

  // 发送草稿
  await withMicrosoftGraphWriteRetry(
    () => client.getClient().api(`/me/messages/${replyDraft.id}/send`).post({}),
    logger,
  );

  return {
    id: replyDraft.id,
    conversationId: replyDraft.conversationId,
  };
}

export async function forwardEmail(
  client: OutlookClient,
  options: {
    messageId: string;
    to: string;
    cc?: string;
    bcc?: string;
    content?: string;
    from?: string;
  },
  logger: Logger,
) {
  ensureEmailSendingEnabled();

  if (!options.to.trim()) throw new Error("需要收件人地址");

  const toRecipients = buildGraphRecipients(options.to);
  if (!toRecipients?.length) throw new Error("需要收件人地址");
  const ccRecipients = buildGraphRecipients(options.cc);
  const bccRecipients = buildGraphRecipients(options.bcc);

  // 获取原始邮件
  const originalMessage: Message = await withMicrosoftGraphRetry(
    () => client.getClient().api(`/me/messages/${options.messageId}`).get(),
    logger,
  );

  const message: ParsedMessage = {
    id: originalMessage.id || "",
    threadId: originalMessage.conversationId || "",
    snippet: originalMessage.bodyPreview || "",
    textPlain: originalMessage.body?.content || "",
    textHtml: originalMessage.body?.content || "",
    headers: {
      from: originalMessage.from?.emailAddress?.address || "",
      to: originalMessage.toRecipients?.[0]?.emailAddress?.address || "",
      subject: originalMessage.subject || "",
      date: originalMessage.receivedDateTime || new Date().toISOString(),
    },
    historyId: "",
    inline: [],
    internalDate: originalMessage.receivedDateTime || new Date().toISOString(),
    subject: originalMessage.subject || "",
    date: originalMessage.receivedDateTime || new Date().toISOString(),
    conversationIndex: originalMessage.conversationId || "",
  };

  const forwardDraft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${options.messageId}/createForward`)
        .post({}),
    logger,
  );

  const fromField = buildGraphFromField(
    options.from,
    forwardDraft.from?.emailAddress?.address,
  );

  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${forwardDraft.id}`)
        .patch({
          toRecipients,
          ...(ccRecipients ? { ccRecipients } : {}),
          ...(bccRecipients ? { bccRecipients } : {}),
          ...(fromField ? { from: fromField } : {}),
          subject: forwardEmailSubject(message.headers.subject),
          body: {
            contentType: "html",
            content: forwardEmailHtml({
              content: options.content ?? "",
              message,
            }),
          },
        }),
    logger,
  );

  await withMicrosoftGraphWriteRetry(
    () =>
      client.getClient().api(`/me/messages/${forwardDraft.id}/send`).post({}),
    logger,
  );

  return {
    id: forwardDraft.id,
    conversationId: forwardDraft.conversationId,
  };
}

export async function draftEmail(
  client: OutlookClient,
  originalEmail: EmailForAction,
  args: {
    to?: string;
    subject?: string;
    content: string;
    cc?: string;
    bcc?: string;
    attachments?: Attachment[];
  },
  userEmails: string | string[],
  logger: Logger,
) {
  const { html } = createOutlookReplyContent({
    textContent: args.content,
    message: originalEmail,
  });

  const recipients = buildReplyAllRecipients(
    originalEmail.headers,
    args.to,
    userEmails,
  );

  const overrideToRecipient = args.to
    ? {
        emailAddress: {
          address: extractEmailAddress(recipients.to),
          name: extractNameFromEmail(recipients.to),
        },
      }
    : undefined;

  const fallbackToRecipient = {
    emailAddress: {
      address: extractEmailAddress(recipients.to),
      name: extractNameFromEmail(recipients.to),
    },
  };

  const toRecipient =
    overrideToRecipient ??
    originalEmail.rawRecipients?.from ??
    fallbackToRecipient;

  // 从回复全部参数和实参构建 CC 列表
  const ccAddresses = mergeAndDedupeRecipients(recipients.cc, args.cc);

  // 将 CC 地址转换为 Outlook 格式
  const ccRecipients = ccAddresses.map((addr) => ({
    emailAddress: {
      address: extractEmailAddress(addr),
      name: extractNameFromEmail(addr),
    },
  }));

  // 如果提供了 BCC 则处理
  const bccAddresses = mergeAndDedupeRecipients([], args.bcc);
  const bccRecipients = bccAddresses.map((addr) => ({
    emailAddress: {
      address: extractEmailAddress(addr),
      name: extractNameFromEmail(addr),
    },
  }));

  // 创建草稿前获取原始邮件的 isRead 状态
  // Microsoft Graph 的 createReplyAll 会自动将原始邮件标记为已读
  const originalMessage: Message = await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${originalEmail.id}`)
        .select("isRead")
        .get(),
    logger,
  );
  const wasUnread = originalMessage.isRead === false;

  // 使用 createReplyAll 端点创建正确的回复草稿
  // 这确保草稿作为回复全部链接到原始邮件
  const replyDraft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${originalEmail.id}/createReplyAll`)
        .post({}),
    logger,
  );

  // 用我们的内容更新草稿
  const updateRequest = client.getClient().api(`/me/messages/${replyDraft.id}`);

  // 用于处理 change key 错误
  const etag = (replyDraft as { "@odata.etag"?: string })?.["@odata.etag"];
  if (etag) {
    updateRequest.header("If-Match", etag);
  }

  const updatedDraft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      updateRequest.patch({
        subject: args.subject || originalEmail.headers.subject,
        body: {
          contentType: "html",
          content: html,
        },
        toRecipients: [toRecipient],
        ccRecipients,
        bccRecipients,
      }),
    logger,
  );

  if (args.attachments?.length) {
    await addAttachmentsToDraft({
      client,
      draftId: replyDraft.id || updatedDraft.id || "",
      attachments: args.attachments,
      logger,
    });
  }

  // 如果原始邮件之前未读，则恢复其未读状态
  // createReplyAll 会自动将原始邮件标记为已读
  if (wasUnread) {
    await withMicrosoftGraphWriteRetry(
      () =>
        client
          .getClient()
          .api(`/me/messages/${originalEmail.id}`)
          .patch({ isRead: false }),
      logger,
    );
  }

  // 使用原始 replyDraft.id，因为那是稳定的 ID
  // PATCH 响应可能并不总是包含完整对象？
  return { ...updatedDraft, id: replyDraft.id };
}

function convertTextToHtmlParagraphs(text?: string | null): string {
  if (!text) return "";

  return `<html><body>${textToHtmlParagraphs(text)}</body></html>`;
}

async function sendReplyUsingCreateReply(
  client: OutlookClient,
  body: MailSendEmailBody,
  logger: Logger,
  options?: SendEmailOptions,
): Promise<SentEmailResult> {
  const originalMessageId = body.replyToEmail!.messageId!;

  // 使用 createReply 创建正确建立会话关联的草稿
  // Microsoft Graph 的 createReply 会自动设置 In-Reply-To 和 References 头
  // 基于原始邮件，确保跨邮件服务商的正确会话关联
  const replyDraft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${originalMessageId}/createReply`)
        .post({}),
    logger,
  );

  const toRecipients = buildGraphRecipients(body.to);
  const ccRecipients = buildGraphRecipients(body.cc);
  const bccRecipients = buildGraphRecipients(body.bcc);

  // 用我们的内容和收件人更新草稿
  // 注意：我们无法通过 internetMessageHeaders 设置 In-Reply-To/References 头
  // 因为 Microsoft Graph 在那里只允许自定义头（以 x- 开头）。
  // createReply 端点会自动处理标准会话头。
  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${replyDraft.id}`)
        .patch({
          // 当回复主题改变时 Exchange 会开始新会话。
          ...(options?.preserveThreadSubject ? {} : { subject: body.subject }),
          body: {
            contentType: "html",
            content: body.messageHtml,
          },
          ...(toRecipients ? { toRecipients } : {}),
          ...(ccRecipients ? { ccRecipients } : {}),
          ...(bccRecipients ? { bccRecipients } : {}),
        }),
    logger,
  );

  if (body.attachments?.length) {
    await addAttachmentsToDraft({
      client,
      draftId: replyDraft.id || "",
      attachments: body.attachments,
      logger,
    });
  }

  // 发送草稿
  await withMicrosoftGraphWriteRetry(
    () => client.getClient().api(`/me/messages/${replyDraft.id}/send`).post({}),
    logger,
  );

  return {
    id: replyDraft.id,
    conversationId: replyDraft.conversationId,
  };
}

/**
 * Graph 将 `conversationId` 视为只读，因此发布到
 * `/me/messages` 的草稿总是开启新会话。基于被转发
 * 邮件创建草稿是将转发保留在其原会话中的唯一方式，且它
 * 还会将原始附件一并带上。
 */
async function sendForwardUsingCreateForward(
  client: OutlookClient,
  body: MailSendEmailBody,
  forwardedMessageId: string,
  logger: Logger,
): Promise<SentEmailResult> {
  const forwardDraft = await createForwardDraft(
    client,
    forwardedMessageId,
    logger,
  );
  const toRecipients = buildGraphRecipients(body.to);
  const ccRecipients = buildGraphRecipients(body.cc);
  const bccRecipients = buildGraphRecipients(body.bcc);

  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${forwardDraft.id}`)
        .patch({
          subject: body.subject,
          body: {
            contentType: "html",
            content: body.messageHtml,
          },
          ...(toRecipients ? { toRecipients } : {}),
          ...(ccRecipients ? { ccRecipients } : {}),
          ...(bccRecipients ? { bccRecipients } : {}),
        }),
    logger,
  );

  if (body.attachments?.length) {
    await addAttachmentsToDraft({
      client,
      draftId: forwardDraft.id || "",
      attachments: body.attachments,
      logger,
    });
  }

  await withMicrosoftGraphWriteRetry(
    () =>
      client.getClient().api(`/me/messages/${forwardDraft.id}/send`).post({}),
    logger,
  );

  return {
    id: forwardDraft.id,
    conversationId: forwardDraft.conversationId,
  };
}

async function createForwardDraft(
  client: OutlookClient,
  forwardedMessageId: string,
  logger: Logger,
): Promise<Message> {
  try {
    return await withMicrosoftGraphWriteRetry(
      () =>
        client
          .getClient()
          .api(`/me/messages/${forwardedMessageId}/createForward`)
          .post({}),
      logger,
    );
  } catch (error) {
    if (!isOutlookItemNotFoundError(error)) throw error;
    throw new SafeError(
      "Reload the original message before forwarding. Its attachments could not be verified.",
    );
  }
}

/**
 * 在发送前创建草稿会返回会话 id，
 * 而 `sendMail` 将其隐藏在空的 202 响应之后。
 */
async function sendNewDraft(
  client: OutlookClient,
  body: MailSendEmailBody,
  logger: Logger,
): Promise<SentEmailResult> {
  const toRecipients = buildGraphRecipients(body.to);
  const ccRecipients = buildGraphRecipients(body.cc);
  const bccRecipients = buildGraphRecipients(body.bcc);
  const replyToRecipients = buildGraphRecipients(body.replyTo);

  const draft: Message = await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api("/me/messages")
        .post({
          subject: body.subject,
          body: {
            contentType: "html",
            content: body.messageHtml,
          },
          toRecipients,
          ...(ccRecipients ? { ccRecipients } : {}),
          ...(bccRecipients ? { bccRecipients } : {}),
          ...(replyToRecipients ? { replyTo: replyToRecipients } : {}),
        }),
    logger,
  );

  if (body.attachments?.length) {
    await addAttachmentsToDraft({
      client,
      draftId: draft.id || "",
      attachments: body.attachments,
      logger,
    });
  }

  await withMicrosoftGraphWriteRetry(
    () => client.getClient().api(`/me/messages/${draft.id}/send`).post({}),
    logger,
  );

  return {
    id: draft.id,
    conversationId: draft.conversationId,
  };
}

function buildGraphRecipients(
  recipientList?: string,
): GraphRecipient[] | undefined {
  if (!recipientList) return;

  const parts = recipientList.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const recipients = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): GraphRecipient | null => {
      const address = extractEmailAddress(part);
      if (!address) return null;

      const name = extractNameFromEmail(part).trim();
      return {
        emailAddress: {
          address,
          ...(name && name !== address ? { name } : {}),
        },
      };
    })
    .filter((recipient): recipient is GraphRecipient => recipient !== null);

  if (!recipients.length) return;

  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = recipient.emailAddress.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGraphFromField(
  formattedFrom?: string,
  fallbackAddress?: string | null,
) {
  if (!formattedFrom) return;

  const address = extractEmailAddress(formattedFrom) || fallbackAddress;
  if (!address) return;

  const name = extractNameFromEmail(formattedFrom).trim();

  return {
    emailAddress: {
      address,
      ...(name && name !== address ? { name } : {}),
    },
  };
}

export async function addAttachmentsToDraft({
  client,
  draftId,
  attachments,
  logger,
}: {
  client: OutlookClient;
  draftId: string;
  attachments: Attachment[];
  logger: Logger;
}) {
  if (!draftId) return;

  for (const attachment of attachments) {
    const result = getAttachmentContent(attachment.content);
    if (!result) continue;
    const { buffer, base64 } = result;
    if (buffer.length <= MAX_GRAPH_ATTACHMENT_SIZE_BYTES) {
      await withMicrosoftGraphWriteRetry(
        () =>
          client
            .getClient()
            .api(`/me/messages/${draftId}/attachments`)
            .post({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachment.filename || "attachment.pdf",
              contentType: attachment.contentType || "application/octet-stream",
              contentBytes: base64 ?? buffer.toString("base64"),
              ...(attachment.cid
                ? { contentId: attachment.cid, isInline: true }
                : {}),
            }),
        logger,
      );
      continue;
    }

    assertGraphAttachmentSizeSupported({ attachment, content: buffer });
    await uploadAttachmentViaSession({
      client,
      draftId,
      attachment,
      content: buffer,
      logger,
    });
  }
}

function getAttachmentContent(
  content: Attachment["content"],
): { buffer: Buffer; base64: string | null } | null {
  if (Buffer.isBuffer(content)) return { buffer: content, base64: null };
  if (typeof content === "string") return decodeAttachmentString(content);
  return null;
}

function assertGraphAttachmentSizeSupported({
  attachment,
  content,
}: {
  attachment: Attachment;
  content: Buffer;
}) {
  if (content.length <= MAX_GRAPH_UPLOAD_SESSION_SIZE_BYTES) return;

  throw new Error(
    `Outlook attachments larger than 150 MB are not supported: ${
      attachment.filename || "attachment"
    }`,
  );
}

function decodeAttachmentString(content: string): {
  buffer: Buffer;
  base64: string | null;
} {
  const normalized = content.trim().replace(/\s+/g, "");
  if (looksLikeBase64(normalized)) {
    const decoded = Buffer.from(normalized, "base64");
    if (isCanonicalBase64Match(normalized, decoded)) {
      return { buffer: decoded, base64: normalized };
    }
  }

  return { buffer: Buffer.from(content, "utf8"), base64: null };
}

function looksLikeBase64(value: string) {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isCanonicalBase64Match(value: string, decoded: Buffer) {
  return (
    decoded.toString("base64").replace(/=+$/u, "") === value.replace(/=+$/u, "")
  );
}

async function uploadAttachmentViaSession({
  client,
  draftId,
  attachment,
  content,
  logger,
}: {
  client: OutlookClient;
  draftId: string;
  attachment: Attachment;
  content: Buffer;
  logger: Logger;
}) {
  const uploadSession = await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/messages/${draftId}/attachments/createUploadSession`)
        .post({
          AttachmentItem: {
            attachmentType: "file",
            name: attachment.filename || "attachment.pdf",
            contentType: attachment.contentType || "application/octet-stream",
            size: content.length,
            ...(attachment.cid
              ? { contentId: attachment.cid, isInline: true }
              : {}),
          },
        }),
    logger,
  );

  const uploadUrl = (uploadSession as UploadSession).uploadUrl;
  if (!uploadUrl) {
    throw new Error("创建 Outlook 附件上传会话失败");
  }

  await uploadResumableChunks({
    uploadUrl,
    content,
    chunkSizeBytes: GRAPH_UPLOAD_CHUNK_SIZE_BYTES,
    logger,
    action: "upload Outlook attachment chunk",
    statusAction: "fetch Outlook upload session status",
  });
}
