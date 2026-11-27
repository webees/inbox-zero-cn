import { isDefined } from "@/utils/types";
import { getGoogleGmailBatchUrl } from "@/utils/gmail/oauth";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("gmail/batch");

const BATCH_LIMIT = 100;

// 使用 Gmail 批量 API 在一次请求中获取多个响应
// https://developers.google.com/gmail/api/guides/batch
export async function getBatch(
  ids: string[],
  endpoint: string, // e.g. /gmail/v1/users/me/messages
  accessToken: string,
  queryString?: string,
) {
  if (!ids.length) return [];
  if (ids.length > BATCH_LIMIT) {
    throw new Error(
      `Request count exceeds the limit. Received: ${ids.length}, Limit: ${BATCH_LIMIT}`,
    );
  }

  let batchRequestBody = "";
  const query = queryString ? `?${queryString}` : "";
  for (const id of ids) {
    batchRequestBody += `--batch_boundary\nContent-Type: application/http\n\nGET ${endpoint}/${encodeURIComponent(id)}${query}\n\n`;
  }
  batchRequestBody += "--batch_boundary--";

  const res = await fetch(getGoogleGmailBatchUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/mixed; boundary=batch_boundary",
      "Accept-Encoding": "gzip",
      "User-Agent": "Inbox-Zero (gzip)",
    },
    body: batchRequestBody,
  });

  const textRes = await res.text();

  const batch = parseBatchResponse(textRes, res.headers.get("Content-Type"));

  return batch;
}

function parseBatchResponse(batchResponse: string, contentType: string | null) {
  checkBatchResponseForError(batchResponse);

  // 从 Content-Type 头中提取边界
  const boundaryRegex = /boundary=(.*?)(;|$)/;
  const boundaryMatch = contentType?.match(boundaryRegex);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;

  if (!boundary) {
    logger.error("响应中未找到边界", { batchResponse });
    throw new Error("parseBatchResponse：响应中未找到边界");
  }

  const parts = batchResponse.split(`--${boundary}`);

  // 处理每个部分
  const decodedParts = parts.map((part) => {
    // 跳过空部分
    if (!part.trim()) return;

    // 找到响应中 JSON 部分的起始位置
    const jsonStartIndex = part.indexOf("{");
    if (jsonStartIndex === -1) return; // Skip if no JSON data found

    // 提取 JSON 字符串
    const jsonResponse = part.slice(jsonStartIndex);

    // 解析 JSON 字符串
    try {
      const data = JSON.parse(jsonResponse);

      return data;
    } catch (error) {
      logger.error("解析 JSON 时出错", { error });
    }
  });

  return decodedParts.filter(isDefined);
}

function checkBatchResponseForError(batchResponse: string) {
  try {
    const jsonResponse = JSON.parse(batchResponse);

    if (jsonResponse.error) {
      throw new Error(
        "parseBatchResponse: Error in batch response",
        jsonResponse.error,
      );
    }
  } catch {
    // 不是 json。跳过
  }
}
