// 离线、休眠或切换网络时的连接失败。邮件引擎和更新程序会自行重试，因此这些失败不值得上报。
// TLS 和 HTTP 失败不在此列：它们指向真正的问题。
const TRANSIENT_NODE_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_CHROMIUM_ERRORS = new Set([
  "net::ERR_ADDRESS_UNREACHABLE",
  "net::ERR_CONNECTION_ABORTED",
  "net::ERR_CONNECTION_CLOSED",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_NETWORK_IO_SUSPENDED",
  "net::ERR_TIMED_OUT",
]);

export function isTransientNetworkError(error: unknown): boolean {
  // Node 的 fetch 会抛出通用的「fetch failed」，并把套接字错误作为 cause。
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.name === "AbortError" || current.name === "TimeoutError") {
      return true;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_NODE_CODES.has(code)) return true;
    if (TRANSIENT_CHROMIUM_ERRORS.has(current.message)) return true;
    // 连接主机的每个地址都会各失败一次，聚合为一个错误。
    if (current instanceof AggregateError) {
      return (
        current.errors.length > 0 &&
        current.errors.every(isTransientNetworkError)
      );
    }
    current = current.cause;
  }
  return false;
}
