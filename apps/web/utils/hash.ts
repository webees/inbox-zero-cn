import { createHmac } from "node:crypto";
import { env } from "@/env";

/**
 * 对敏感标识符（例如邮箱地址）进行哈希，以便安全地记录日志。
 */
export function hash(value: string): string;
export function hash(value: null): null;
export function hash(value: undefined): undefined;
export function hash(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return value;

  const normalized = value.trim().toLowerCase();

  // 这是用于生成确定性日志标识符的带密钥 HMAC，
  // 而非密码存储或校验。
  // codeql[js/insufficient-password-hash]
  const digest = createHmac("sha256", env.EMAIL_ENCRYPT_SALT)
    .update(normalized)
    .digest("hex");

  return digest;
}
