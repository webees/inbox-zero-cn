import * as dns from "node:dns/promises";
import { isIP } from "node:net";

// Private/internal IP ranges that should be blocked
const PRIVATE_IP_RANGES = [
  // IPv4
  /^127\./, // 127.0.0.0/8 (loopback)
  /^10\./, // 10.0.0.0/8 (private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
  /^192\.168\./, // 192.168.0.0/16 (private)
  /^169\.254\./, // 169.254.0.0/16 (link-local, cloud metadata)
  /^0\./, // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
  /^192\.0\.0\./, // 192.0.0.0/24 (IETF protocol assignments)
  /^192\.0\.2\./, // 192.0.2.0/24 (TEST-NET-1)
  /^198\.51\.100\./, // 198.51.100.0/24 (TEST-NET-2)
  /^203\.0\.113\./, // 203.0.113.0/24 (TEST-NET-3)
  /^224\./, // 224.0.0.0/4 (multicast)
  /^240\./, // 240.0.0.0/4 (reserved)
  /^255\.255\.255\.255$/, // broadcast

  // IPv6
  /^::1$/, // loopback
  /^fe80:/i, // 链路本地
  /^fc00:/i, // 唯一本地地址 (fc00::/7)
  /^fd[0-9a-f]{2}:/i, // 唯一本地地址
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.)/i, // IPv4 映射的 IPv6
];

// 被阻止的主机名
const BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  // 常见的云元数据端点
  "metadata.google.internal",
  "metadata.gcp.internal",
];

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^(\[)?([0-9a-fA-F:]+)(\])?$/;

/**
 * 安全：面向可信的单租户自托管部署的可选逃生舱。
 *
 * When `WEBHOOK_ALLOW_PRIVATE_IPS` is enabled, the private/internal IP checks
 * （包括 IP 字面量和 DNS 解析出的地址）会被绕过，使自托管者
 * can target internal services (LAN, Tailscale CGNAT `100.64.0.0/10`, etc.).
 *
 * 这会禁用 webhook URL 的 SSRF 防护，且只能用于
 * trusted, single-tenant deployment. Never enable it on a shared/multi-tenant
 * 实例（托管实例）：它会让任何拥有 webhook 访问权限的用户触达内部
 * 基础设施，并通过 IP 触达云元数据端点。
 *
 * 默认为 false。直接从 `process.env` 读取（与 `NODE_ENV`
 * 在本文件中的读取方式一致），使验证器保持零内部导入，并
 * 可通过 `vi.stubEnv` 轻松测试。该值也在
 * `apps/web/env.ts` for typing/validation/documentation. Matching the
 * `booleanString` semantics, any value other than unset/empty/"false" enables it.
 */
export function allowPrivateIps(): boolean {
  const value = process.env.WEBHOOK_ALLOW_PRIVATE_IPS;
  if (!value) return false;
  return value.toLowerCase() !== "false";
}

export type WebhookUrlValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * 在不进行 DNS 解析的情况下验证 webhook URL 格式。
 * Use at rule creation/update time for immediate feedback.
 * 检查内容：URL 解析、协议、被阻止的主机名、私有 IP 字面量。
 */
export function validateWebhookUrlFormat(
  url: string,
): WebhookUrlValidationResult {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: "无效的 URL 格式" };
  }

  const isProduction = process.env.NODE_ENV === "production";
  const allowedProtocols = isProduction ? ["https:"] : ["https:", "http:"];

  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    return {
      valid: false,
      error: isProduction
        ? "webhook 仅允许使用 HTTPS URL"
        : "webhook 仅允许使用 HTTP 和 HTTPS URL",
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return {
      valid: false,
      error: "不允许使用该 webhook URL 主机名",
    };
  }

  const ipCheck = checkPrivateIpLiteral(hostname);
  if (ipCheck) return ipCheck;

  return { valid: true };
}

/**
 * 验证 webhook URL 以防止 SSRF 攻击。
 *
 * 验证内容包括：
 * - 仅允许 HTTPS 协议
 * - 主机名中不能包含 IP 地址（必须使用 DNS 名称）
 * - No private/internal hostnames (localhost, metadata endpoints, etc.)
 * - DNS resolution must not resolve to private/internal IP addresses (both IPv4 and IPv6)
 *
 * 设置 WEBHOOK_ALLOW_PRIVATE_IPS 可绕过私有 IP 检查（字面量和 DNS 解析），
 * 供可信的单租户自托管使用（参见
 * allowPrivateIps）。被阻止的主机名（localhost、云元数据）以及
 * 生产环境仅限 HTTPS 的限制不会因该标志而放宽。
 */
export async function validateWebhookUrl(
  url: string,
): Promise<WebhookUrlValidationResult> {
  const formatResult = validateWebhookUrlFormat(url);
  if (!formatResult.valid) return formatResult;

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  const ipAddress =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  if (isIP(ipAddress)) return { valid: true };

  // 解析 DNS 并检查是否有解析出的 IP 属于私有地址
  // 同时检查 IPv4（A 记录）和 IPv6（AAAA 记录）以防绕过
  const allAddresses: string[] = [];

  // 解析 IPv4 地址（A 记录）
  try {
    const ipv4Addresses = await dns.resolve(hostname);
    allAddresses.push(...ipv4Addresses);
  } catch (error) {
    const dnsError = error as NodeJS.ErrnoException;
    // ENODATA 表示不存在 A 记录（可能只有 AAAA）
    // ENOTFOUND 表示主机名完全不存在
    if (dnsError.code === "ENOTFOUND") {
      return {
        valid: false,
        error: "无法解析 webhook URL 主机名",
      };
    }
    // 对于 ENODATA，继续检查 AAAA 记录
    if (dnsError.code !== "ENODATA") {
      return {
        valid: false,
        error: "验证 webhook URL 失败",
      };
    }
  }

  // 解析 IPv6 地址（AAAA 记录）
  try {
    const ipv6Addresses = await dns.resolve6(hostname);
    allAddresses.push(...ipv6Addresses);
  } catch {
    // 如果已有 IPv4 地址，则 IPv6 解析失败无妨
  }

  if (allAddresses.length === 0) {
    return {
      valid: false,
      error: "无法解析 webhook URL 主机名",
    };
  }

  // 检查所有解析出的地址是否为私有 IP。
  // 安全：仅当显式启用 WEBHOOK_ALLOW_PRIVATE_IPS 时才会绕过
  // 用于可信的单租户自托管部署（参见 allowPrivateIps）。
  if (!allowPrivateIps()) {
    for (const ip of allAddresses) {
      if (isPrivateIP(ip)) {
        return {
          valid: false,
          error: "webhook URL 不能解析为私有 IP 地址",
        };
      }
    }
  }

  return { valid: true };
}

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

function checkPrivateIpLiteral(
  hostname: string,
): WebhookUrlValidationResult | null {
  // 安全：仅当显式启用 WEBHOOK_ALLOW_PRIVATE_IPS 时才会绕过
  // 用于可信的单租户自托管部署（参见 allowPrivateIps）。
  if (allowPrivateIps()) return null;

  if (IPV4_PATTERN.test(hostname)) {
    if (isPrivateIP(hostname)) {
      return {
        valid: false,
        error: "webhook URL 不能指向私有 IP 地址",
      };
    }
  }

  const ipv6Match = hostname.match(IPV6_PATTERN);
  if (ipv6Match) {
    const ipv6Addr = ipv6Match[2];
    if (isPrivateIP(ipv6Addr)) {
      return {
        valid: false,
        error: "webhook URL 不能指向私有 IP 地址",
      };
    }
  }

  return null;
}
