import { redis } from "@/utils/redis";
import type { CleanThread } from "@/utils/redis/clean.types";
import { isDefined } from "@/utils/types";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("redis/clean");

const EXPIRATION = 60 * 60 * 6; // 6 hours

const threadKey = ({
  emailAccountId,
  jobId,
  threadId,
}: {
  emailAccountId: string;
  jobId: string;
  threadId: string;
}) => `thread:${emailAccountId}:${jobId}:${threadId}`;

export async function saveThread({
  emailAccountId,
  thread,
}: {
  emailAccountId: string;
  thread: {
    threadId: string;
    jobId: string;
    from: string;
    subject: string;
    snippet: string;
    date: Date;
    archive?: boolean;
    label?: string;
  };
}): Promise<CleanThread> {
  const cleanThread: CleanThread = {
    ...thread,
    emailAccountId,
    status: "processing",
    createdAt: new Date().toISOString(),
  };

  await publishThread({ emailAccountId, thread: cleanThread });
  return cleanThread;
}

export async function updateThread({
  emailAccountId,
  jobId,
  threadId,
  update,
}: {
  emailAccountId: string;
  jobId: string;
  threadId: string;
  update: Partial<CleanThread>;
}) {
  const thread = await getThread({ emailAccountId, jobId, threadId });
  if (!thread) {
    logger.warn("未找到会话", { threadId, emailAccountId, jobId });
    return;
  }

  const updatedThread = { ...thread, ...update };
  await publishThread({ emailAccountId, thread: updatedThread });
}

export async function publishThread({
  emailAccountId,
  thread,
}: {
  emailAccountId: string;
  thread: CleanThread;
}) {
  const key = threadKey({
    emailAccountId,
    jobId: thread.jobId,
    threadId: thread.threadId,
  });

  // 存储带过期时间的数据
  await redis.set(key, thread, { ex: EXPIRATION });
  // 将更新发布给所有正在监听的客户端
  await redis.publish(key, JSON.stringify(thread));
}

async function getThread({
  emailAccountId,
  jobId,
  threadId,
}: {
  emailAccountId: string;
  jobId: string;
  threadId: string;
}) {
  const key = threadKey({ emailAccountId, jobId, threadId });
  return redis.get<CleanThread>(key);
}
export async function getThreadsByJobId({
  emailAccountId,
  jobId,
  limit = 1000,
}: {
  emailAccountId: string;
  jobId: string;
  limit?: number;
}) {
  const pattern = `thread:${emailAccountId}:${jobId}:*`;
  const keys = [];
  let cursor = 0;

  // 扫描键，直到达到上限或键耗尽
  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: pattern,
      count: 100, // 每次迭代获取多少个键
    });
    cursor = Number(nextCursor);
    keys.push(...batch);

    if (keys.length >= limit) break;
  } while (cursor !== 0);

  // 切片以确保不超过上限
  const keysToFetch = keys.slice(0, limit);
  if (keysToFetch.length === 0) return [];

  const threads = await Promise.all(
    keysToFetch.map((key) => redis.get<CleanThread>(key)),
  );
  return threads.filter(isDefined);
}

export async function deleteAllUserData(userId: string) {
  // 删除该用户的所有会话键
  const threadPattern = `thread:${userId}:*`;
  let cursor = 0;
  let deletedThreads = 0;

  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: threadPattern,
      count: 100,
    });
    cursor = Number(nextCursor);

    if (batch.length > 0) {
      // 展开键数组
      await redis.unlink(...batch);
      deletedThreads += batch.length;
    }
  } while (cursor !== 0);

  return { deletedThreads };
}
