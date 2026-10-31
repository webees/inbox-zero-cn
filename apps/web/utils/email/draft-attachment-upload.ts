import { EMAIL_ATTACHMENT_LIMITS } from "@inboxzero/email-editor/core";
import { SafeError } from "@/utils/error";

/**
 * 由浏览器和服务器共享：写信器附件如何传输到
 * 邮箱草稿，而双方都不保留字节。
 *
 * 发送到我们服务器的每个请求都必须保持在 4.5 MB 的函数负载上限之下，
 * 因此达到或超过直接上限的文件会经过服务商上传会话。
 */
export const DRAFT_ATTACHMENT_DIRECT_UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024;

const GMAIL_UPLOAD_GRANULARITY_BYTES = 256 * 1024;
export const GMAIL_UPLOAD_CHUNK_BYTES = 16 * GMAIL_UPLOAD_GRANULARITY_BYTES;

// Graph 要求每个上传会话范围小于 4 MB。
export const GRAPH_UPLOAD_CHUNK_BYTES = 10 * 320 * 1024;

const MIME_BASE64_LINE_LENGTH = 76;
const MIME_LINE_BREAK = "\r\n";

export type DraftMessageUploadPart =
  | { type: "text"; text: string }
  | {
      type: "attachment";
      attachmentId: string;
      size: number;
      /** 草稿已持有的附件从哪里读取。 */
      source?: { messageId: string; providerAttachmentId: string };
    };

/** 撰写器的文件数量与总大小限制，在草稿上强制执行。 */
export function assertDraftAttachmentLimits(
  existing: { size: number }[],
  size: number,
) {
  const totalBytes = existing.reduce((total, file) => total + file.size, size);
  if (existing.length + 1 > EMAIL_ATTACHMENT_LIMITS.maxFiles)
    throw new SafeError(
      `最多只能附加 ${EMAIL_ATTACHMENT_LIMITS.maxFiles} 个文件。`,
    );
  if (totalBytes > EMAIL_ATTACHMENT_LIMITS.maxTotalBytes)
    throw new SafeError("附件合计不得超过 15 MB。");
}

export function usesDirectDraftAttachmentUpload(size: number) {
  return size < DRAFT_ATTACHMENT_DIRECT_UPLOAD_LIMIT_BYTES;
}

/** `byteLength` 字节按 CRLF 换行封装成 MIME base64 后的长度。 */
export function mimeBase64Length(byteLength: number) {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  if (encodedLength === 0) return 0;
  const lineBreaks = Math.ceil(encodedLength / MIME_BASE64_LINE_LENGTH) - 1;
  return encodedLength + lineBreaks * MIME_LINE_BREAK.length;
}

export function encodeMimeBase64(bytes: Uint8Array) {
  const lines: string[] = [];
  const bytesPerLine = (MIME_BASE64_LINE_LENGTH / 4) * 3;
  for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
    lines.push(encodeBase64(bytes.subarray(offset, offset + bytesPerLine)));
  }
  return lines.join(MIME_LINE_BREAK);
}

// 客户端以 UTF-8 上传组装好的邮件，因此文本按字节计数。
const utf8Encoder = new TextEncoder();

export function getDraftMessageUploadLength(parts: DraftMessageUploadPart[]) {
  return parts.reduce(
    (total, part) =>
      total +
      (part.type === "text"
        ? utf8Encoder.encode(part.text).byteLength
        : mimeBase64Length(part.size)),
    0,
  );
}

/**
 * Gmail 接受 256 KiB 倍数（最后一块除外）的可续传分块，且
 * 每一块都会经过我们的服务器，因此它也必须能放入单个请求。
 */
export function validateGmailUploadChunk({
  start,
  length,
  totalBytes,
  expectedStart,
}: {
  start: number;
  length: number;
  totalBytes: number;
  expectedStart: number;
}): { valid: true } | { valid: false; error: string } {
  if (start !== expectedStart)
    return { valid: false, error: "上传分块顺序错误。" };
  if (length <= 0 || length > GMAIL_UPLOAD_CHUNK_BYTES)
    return { valid: false, error: "上传分块大小无效。" };
  const end = start + length;
  if (end > totalBytes)
    return { valid: false, error: "上传分块超出了消息范围。" };
  if (end < totalBytes && length % GMAIL_UPLOAD_GRANULARITY_BYTES !== 0)
    return { valid: false, error: "上传分块大小无效。" };
  return { valid: true };
}

export function parseContentRange(header: string | null) {
  const match = header?.match(/^bytes (\d+)-(\d+)\/(\d+)$/u);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    end < start
  )
    return null;
  return { start, length: end - start + 1, total };
}

function encodeBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined")
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
