import crypto from "node:crypto";
import { secureCompareBuffers } from "@/utils/crypto-compare";

// Recall（通过 Svix）和 Loops 都使用 Standard Webhooks
// 方案对 webhook 签名。我们没有引入 Svix SDK，而是手动验证签名：它
// 是一个有文档记录且稳定的 HMAC 方案。
// https://docs.svix.com/receiving/verifying-payloads/how-manual

const TOLERANCE_SECONDS = 5 * 60;

type MissingHeader = "id" | "timestamp" | "signature";

type StandardWebhookVerification =
  | { verified: true }
  | {
      verified: false;
      reason: "missing_headers";
      missingHeaders: MissingHeader[];
    }
  | { verified: false; reason: "invalid_timestamp" }
  | {
      verified: false;
      reason: "timestamp_outside_tolerance";
      timestampSkewSeconds: number;
    }
  | { verified: false; reason: "signature_mismatch" };

export function verifyStandardWebhook({
  secret,
  headers,
  rawBody,
}: {
  secret: string;
  headers: Headers;
  rawBody: string;
}): StandardWebhookVerification {
  // Svix 发送 `svix-*`；供应商中立的 standard-webhooks 名称是
  // `webhook-*`。两种方式的签名计算完全相同，因此
  // 两者都接受，而不是对本可验证的投递返回 401。
  const id = getHeader(headers, "id");
  const timestamp = getHeader(headers, "timestamp");
  const signatureHeader = getHeader(headers, "signature");

  const missingHeaders: MissingHeader[] = [];
  if (!id) missingHeaders.push("id");
  if (!timestamp) missingHeaders.push("timestamp");
  if (!signatureHeader) missingHeaders.push("signature");
  if (!(id && timestamp && signatureHeader)) {
    return { verified: false, reason: "missing_headers", missingHeaders };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { verified: false, reason: "invalid_timestamp" };
  }

  const skewSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (skewSeconds > TOLERANCE_SECONDS) {
    return {
      verified: false,
      reason: "timestamp_outside_tolerance",
      timestampSkewSeconds: Math.round(skewSeconds),
    };
  }

  const key = getVerificationKey(secret);
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // 该头包含以空格分隔的 `v1,<base64>` 条目，因此可以
  // 轮换密钥而不丢弃投递。任意一个匹配即可。
  const verified = signatureHeader
    .split(" ")
    .some((entry) => matchesSignature(entry, expected));

  return verified
    ? { verified: true }
    : { verified: false, reason: "signature_mismatch" };
}

function matchesSignature(entry: string, expected: Buffer): boolean {
  const [version, signature] = entry.split(",");
  if (version !== "v1" || !signature) return false;

  return secureCompareBuffers(Buffer.from(signature, "base64"), expected);
}

function getHeader(headers: Headers, suffix: string): string | null {
  return headers.get(`svix-${suffix}`) ?? headers.get(`webhook-${suffix}`);
}

export function getWebhookSecretFingerprint(secret: string): string {
  const fingerprint = crypto
    .createHash("sha256")
    .update(getVerificationKey(secret))
    .digest("hex")
    .slice(0, 12);

  return `sha256:${fingerprint}`;
}

function getVerificationKey(secret: string): Buffer {
  return Buffer.from(secret.replace(/^whsec_/, ""), "base64");
}
