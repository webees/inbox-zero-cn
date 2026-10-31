import "server-only";
import { redis } from "@/utils/redis";
import prisma from "@/utils/prisma";

const EXPIRATION = 60 * 60; // 1 hour

/**
 * 获取用于账号校验的 Redis 键
 */
function getValidationKey({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}): string {
  return `account:${userId}:${emailAccountId}`;
}

/**
 * 校验某个账号是否属于某用户，并使用 Redis 进行缓存
 * @param userId The user ID
 * @param accountId The account ID to validate
 * @returns email address of the account if it belongs to the user, otherwise null
 */
export async function getEmailAccount({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}): Promise<string | null> {
  if (!userId || !emailAccountId) return null;

  const key = getValidationKey({ userId, emailAccountId });

  // 先检查 Redis 缓存
  try {
    const cachedResult = await redis.get<string>(key);
    if (cachedResult !== null) {
      return cachedResult;
    }
  } catch {
    // Redis 不可用——回退到数据库
  }

  // 不在缓存中，检查数据库
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId, userId },
    select: { email: true },
  });

  // 缓存结果（尽力而为）
  try {
    await redis.set(key, emailAccount?.email ?? null, { ex: EXPIRATION });
  } catch {
    // Redis 不可用——跳过缓存
  }

  return emailAccount?.email ?? null;
}

/**
 * 使用户账号的缓存校验结果失效
 * 在账号归属发生变化时很有用
 */
export async function invalidateAccountValidation({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}): Promise<void> {
  const key = getValidationKey({ userId, emailAccountId });
  try {
    await redis.del(key);
  } catch {
    // Redis 不可用——跳过失效处理
  }
}
