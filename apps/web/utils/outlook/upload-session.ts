import type { UploadSession } from "@microsoft/microsoft-graph-types";
import type { Logger } from "@/utils/logger";
import { withMicrosoftGraphRetry } from "@/utils/outlook/retry";

// 单请求上限，使挂起的连接最多只会让上传停滞这么
// 长时间。分块上传已通过
// `withMicrosoftGraphRetry` 重试瞬时失败。
const UPLOAD_SESSION_REQUEST_TIMEOUT_MS = 60_000;

/**
 * 将 Buffer 分块上传到 Microsoft Graph 上传会话。
 *
 * 由 Outlook 附件上传和 OneDrive 文件上传共享。两者使用
 * 相同的协议（带 Content-Range 的 PUT 分块，从
 * `nextExpectedRanges` 恢复），但每种资源有自己的分块大小限制：
 * - Outlook 附件会话：该调用方使用 320 KiB 分块
 * - Drive 上传会话：分块必须是 320 KiB 的倍数
 *
 * 在可用时返回最终响应。如果重试证明最终分块在响应丢失后
 * 已被接受，则返回已提交的结果，以便调用方恢复
 * 所创建的资源。
 *
 * 如果任何分块失败，会话会通过 DELETE 取消，以免 Microsoft
 * 将其保持活跃长达 48 小时，或在重试时暴露不完整的项目。
 */
export async function uploadResumableChunks({
  uploadUrl,
  content,
  chunkSizeBytes,
  logger,
  action,
  statusAction,
}: {
  uploadUrl: string;
  content: Buffer;
  chunkSizeBytes: number;
  logger: Logger;
  action: string;
  statusAction: string;
}): Promise<UploadResult> {
  let start = 0;
  try {
    while (start < content.length) {
      const end = Math.min(start + chunkSizeBytes, content.length);
      const chunk = content.subarray(start, end);
      const result = await withMicrosoftGraphRetry(
        () =>
          uploadChunk({
            uploadUrl,
            chunk,
            start,
            end,
            totalSize: content.length,
            chunkSizeBytes,
            action,
            statusAction,
          }),
        logger,
      );

      if (result.kind !== "progress") {
        return result;
      }

      start = result.nextStart;
    }

    throw new Error(
      `Failed to ${action}: upload session ended without returning the created item`,
    );
  } catch (error) {
    // 尽力清理：删除会话是文档化的取消方式。
    await cancelUploadSession(uploadUrl).catch(() => undefined);
    throw error;
  }
}

type ChunkUploadResult =
  | { kind: "complete"; response: Response }
  | { kind: "progress"; nextStart: number }
  | { kind: "committed" };

type UploadResult =
  | { kind: "complete"; response: Response }
  | { kind: "committed" };

