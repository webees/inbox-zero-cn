import "server-only";
import type { Logger } from "@/utils/logger";
import { redis } from "@/utils/redis";

// 联系人头像很少变化，而扫描整个通讯录代价高昂
// 会消耗服务商的按用户配额。
const CONTACT_PHOTOS_TTL_SECONDS = 24 * 60 * 60;
// 足够短，使新授予的联系人 scope 尽快生效。
const FAILED_SWEEP_TTL_SECONDS = 15 * 60;

export async function getCachedContactPhotos(
  emailAccountId: string,
  logger: Logger,
) {
  try {
    return await redis.get<Record<string, string>>(
      getContactPhotosKey(emailAccountId),
    );
  } catch (error) {
    logger.warn("读取缓存的联系人头像失败", { error });
    return null;
  }
}

export async function setCachedContactPhotos(
  emailAccountId: string,
  photos: Record<string, string>,
  logger: Logger,
) {
  try {
    await redis.set(getContactPhotosKey(emailAccountId), photos, {
      ex: CONTACT_PHOTOS_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn("缓存联系人头像失败", { error });
  }
}

// 阻止被限流或无权限的账号在每次页面
// 加载时重新扫描。NX 可防止并发请求的成功结果被覆盖。
export async function setFailedContactPhotoSweep(
  emailAccountId: string,
  logger: Logger,
) {
  try {
    await redis.set(
      getContactPhotosKey(emailAccountId),
      {},
      { ex: FAILED_SWEEP_TTL_SECONDS, nx: true },
    );
  } catch (error) {
    logger.warn("缓存失败的联系人头像扫描失败", { error });
  }
}

function getContactPhotosKey(emailAccountId: string) {
  return `contact-photos:${emailAccountId}`;
}
