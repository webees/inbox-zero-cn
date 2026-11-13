import { z } from "zod";

const MICROSOFT_GRAPH_PAGE_TOKEN_HOSTS = new Set([
  "graph.microsoft.com",
  "graph.microsoft.us",
  "dod-graph.microsoft.us",
  "graph.microsoft.de",
  "microsoftgraph.chinacloudapi.cn",
  "canary.graph.microsoft.com",
]);

const URL_PAGE_TOKEN_PATTERN = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;
const SDK_EMBEDDED_URL_PATTERN = /https:\/\//i;

export function isAbsoluteUrlPageToken(pageToken?: string | null): boolean {
  return Boolean(
    pageToken &&
      (URL_PAGE_TOKEN_PATTERN.test(pageToken) ||
        SDK_EMBEDDED_URL_PATTERN.test(pageToken)),
  );
}

export function isAllowedMicrosoftGraphPageToken(
  pageToken?: string | null,
): boolean {
  if (!isAbsoluteUrlPageToken(pageToken)) return true;

  try {
    const url = new URL(pageToken!);

    return (
      url.protocol === "https:" &&
      MICROSOFT_GRAPH_PAGE_TOKEN_HOSTS.has(url.hostname.toLowerCase()) &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}

// 如果 `pageToken` 是 @odata.nextLink，则返回要传给 Microsoft Graph 的 URL，
// 对不透明的续传令牌返回 `null`，如果该令牌是指向 Graph 端点
// 以外位置的绝对 URL 则抛出错误（SSRF 防护）。
export function resolveMicrosoftGraphNextLink(
  pageToken?: string | null,
): string | null {
  if (!isAllowedMicrosoftGraphPageToken(pageToken)) {
    throw new Error("无效的 Outlook 页面令牌");
  }
  if (pageToken?.startsWith("/v1.0/") || pageToken?.startsWith("/beta/")) {
    return `https://graph.microsoft.com${pageToken}`;
  }
  return isAbsoluteUrlPageToken(pageToken) ? pageToken! : null;
}

export const microsoftGraphPageTokenSchema = z
  .string()
  .nullish()
  .refine(isAllowedMicrosoftGraphPageToken, { message: "无效的页面令牌" });
