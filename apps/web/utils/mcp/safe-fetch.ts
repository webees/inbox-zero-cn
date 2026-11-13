import type { LookupAddress } from "node:dns";
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { env } from "@/env";
import type { ResolvedMcpIntegration } from "@/utils/mcp/resolve-integration";
import {
  isSafeExternalHttpUrl,
  resolveSafeExternalHttpUrl,
} from "@inboxzero/network/safe-url";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * 内置集成指向我们控制的端点，因此使用默认的
 * fetch。用户注册的服务器则走受保护的版本。
 */
export function getMcpFetch(
  integration: ResolvedMcpIntegration,
): FetchLike | undefined {
  return integration.isCustom ? safeMcpFetch : undefined;
}

/**
 * 用户注册的 MCP 服务器的 URL 策略，在服务器被添加时
 * 以及每次向它发起请求时都会检查。若 URL 被拒绝，则返回原因。
 */
export function getCustomMcpServerUrlError(url: string): string | null {
  const allowPrivateIps = env.MCP_ALLOW_PRIVATE_IPS;

  if (!allowPrivateIps && !url.startsWith("https://")) {
    return "The server URL must use https";
  }

  if (!isSafeExternalHttpUrl(url, { allowPrivateIps })) {
    return "该服务器 URL 不是公网地址";
  }

  return null;
}

const safeMcpAgent = new Agent({
  connect: {
    lookup: createSafeLookup(() => env.MCP_ALLOW_PRIVATE_IPS),
  },
});
const publicOnlyAgent = new Agent({
  connect: { lookup: createSafeLookup(() => false) },
});

/**
 * 面向用户注册的 MCP 服务器的 fetch。此处每个 URL 都由用户控制，因此
 * 会重新检查目标（undici 对 IP 字面量会跳过 lookup 钩子），
 * 主机名连接会被固定到通过 SSRF 防护的地址，并且
 * 重定向会被拒绝，因为重定向会跳过这两项检查。
 *
 * 使用 undici 自带的 fetch，因为固定 DNS 的 dispatcher 来自
 * undici 包，而 Node 的全局 fetch 在不同版本间会拒绝它。
 */
const safeMcpFetch: FetchLike = async (url, init) => {
  const target = url.toString();

  const urlError = getCustomMcpServerUrlError(target);
  if (urlError) {
    throw new Error(`Refusing to call ${safeHost(target)}: ${urlError}`);
  }

  const response = await undiciFetch(target, {
    ...(init as UndiciRequestInit),
    redirect: "manual",
    dispatcher: safeMcpAgent,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Refusing to follow a redirect from ${safeHost(target)}: custom MCP servers may not redirect`,
    );
  }

  return response as unknown as Response;
};

/**
 * GET/HEAD-style fetch for arbitrary user-supplied public https URLs. Private
 * and internal targets are always refused and connections are pinned to the
 * checked addresses. Redirects are returned unfollowed (3xx responses) so the
 * caller can apply its own policy to each hop before requesting it.
 */
export async function safePublicFetch(
  url: string,
  init: Pick<UndiciRequestInit, "headers" | "signal"> = {},
): Promise<Response> {
  if (!url.startsWith("https://") || !isSafeExternalHttpUrl(url)) {
    throw new Error(
      `Refusing to fetch ${safeHost(url)}: not a public https URL`,
    );
  }

  const response = await undiciFetch(url, {
    ...init,
    redirect: "manual",
    dispatcher: publicOnlyAgent,
  });

  return response as unknown as Response;
}

function createSafeLookup(getAllowPrivateIps: () => boolean) {
  return (hostname: string, options: unknown, callback: LookupCallback) => {
    const allowPrivateIps = getAllowPrivateIps();

    const host = hostname.includes(":") ? `[${hostname}]` : hostname;

    resolveSafeExternalHttpUrl(`https://${host}`, { allowPrivateIps })
      .then((resolved) => {
        if (!resolved) {
          callback(
            Object.assign(
              new Error(`Refusing to call ${hostname}: not a public host`),
              { code: "ENOTFOUND" },
            ),
            "",
          );
          return;
        }

        resolved.lookup(hostname, options as never, callback);
      })
      .catch((error) => callback(error as NodeJS.ErrnoException, ""));
  };
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "服务器";
  }
}
