import { timingSafeEqual } from "node:crypto";

// 长度检查不是恒定时间的，但令牌的密钥长度本身并不敏感。
// 这样可以避免逐字节提前退出的比较。
export function secureCompare(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;

  return secureCompareBuffers(Buffer.from(a), Buffer.from(b));
}

export function secureCompareBuffers(
  a: Buffer | null | undefined,
  b: Buffer | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
