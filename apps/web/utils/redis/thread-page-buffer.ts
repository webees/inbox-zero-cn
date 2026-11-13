import { createHash, randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { Redis } from "@upstash/redis";
import { env } from "@/env";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { createScopedLogger } from "@/utils/logger";
import { createThreadListCacheKey } from "@/utils/threads/thread-list-cache-key";
import type { ThreadsQuery } from "@/utils/threads/validation";
import type {
  PageBuffer,
  PaginatedPage,
} from "@/utils/threads/merge-paginated-sources";

const logger = createScopedLogger("redis/thread-page-buffer");
const BUFFER_TTL_SECONDS = 5 * 60;
const MAX_BUFFER_BYTES = 1024 * 1024;

// 删除标记和写入必须原子检查，以免账号删除扫描缓冲区时，
// 进行中的加载重新创建缓冲区。
const WRITE_BUFFER_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
return 1
`;

type PageBufferScope =
  | {
      kind: "labels";
      emailAccountId: string;
      messageFormat: "full" | "metadata";
      maxResults: number;
      query: ThreadsQuery;
    }
  | {
      kind: "combined";
      userId: string;
      query: {
        q: string | null | undefined;
        labelNames: string[];
        isUnread: boolean | undefined;
        limit: number;
      };
    };

export function createPageBuffer<TItem, TMeta = unknown>(
  scope: PageBufferScope,
): PageBuffer<TItem, TMeta> | undefined {
  const redis = createBufferRedis();
  if (!redis || !env.EMAIL_ENCRYPT_SECRET || !env.EMAIL_ENCRYPT_SALT) return;
  const createdAt = Date.now();
  const { query, ...identity } = scope;
  const scopeHash = createHash("sha256")
    .update(createThreadListCacheKey({ ...query, ...identity }))
    .digest("hex");
  const accountPrefixFor = (sourceId: string) =>
    getAccountPrefix(scope.kind === "labels" ? scope.emailAccountId : sourceId);
  const keyFor = (sourceId: string, id: string) => {
    const sourceHash = createHash("sha256").update(sourceId).digest("hex");
    return `${accountPrefixFor(sourceId)}:page:${scopeHash}:${sourceHash}:${id}`;
  };

  return {
    async read({ sourceId, id }) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return;
      try {
        const key = keyFor(sourceId, id);
        const encoded = await redis.get<string>(key);
        if (typeof encoded !== "string" || encoded.length > MAX_BUFFER_BYTES)
          return;
        // 仅接受加密值；decryptToken 也支持旧版明文。
        if (!/^v\d+:[a-f0-9]+$/i.test(encoded)) return;
        const decoded = decryptToken(encoded);
        if (!decoded) return;
        const payload: unknown = deserialize(Buffer.from(decoded, "base64"));
        if (
          !payload ||
          typeof payload !== "object" ||
          !("key" in payload) ||
          payload.key !== key ||
          !("page" in payload)
        )
          return;
        const page = payload.page;
        if (
          !page ||
          typeof page !== "object" ||
          !("items" in page) ||
          !Array.isArray(page.items)
        )
          return;
        return page as PaginatedPage<TItem, TMeta>;
      } catch {
        logger.warn("无法读取已缓冲的会话分页；正在从服务商获取");
      }
    },
    async write({ sourceId, page }) {
      try {
        // 存活时间不得超过分页 TTL，也不得超过该账号的删除标记。
        if (Date.now() - createdAt >= BUFFER_TTL_SECONDS * 1000) return;
        // 保留增强后的账号行中的日期和未定义字段。
        const id = randomUUID();
        const key = keyFor(sourceId, id);
        const serialized = serialize({ key, page }).toString("base64");
        if (serialized.length > MAX_BUFFER_BYTES) return;
        const encoded = encryptToken(serialized);
        if (!encoded || encoded.length > MAX_BUFFER_BYTES) return;
        const stored = await redis.eval(
          WRITE_BUFFER_SCRIPT,
          [`${accountPrefixFor(sourceId)}:deleted`, key],
          [encoded, BUFFER_TTL_SECONDS],
        );
        return stored === 1 ? id : undefined;
      } catch {
        // Redis 错误可能包含命令载荷，因此不要记录该错误。
        logger.warn("无法缓冲会话分页；分页时将重新获取");
      }
    },
  };
}

export async function withThreadPageBufferDeletion<T>(
  emailAccountIds: string[],
  deleteAccount: () => Promise<T>,
): Promise<T> {
  const redis = createBufferRedis();
  if (!redis) return deleteAccount();
  const markers: { key: string; token: string }[] = [];
  try {
    for (const emailAccountId of new Set(emailAccountIds)) {
      const prefix = getAccountPrefix(emailAccountId);
      const marker = `${prefix}:deleted`;
      const token = randomUUID();
      // 在等待前记录归属：Redis 可能执行成功但丢失响应。
      markers.push({ key: marker, token });
      await redis.eval(
        `
        redis.call("SADD", KEYS[1], ARGV[1])
        redis.call("SREM", KEYS[1], "grace")
        redis.call("PERSIST", KEYS[1])
        return 1
      `,
        [marker],
        [token],
      );
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, {
          match: `${prefix}:page:*`,
          count: 100,
        });
        cursor = Number(nextCursor);
        if (keys.length) await redis.del(...keys);
      } while (cursor !== 0);
    }
    return await deleteAccount();
  } finally {
    for (const { key, token } of markers) {
      try {
        // 保留删除期间创建的分页缓冲，直到其过期。
        await redis.eval(
          `
          redis.call("SREM", KEYS[1], ARGV[1])
          local remaining = redis.call("SCARD", KEYS[1])
          if remaining == 0 then
            redis.call("SADD", KEYS[1], "grace")
            redis.call("EXPIRE", KEYS[1], ARGV[2])
          end
          return remaining
        `,
          [key],
          [token, BUFFER_TTL_SECONDS],
        );
      } catch {
        // 如果清理过程被中断，持久标记会安全地禁用缓冲。
        logger.warn("无法使会话分页删除标记过期");
      }
    }
  }
}

function createBufferRedis() {
  if (!env.REDIS_HTTP_URL || !env.REDIS_HTTP_TOKEN) return;
  if (URL.parse(env.REDIS_HTTP_URL)?.protocol !== "https:") return;
  return new Redis({
    url: env.REDIS_HTTP_URL,
    token: env.REDIS_HTTP_TOKEN,
    retry: false,
    signal: () => AbortSignal.timeout(500),
  });
}

function getAccountPrefix(emailAccountId: string) {
  const accountHash = createHash("sha256").update(emailAccountId).digest("hex");
  return `thread-page:v2:${accountHash}`;
}
