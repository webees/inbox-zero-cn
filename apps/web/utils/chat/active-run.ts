import "server-only";
import Redis from "ioredis";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream/ioredis";
import { env } from "@/env";
import { createScopedLogger, type Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { sleep } from "@/utils/sleep";

const STOP_CHANNEL = "assistant-chat:stop";
const SUBSCRIBE_TIMEOUT_MS = 2000;
// 聊天路由的 maxDuration。早于该时长的标记属于某次运行，其
// 实例在清除它之前就已终止。
const MAX_RUN_MS = 800_000;
const logger = createScopedLogger("assistant-chat-run");

declare global {
  var assistantChatRuns: Map<string, AbortController> | undefined;
  var assistantChatRedis:
    | {
        publisher: Redis;
        streams: ResumableStreamContext;
        listening: Promise<void>;
      }
    | undefined;
}

const runs = global.assistantChatRuns ?? new Map<string, AbortController>();
global.assistantChatRuns = runs;

// Resuming needs a shared Redis; without one, replies still stream and save,
// 它们只是在连接中断后无法重新附加。
export function getChatStreamContext() {
  return getRedis()?.streams ?? null;
}

// 停止请求可能落在任意服务器实例上，因此正在运行
// 回复的实例会监听通过 Redis 广播的停止信号并中止自己的运行。
export async function startChatRun(streamId: string) {
  const redis = getRedis();
  // Hear stops before the run is marked active so an early one isn't missed;
  // 设有超时，以免 Redis 故障拖住回复。
  if (redis) await Promise.race([redis.listening, sleep(SUBSCRIBE_TIMEOUT_MS)]);
  const controller = new AbortController();
  runs.set(streamId, controller);
  return {
    abortSignal: controller.signal,
    end: () => runs.delete(streamId),
  };
}

export async function stopChatRun(streamId: string, requestLogger: Logger) {
  runs.get(streamId)?.abort();
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publisher.publish(STOP_CHANNEL, streamId);
  } catch (error) {
    requestLogger.warn("无法发布助手聊天停止信号", { error });
  }
}

// 为新的回复认领该聊天，除非已有另一个活跃回复持有它。
export async function claimActiveStream({
  chatId,
  streamId,
}: {
  chatId: string;
  streamId: string;
}) {
  const { count } = await prisma.chat.updateMany({
    where: {
      id: chatId,
      OR: [
        { activeStreamId: null },
        { activeStreamStartedAt: null },
        { activeStreamStartedAt: { lt: new Date(Date.now() - MAX_RUN_MS) } },
      ],
    },
    data: { activeStreamId: streamId, activeStreamStartedAt: new Date() },
  });
  return count > 0;
}

export function getLiveStreamId(chat: {
  activeStreamId: string | null;
  activeStreamStartedAt: Date | null;
}) {
  if (!chat.activeStreamId || !chat.activeStreamStartedAt) return null;
  if (Date.now() - chat.activeStreamStartedAt.getTime() > MAX_RUN_MS) {
    return null;
  }
  return chat.activeStreamId;
}

export async function clearActiveStream({
  chatId,
  streamId,
}: {
  chatId: string;
  streamId: string;
}) {
  // Only clear our own stream; a newer reply may already have replaced it.
  // A failure here must not break the run's cleanup; the marker goes stale.
  try {
    await prisma.chat.updateMany({
      where: { id: chatId, activeStreamId: streamId },
      data: { activeStreamId: null, activeStreamStartedAt: null },
    });
  } catch (error) {
    logger.error("清除活跃聊天流失败", { chatId, error });
  }
}

function getRedis() {
  if (!env.REDIS_URL) return null;
  if (global.assistantChatRedis) return global.assistantChatRedis;

  const publisher = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  const subscriber = new Redis(env.REDIS_URL);
  // 发布失败会在触发的调用处显现，并在那里处理。
  publisher.on("error", () => {});
  subscriber.on("error", (error) => {
    logger.warn("助手聊天 Redis 订阅者出错", { error });
  });
  subscriber.on("message", (channel: string, streamId: string) => {
    if (channel === STOP_CHANNEL) runs.get(streamId)?.abort();
  });
  const listening = subscriber
    .subscribe(STOP_CHANNEL)
    .then(() => undefined)
    .catch((error) => {
      logger.error("无法监听助手聊天停止信号", { error });
    });

  global.assistantChatRedis = {
    publisher,
    listening,
    streams: createResumableStreamContext({
      keyPrefix: "assistant-chat",
      waitUntil: after,
      publisher,
      subscriber,
    }),
  };
  return global.assistantChatRedis;
}