async function uploadChunk({
  uploadUrl,
  chunk,
  start,
  end,
  totalSize,
  chunkSizeBytes,
  action,
  statusAction,
}: {
  uploadUrl: string;
  chunk: Buffer;
  start: number;
  end: number;
  totalSize: number;
  chunkSizeBytes: number;
  action: string;
  statusAction: string;
}): Promise<ChunkUploadResult> {
  const response = await fetchUploadSession(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`,
    },
    body:
      chunk.buffer instanceof ArrayBuffer
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk),
    signal: AbortSignal.timeout(UPLOAD_SESSION_REQUEST_TIMEOUT_MS),
  });

  if (response.status === 201) {
    return { kind: "complete", response };
  }

  if (response.status === 200) {
    // 当 200 携带 nextExpectedRanges 时是进度响应，但对于
    // 最后一个范围，响应体返回的是所创建的资源
    // （Microsoft 文档说明最后一个范围为 201 Created 或 200 OK）。
    // 通过克隆来查看响应体，以便调用方仍能读取它。
    const uploadStatus = (await response.clone().json()) as UploadSessionStatus;
    const nextStart = getNextExpectedRangeStart(
      uploadStatus.nextExpectedRanges,
    );
    if (typeof nextStart === "number") {
      return {
        kind: "progress",
        nextStart: await ensureMonotonicProgress({
          nextStart,
          chunkSizeBytes,
          totalSize,
          uploadUrl,
          statusAction,
          start,
        }),
      };
    }

    if (typeof uploadStatus.id !== "string" || !uploadStatus.id) {
      throw new Error("上传会话返回 200，但没有 nextExpectedRanges 或已创建项");
    }

    return { kind: "complete", response };
  }

  if (response.status === 202) {
    const uploadStatus = (await response.json()) as UploadSessionStatus;
    const nextStart = getNextExpectedRangeStart(
      uploadStatus.nextExpectedRanges,
    );
    if (typeof nextStart !== "number") {
      throw new Error("上传会话返回 202 但未包含 nextExpectedRanges");
    }

    return {
      kind: "progress",
      nextStart: await ensureMonotonicProgress({
        nextStart,
        chunkSizeBytes,
        totalSize,
        uploadUrl,
        statusAction,
        start,
      }),
    };
  }

  if (response.status === 416) {
    const nextStart = await resolveResumeRange({
      chunkSizeBytes,
      totalSize,
      uploadUrl,
      statusAction,
      start,
      unavailableNextStart: end,
    });

    if (nextStart === totalSize) {
      return { kind: "committed" };
    }

    return {
      kind: "progress",
      nextStart,
    };
  }

  return await throwUploadSessionResponseError(response, action);
}

// 服务器通过 `nextExpectedRanges` 报告从哪里继续，文档
// 警告这并不保证列出每个范围。未能推进，或仅推进了部分
// 分块（否则一次一字节将意味着 O(n) 次请求）的响应不被
// 信任：像 416 一样从会话状态恢复，并在服务器未提供
// 可用范围时抛出错误。
async function ensureMonotonicProgress({
  nextStart,
  chunkSizeBytes,
  totalSize,
  uploadUrl,
  statusAction,
  start,
}: {
  nextStart: number;
  chunkSizeBytes: number;
  totalSize: number;
  uploadUrl: string;
  statusAction: string;
  start: number;
}): Promise<number> {
  if (isTrustedProgress(nextStart, start, chunkSizeBytes, totalSize)) {
    return nextStart;
  }

  return await resolveResumeRange({
    chunkSizeBytes,
    totalSize,
    uploadUrl,
    statusAction,
    start,
  });
}

async function resolveResumeRange({
  chunkSizeBytes,
  totalSize,
  uploadUrl,
  statusAction,
  start,
  unavailableNextStart,
}: {
  chunkSizeBytes: number;
  totalSize: number;
  uploadUrl: string;
  statusAction: string;
  start: number;
  unavailableNextStart?: number;
}): Promise<number> {
  const uploadStatus = await getUploadSessionStatus(uploadUrl, statusAction);
  if (!uploadStatus) {
    if (typeof unavailableNextStart === "number") {
      return unavailableNextStart;
    }
    throw new Error("上传会话状态不可用");
  }

  const nextStart = getNextExpectedRangeStart(uploadStatus.nextExpectedRanges);
  if (
    typeof nextStart === "number" &&
    isTrustedProgress(nextStart, start, chunkSizeBytes, totalSize)
  ) {
    return nextStart;
  }

  throw new Error("上传会话没有进展（没有可用的续传范围）");
}

// 仅信任分块对齐的范围：上传始终从分块对齐的偏移
// 发送完整分块，且文档化的服务器从分块边界（或
// 文件末尾）恢复。
function isTrustedProgress(
  nextStart: number,
  start: number,
  chunkSizeBytes: number,
  totalSize: number,
): boolean {
  return (
    nextStart > start &&
    (nextStart === totalSize || nextStart % chunkSizeBytes === 0)
  );
}

interface UploadSessionStatus
  extends Pick<UploadSession, "nextExpectedRanges"> {
  id?: unknown;
}

async function getUploadSessionStatus(
  uploadUrl: string,
  statusAction: string,
): Promise<UploadSessionStatus | null> {
  const response = await fetchUploadSession(uploadUrl, {
    method: "GET",
    signal: AbortSignal.timeout(UPLOAD_SESSION_REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404 || response.status === 405) {
    return null;
  }

  if (!response.ok) {
    return await throwUploadSessionResponseError(response, statusAction);
  }

  return (await response.json()) as UploadSessionStatus;
}

async function cancelUploadSession(uploadUrl: string): Promise<void> {
  await fetchUploadSession(uploadUrl, {
    method: "DELETE",
    signal: AbortSignal.timeout(UPLOAD_SESSION_REQUEST_TIMEOUT_MS),
  });
}

async function fetchUploadSession(
  uploadUrl: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(uploadUrl, init);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new TypeError("fetch failed", { cause: error });
    }
    throw error;
  }
}

function getNextExpectedRangeStart(nextExpectedRanges?: string[] | null) {
  const nextRange = nextExpectedRanges?.[0];
  if (!nextRange) return null;

  const [rangeStart] = nextRange.split("-");
  if (!rangeStart) return null;

  const parsedRangeStart = Number(rangeStart);
  return Number.isSafeInteger(parsedRangeStart) && parsedRangeStart >= 0
    ? parsedRangeStart
    : null;
}

async function throwUploadSessionResponseError(
  response: Response,
  action: string,
): Promise<never> {
  const errorText = await response.text();
  const error = new Error(
    `Failed to ${action}: ${response.status} ${errorText || response.statusText}`,
  );
  Object.assign(error, {
    status: response.status,
    body: errorText,
    response: { headers: response.headers, status: response.status },
  });
  throw error;
}
