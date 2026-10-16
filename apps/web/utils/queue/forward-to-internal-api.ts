import { getInternalApiHeaders, getInternalApiUrl } from "@/utils/internal-api";
import type { Logger } from "@/utils/logger";

export async function forwardQueueMessageToInternalApi<T>({
  path,
  body,
  logger,
}: {
  path: string;
  body: T;
  logger: Logger;
}) {
  let response: Response;

  try {
    response = await fetch(`${getInternalApiUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalApiHeaders(),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logger.error("转发队列消息时无法访问内部 API", {
      path,
      error,
    });
    throw error;
  }

  if (response.ok) return;

  const responseBody = await getResponseBody(response);

  logger.error("将 Vercel 队列回调转发到内部 API 失败", {
    path,
    status: response.status,
    responseBody,
  });

  throw new Error(
    `Failed to forward Vercel queue callback. Status: ${response.status}`,
  );
}

async function getResponseBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return;
  }
}
