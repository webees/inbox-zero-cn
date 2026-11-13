import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const MIN_CIPHERTEXT_BYTES = IV_LENGTH + AUTH_TAG_LENGTH;

/**
 * 带版本的密文让我们可以轮换密钥而无需一次性回填：每行都携带其加密时所用
 * 的密钥版本，因此旧行继续用旧密钥解密，而新写入使用当前有效密钥。
 *
 * 轮换方法：扩展 `KeyVersion`（例如 `1 | 2`），添加环境变量，在
 * `KEY_MATERIAL` 中注册新密钥，然后提升 `ACTIVE_VERSION`。
 */
type KeyVersion = 1;
const ACTIVE_VERSION: KeyVersion = 1;

const KEY_MATERIAL: Record<KeyVersion, () => { secret: string; salt: string }> =
  {
    1: () => ({
      secret: env.EMAIL_ENCRYPT_SECRET,
      salt: env.EMAIL_ENCRYPT_SALT,
    }),
  };

const keyCache = new Map<KeyVersion, Buffer>();

export function encryptToken(text: string | null): string | null {
  if (text === null || text === undefined) return null;
  if (!isConfigured(ACTIVE_VERSION)) {
    logger.error("未配置加密密钥；拒绝加密");
    return null;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(ACTIVE_VERSION), iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("hex");
  return `v${ACTIVE_VERSION}:${payload}`;
}

/**
 * 解密由 `encryptToken` 生成的值。也接受：
 * - 旧版无版本密文（相同格式，无 `v1:` 前缀）：会透明解密。
 * - 明文（既不能解析为带版本载荷、也无法按旧版解密的内容）：原样返回。
 *
 * 明文透传让我们可以为当前保存明文的字段加上加密而无需强制迁移。新加密的
 * 行带有 `v1:` 前缀；旧行在自然重写之前仍可正常工作。
 *
 * 损坏的带版本载荷会抛出异常（不同于旧版静默返回 null 的行为），
 * 以免调用方收到无效数据。
 */
export function decryptToken(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (!isConfigured(ACTIVE_VERSION)) {
    logger.error("未配置加密密钥；拒绝解密");
    return null;
  }

  const versioned = parseVersioned(value);
  if (versioned) return decryptHex(versioned.payload, versioned.version);

  const legacy = tryLegacyDecrypt(value);
  if (legacy !== null) return legacy;

  return value;
}

function parseVersioned(
  value: string,
): { version: KeyVersion; payload: string } | null {
  const match = value.match(/^v(\d+):([0-9a-f]+)$/i);
  if (!match) return null;
  const version = Number(match[1]);
  if (!(version in KEY_MATERIAL)) {
    throw new Error(`未知的加密版本：v${version}`);
  }
  return { version: version as KeyVersion, payload: match[2] };
}

function decryptHex(hex: string, version: KeyVersion): string {
  const buffer = Buffer.from(hex, "hex");
  if (buffer.length < MIN_CIPHERTEXT_BYTES) {
    throw new Error("密文过短");
  }
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(version), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

function tryLegacyDecrypt(value: string): string | null {
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  if (value.length < MIN_CIPHERTEXT_BYTES * 2) return null;
  try {
    return decryptHex(value, 1);
  } catch (error) {
    logger.warn("旧版解密尝试失败；按明文处理", {
      error,
    });
    return null;
  }
}

function isConfigured(version: KeyVersion): boolean {
  const material = KEY_MATERIAL[version];
  if (!material) return false;
  const { secret, salt } = material();
  return Boolean(secret && salt);
}

function getKey(version: KeyVersion): Buffer {
  const cached = keyCache.get(version);
  if (cached) return cached;

  const material = KEY_MATERIAL[version];
  if (!material) throw new Error(`缺少 v${version} 的密钥材料`);

  const { secret, salt } = material();
  if (!secret || !salt) {
    throw new Error(`未配置加密密钥 v${version}`);
  }

  const key = scryptSync(secret, salt, KEY_LENGTH);
  keyCache.set(version, key);
  return key;
}
