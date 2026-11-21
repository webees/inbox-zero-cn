import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/env";
import { redis } from "@/utils/redis";
import type { Logger } from "@/utils/logger";

type RateLimitRule = {
  key: string;
  limit: number;
  windowSeconds: number;
};

type RateLimitResult =
  | {
      limited: false;
      limit: number;
      remaining: number;
    }
  | {
      limited: true;
      limit: number;
      retryAfterSeconds: number;
    };

export async function checkRateLimit({
  rule,
  logger,
}: {
  rule: RateLimitRule;
  logger?: Logger;
}): Promise<RateLimitResult> {
  if (!isRedisRateLimitConfigured()) {
    return {
      limited: false,
      limit: rule.limit,
      remaining: rule.limit,
    };
  }

  try {
    const count = Number(
      await redis.eval<string[], number>(
        INCREMENT_RATE_LIMIT_SCRIPT,
        [rule.key],
        [rule.windowSeconds.toString()],
      ),
    );

    if (count > rule.limit) {
      return {
        limited: true,
        limit: rule.limit,
        retryAfterSeconds: rule.windowSeconds,
      };
    }

    return {
      limited: false,
      limit: rule.limit,
      remaining: Math.max(rule.limit - count, 0),
    };
  } catch (error) {
    logger?.warn("Redis 速率限制不可用", {
      error: error instanceof Error ? error.message : error,
    });

    return {
      limited: false,
      limit: rule.limit,
      remaining: rule.limit,
    };
  }
}

export function createRateLimitKey(parts: string[]) {
  return parts.map((part) => hashKeyPart(part)).join(":");
}

// 假定部署位于可信平台或负载均衡器之后，它们会将真实客户端 IP 追加到
// 信任链的可信边缘，因此我们读取最右侧的 `x-forwarded-for` 条目。
// 当源站可直接访问时，最左侧的值、特定服务商的访客 IP 头以及
// `x-real-ip` 都可能受客户端控制，用于速率限制并不可信。
export function getClientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const entries = forwardedFor.split(",");
    const rightmost = entries.at(-1)?.trim();
    if (rightmost) return rightmost;
  }

  return "unknown";
}

export function hashRateLimitValue(value: string) {
  return createHmac("sha256", getRateLimitHashSecret())
    .update(value)
    .digest("hex");
}

function hashKeyPart(part: string) {
  return part.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function isRedisRateLimitConfigured() {
  return (
    env.NODE_ENV === "test" ||
    Boolean(env.REDIS_HTTP_URL && env.REDIS_HTTP_TOKEN)
  );
}

function getRateLimitHashSecret() {
  const secret =
    env.AUTH_SECRET || env.NEXTAUTH_SECRET || env.EMAIL_ENCRYPT_SECRET;
  if (!secret) {
    throw new Error("缺少速率限制哈希密钥：请设置 AUTH_SECRET");
  }
  return secret;
}

const INCREMENT_RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
end
return count
`.trim();
