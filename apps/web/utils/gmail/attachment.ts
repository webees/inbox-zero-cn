import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { decodeGmailAttachmentStream } from "./attachment-stream";
import type { Attachment } from "nodemailer/lib/mailer";
import type { gmail_v1 } from "@googleapis/gmail";
import { withGmailRetry } from "@/utils/gmail/retry";
import type { ParsedMessage } from "@/utils/types";
import type { DraftAttachment } from "@/utils/email/types";

const embeddedPartPrefix = "gmail-part:";
const maximumEmbeddedBytes = 25_000_000;

export async function getGmailAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
) {
  if (attachmentId.startsWith(embeddedPartPrefix)) {
    return readEmbeddedGmailAttachment(gmail, messageId, attachmentId);
  }
  const attachment = await withGmailRetry(() =>
    gmail.users.messages.attachments.get({
      userId: "me",
      id: attachmentId,
      messageId,
    }),
  );
  const attachmentData = attachment.data;
  return attachmentData;
}

export async function getGmailAttachmentStream(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (attachmentId.startsWith(embeddedPartPrefix)) {
    const attachment = await readEmbeddedGmailAttachment(
      gmail,
      messageId,
      attachmentId,
      signal,
    );
    return new ReadableStream({
      start(controller) {
        signal?.throwIfAborted();
        controller.enqueue(Buffer.from(attachment.data, "base64url"));
        controller.close();
      },
    });
  }
  const response = await withGmailRetry(() => {
    signal?.throwIfAborted();
    return gmail.users.messages.attachments.get(
      { userId: "me", id: attachmentId, messageId },
      { responseType: "stream", signal },
    );
  });
  if (signal?.aborted) {
    response.data.destroy();
    signal.throwIfAborted();
  }
  return decodeGmailAttachmentStream(
    // Node 的 web stream 类型是与 DOM 分开的声明。
    Readable.toWeb(response.data) as unknown as ReadableStream<Uint8Array>,
    signal,
  );
}

// Gmail 会在多次保存间保留该部分头，这为每个附件提供了一个
// 在 Gmail 替换草稿邮件后仍然存活的 id。
const ATTACHMENT_ID_HEADER = "X-Attachment-Id";

export type GmailAttachmentPart = {
  attachment: DraftAttachment;
  /** Small parts carry their bytes in the payload already. */
  data?: string;
};

/** The files in a message, by the rules every Gmail rebuild follows. */
export function listGmailAttachmentParts(
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): GmailAttachmentPart[] {
  const parts = collectAttachmentParts(payload);
  const usedIds = new Set(
    parts.flatMap((part) => {
      const id = partHeaders(part).get(ATTACHMENT_ID_HEADER.toLowerCase());
      return id ? [id] : [];
    }),
  );
  const seen = new Map<string, number>();
  return parts.map((part) => {
    const headers = partHeaders(part);
    const contentId = headers.get("content-id")?.trim().replace(/^<|>$/g, "");
    const disposition = partDisposition(part);
    const providerAttachmentId =
      part.body?.attachmentId ?? embeddedGmailAttachmentId(part.partId ?? "");
    const data = part.body?.attachmentId
      ? undefined
      : (part.body?.data ?? undefined);
    const filename = part.filename || "attachment";
    const mimeType = part.mimeType || "application/octet-stream";
    const size =
      part.body?.size ?? (data ? Buffer.byteLength(data, "base64url") : 0);
    return {
      attachment: {
        id:
          headers.get(ATTACHMENT_ID_HEADER.toLowerCase()) ??
          derivedAttachmentId(seen, usedIds, filename, mimeType, size),
        filename,
        mimeType,
        size,
        disposition:
          disposition === "inline" || (!disposition && contentId)
            ? "inline"
            : "attachment",
        ...(contentId ? { contentId } : {}),
        messageId,
        providerAttachmentId,
      },
      data,
    };
  });
}

/** Downloads the parts and prepares them to be written into a new message. */
export async function readGmailAttachmentParts(
  gmail: gmail_v1.Gmail,
  parts: GmailAttachmentPart[],
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  for (const { attachment, data } of parts) {
    const content =
      data ??
      (
        await getGmailAttachment(
          gmail,
          attachment.messageId,
          attachment.providerAttachmentId,
        )
      ).data;
    if (content == null) throw new Error("缺少 Gmail 附件数据");
    attachments.push(
      toGmailMailAttachment(attachment, Buffer.from(content, "base64url")),
    );
  }
  return attachments;
}

export async function getGmailMessageAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | null | undefined,
) {
  return readGmailAttachmentParts(
    gmail,
    listGmailAttachmentParts(messageId, payload),
  );
}

