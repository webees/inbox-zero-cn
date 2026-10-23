import { Client, type FlowControl, type HeadersInit } from "@upstash/qstash";
import { after } from "next/server";
import { getInternalApiHeaders, getInternalApiUrl } from "@/utils/internal-api";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";
import { isSafeExternalHttpUrl } from "@inboxzero/network/safe-url";

const logger = createScopedLogger("upstash");

type PublishToQstashOptions = {
  destinationUrl?: string;
};

function getQstashClient(callbackUrl: string = getQstashCallbackBaseUrl()) {
  if (!env.QSTASH_TOKEN) return null;
  if (!isSafeExternalHttpUrl(callbackUrl)) {
    logger.warn(
      "Qstash callback URL is not externally reachable; using fallback",
      {
        qstashCallbackUrl: callbackUrl,
      },
    );
    return null;
  }
  return new Client({ token: env.QSTASH_TOKEN });
}

export async function publishToQstash<T>(
  path: string,
  body: T,
  flowControl?: FlowControl,
  headers?: HeadersInit,
  options?: PublishToQstashOptions,
) {
  const requestHeaders = createHeaders(headers);
  requestHeaders.set("Retry-After", "10");

  const qstashUrl =
    options?.destinationUrl ?? `${getQstashCallbackBaseUrl()}${path}`;
  const client = getQstashClient(qstashUrl);
  if (client) {
    return client.publishJSON({
      url: qstashUrl,
      body,
      flowControl,
      retries: 3,
      headers: requestHeaders,
    });
  }

  const fallbackUrl =
    options?.destinationUrl ?? `${getInternalApiUrl()}${path}`;
  return fallbackPublishToQstash(
    fallbackUrl,
    body,
    requestHeaders,
    !options?.destinationUrl,
  );
}

/**
 * 不早于 `notBefore` 将 `body` 投递到 `path`。当
 * QStash 不可用时返回 `false`，因此调用方保留自己的回退方案，例如 cron。
 */
export async function publishToQstashAt<T>({
  path,
  body,
  notBefore,
  deduplicationId,
}: {
  path: string;
  body: T;
  notBefore: Date;
  deduplicationId: string;
}) {
  const url = `${getQstashCallbackBaseUrl()}${path}`;
  const client = getQstashClient(url);
  if (!client) return false;
  await client.publishJSON({
    url,
    body,
    notBefore: Math.ceil(notBefore.getTime() / 1000),
    deduplicationId,
    retries: 3,
  });
  return true;
}

export async function bulkPublishToQstash<T>({
  items,
}: {
  items: {
    path: string;
    body: T;
    flowControl?: FlowControl;
  }[];
}) {
  const client = getQstashClient();
  if (client) {
    const callbackBase = getQstashCallbackBaseUrl();
    const qstashItems = items.map((item) => ({
      ...item,
      url: `${callbackBase}${item.path}`,
      path: undefined,
    }));

    await client.batchJSON(qstashItems);
    return;
  }

  const internalBase = getInternalApiUrl();
  for (const item of items) {
    await fallbackPublishToQstash(
      `${internalBase}${item.path}`,
      item.body,
      undefined,
    );
  }
}

export async function publishToQstashQueue<T>({
  queueName,
  parallelism,
  path,
  body,
  headers,
  deduplicationId,
}: {
  queueName: string;
  parallelism: number;
  path: string;
  body: T;
  headers?: HeadersInit;
  deduplicationId?: string;
}) {
  const client = getQstashClient();
  if (client) {
    const qstashUrl = `${getQstashCallbackBaseUrl()}${path}`;

    try {
      const queue = client.queue({ queueName });
      await queue.upsert({ parallelism });
      return await queue.enqueueJSON({
        url: qstashUrl,
        body,
        headers,
        deduplicationId,
      });
    } catch (error) {
      logger.error("发布到 Qstash 队列失败", {
        qstashUrl,
        queueName,
        error,
      });
      throw error;
    }
  }

  return publishToInternalApiInBackground<T>({
    path,
    body,
    headers,
  });
}

export async function publishToInternalApiInBackground<T>({
  path,
  body,
  headers,
}: {
  path: string;
  body: T;
  headers?: HeadersInit;
}) {
  const fallbackUrl = `${getInternalApiUrl()}${path}`;
  return fallbackPublishToQstash<T>(fallbackUrl, body, headers);
}

async function fallbackPublishToQstash<T>(
  url: string,
  body: T,
  headers?: HeadersInit,
  includeInternalApiHeaders = true,
) {
  logger.warn("未找到 Qstash 客户端");

  const internalHeaders = createHeaders(headers);
  internalHeaders.set("Content-Type", "application/json");
  if (includeInternalApiHeaders) {
    for (const [key, value] of Object.entries(getInternalApiHeaders())) {
      internalHeaders.set(key, value);
    }
  }

  after(async () => {
    try {
      await fetch(url, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify(body),
      });
    } catch (error) {
      logger.error("回退 QStash 请求失败", { url, error });
    }
  });
}

export async function listQueues() {
  const client = getQstashClient();
  if (client) {
    return await client.queue().list();
  }
  return [];
}

export async function deleteQueue(queueName: string) {
  const client = getQstashClient();
  if (client) {
    logger.info("Deleting queue", { queueName });
    await client.queue({ queueName }).delete();
  }
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function getQstashCallbackBaseUrl() {
  const candidateUrls = [
    env.INTERNAL_API_URL,
    env.WEBHOOK_URL,
    env.NEXT_PUBLIC_BASE_URL,
  ].filter((value): value is string => Boolean(value));

  const safeExternalUrl = candidateUrls.find((value) =>
    isSafeExternalHttpUrl(value),
  );
  if (safeExternalUrl) return normalizeBaseUrl(safeExternalUrl);

  return normalizeBaseUrl(getInternalApiUrl());
}

function createHeaders(headers?: HeadersInit) {
  if (headers && Symbol.iterator in headers) {
    return new Headers(Array.from(headers));
  }

  return new Headers(headers);
}
