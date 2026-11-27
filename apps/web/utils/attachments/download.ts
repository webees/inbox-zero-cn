import { MAIL_PROTOCOL_VERSION } from "@inboxzero/mail-core/identities";
import { fetchWithAccount } from "@/utils/fetch";

export function getAttachmentUrl({
  accountId,
  messageId,
  attachmentId,
}: {
  accountId: string;
  messageId: string;
  attachmentId: string;
}) {
  const searchParams = new URLSearchParams({
    messageId,
    attachmentId,
    protocolVersion: String(MAIL_PROTOCOL_VERSION),
  });
  return `/api/mail/v1/accounts/${encodeURIComponent(accountId)}/attachment-content?${searchParams}`;
}

export function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // click() 可能在本轮之后开始下载；0ms 撤销会丢弃文件。
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

export async function fetchAttachment({
  url,
  emailAccountId,
  signal,
  maxBytes,
  onProgress,
}: {
  url: string;
  emailAccountId: string;
  signal?: AbortSignal;
  maxBytes?: number;
  onProgress?: (receivedBytes: number) => void;
}): Promise<Blob> {
  if (!emailAccountId) {
    throw new Error("需要邮箱账号 ID");
  }

  if (
    maxBytes !== undefined &&
    (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
  )
    throw new Error("附件下载大小上限无效");
  signal?.throwIfAborted();
  const response = await fetchWithAccount({
    url,
    emailAccountId,
    ...(signal ? { init: { signal } } : {}),
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("下载附件失败");
  }

  if (maxBytes === undefined && !onProgress) return response.blob();

  const limit = maxBytes ?? Number.POSITIVE_INFINITY;
  const sizeError = () => new Error("附件超过下载大小上限");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw sizeError();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    signal?.throwIfAborted();
    onProgress?.(0);
    return new Blob([], { type: response.headers.get("content-type") ?? "" });
  }
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let buffer: Uint8Array<ArrayBuffer> | undefined;
  let bufferedBytes = 0;
  let receivedBytes = 0;
  try {
    signal?.throwIfAborted();
    onProgress?.(0);
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value.byteLength > limit - receivedBytes) throw sizeError();
      // 合并细小的传输分块，以使其对象开销保持有界。
      let offset = 0;
      while (offset < value.byteLength) {
        buffer ??= new Uint8Array(Math.min(64 * 1024, limit));
        const length = Math.min(
          buffer.byteLength - bufferedBytes,
          value.byteLength - offset,
        );
        buffer.set(value.subarray(offset, offset + length), bufferedBytes);
        offset += length;
        bufferedBytes += length;
        if (bufferedBytes === buffer.byteLength) {
          chunks.push(buffer);
          buffer = undefined;
          bufferedBytes = 0;
        }
      }
      receivedBytes += value.byteLength;
      onProgress?.(receivedBytes);
    }
    if (buffer) chunks.push(buffer.subarray(0, bufferedBytes));
    return new Blob(chunks, {
      type: response.headers.get("content-type") ?? "",
    });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