export function toGmailMailAttachment(
  attachment: Pick<
    DraftAttachment,
    "id" | "filename" | "mimeType" | "disposition" | "contentId"
  >,
  content: Buffer,
): Attachment {
  const inline = attachment.disposition === "inline" && attachment.contentId;
  return {
    filename: attachment.filename,
    contentType: attachment.mimeType,
    content,
    // 作为附件的邮件必须保持 7bit 或 8bit 编码（RFC 2046），因此由
    // 构建器来选择；其他所有文件都是 base64。
    ...(attachment.mimeType.startsWith("message/")
      ? {}
      : { contentTransferEncoding: "base64" }),
    contentDisposition: inline ? "inline" : "attachment",
    ...(inline ? { cid: attachment.contentId } : {}),
    headers: { [ATTACHMENT_ID_HEADER]: attachment.id },
  };
}

export function getEmbeddedGmailAttachmentDescriptors(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): NonNullable<ParsedMessage["attachments"]> {
  if (!payload) return [];
  if (payload.parts?.length) {
    return payload.parts.flatMap(getEmbeddedGmailAttachmentDescriptors);
  }
  if (
    payload.partId == null ||
    payload.body?.data == null ||
    payload.body.attachmentId ||
    !payload.mimeType
  )
    return [];
  const headers = new Map(
    payload.headers?.map(({ name, value }) => [name?.toLowerCase(), value]),
  );
  const disposition = headers
    .get("content-disposition")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const cid = headers.get("content-id");
  if (!cid && disposition !== "attachment") return [];
  const size = Buffer.byteLength(payload.body.data, "base64url");
  if (size > maximumEmbeddedBytes) return [];
  return [
    {
      attachmentId: embeddedGmailAttachmentId(payload.partId),
      filename: payload.filename ?? "",
      mimeType: payload.mimeType,
      size,
      headers: {
        "content-id": cid ?? "",
        "content-type": headers.get("content-type") ?? payload.mimeType,
        "content-disposition": headers.get("content-disposition") ?? "",
        "content-description": headers.get("content-description") ?? "",
        "content-transfer-encoding":
          headers.get("content-transfer-encoding") ?? "",
      },
    },
  ];
}

/** Small parts carry their bytes inline and have no Gmail attachment id. */
export function embeddedGmailAttachmentId(partId: string) {
  return embeddedPartPrefix + encodeURIComponent(partId);
}

async function readEmbeddedGmailAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
  signal?: AbortSignal,
) {
  let partId: string;
  try {
    partId = decodeURIComponent(attachmentId.slice(embeddedPartPrefix.length));
  } catch {
    throw Object.assign(new Error("Invalid Gmail MIME part reference"), {
      code: 404,
    });
  }
  const response = await withGmailRetry(() => {
    signal?.throwIfAborted();
    return gmail.users.messages.get(
      { userId: "me", id: messageId, format: "full" },
      { signal },
    );
  });
  signal?.throwIfAborted();
  const parts = response.data.payload ? [response.data.payload] : [];
  while (parts.length) {
    const part = parts.pop()!;
    if (
      part.partId === partId &&
      part.body?.data != null &&
      !part.body.attachmentId
    ) {
      const size = Buffer.byteLength(part.body.data, "base64url");
      if (size > maximumEmbeddedBytes)
        throw Object.assign(
          new Error("Embedded Gmail MIME part is too large"),
          { code: 413 },
        );
      return { data: part.body.data, size };
    }
    parts.push(...(part.parts ?? []));
  }
  throw Object.assign(new Error("Gmail MIME part no longer exists"), {
    code: 404,
  });
}

function collectAttachmentParts(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  // 作为附件的邮件是一个文件，而不是一组要解包的部分。
  if (payload.mimeType === "message/rfc822") return [payload];
  if (payload.parts?.length)
    return payload.parts.flatMap((part) => collectAttachmentParts(part));
  if (!payload.mimeType || payload.mimeType.startsWith("multipart/")) return [];
  const isBody =
    payload.mimeType === "text/plain" || payload.mimeType === "text/html";
  if (isBody && !payload.filename && partDisposition(payload) !== "attachment")
    return [];
  return [payload];
}

function partDisposition(part: gmail_v1.Schema$MessagePart) {
  return partHeaders(part)
    .get("content-disposition")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
}

function partHeaders(part: gmail_v1.Schema$MessagePart) {
  return new Map(
    (part.headers ?? []).map(({ name, value }) => [
      name?.toLowerCase(),
      value ?? undefined,
    ]),
  );
}

// 没有我们的 id 头的文件（由其他客户端写入，或从未重建过）
// 会从 Gmail 报告的关于它的信息中获取 id，因此在重建前后列出它会得到
// 与重建后写入头中的相同 id。
// 其他文件已携带的 id 会被跳过，因此相同的文件绝不会共享一个 id。
function derivedAttachmentId(
  seen: Map<string, number>,
  usedIds: Set<string>,
  filename: string,
  mimeType: string,
  size: number,
) {
  const key = JSON.stringify([filename, mimeType, size]);
  let occurrence = seen.get(key) ?? 0;
  let id: string;
  do {
    id = createHash("sha256")
      .update(`${key}:${occurrence}`)
      .digest("hex")
      .slice(0, 32);
    occurrence++;
  } while (usedIds.has(id));
  seen.set(key, occurrence);
  usedIds.add(id);
  return id;
}
