const CLOSED_STREAM_RETRY_MS = 30_000;
// EventSource.CLOSED，而不在非浏览器运行时依赖该全局变量。
const EVENT_SOURCE_CLOSED = 2;

/**
 * 当服务器报告服务商发生变更时请求同步，使新邮件
 * 无需等待引擎的空闲补偿就能出现。隐藏的标签页会断开
 * 连接，并在再次可见时补偿。
 */
export function followMailboxChanges({
  accountId,
  onChange,
  createEventSource = (url) => new EventSource(url),
}: {
  accountId: string;
  onChange: () => void;
  createEventSource?: (url: string) => EventSource;
}) {
  const url = `/api/mail-stream?emailAccountId=${encodeURIComponent(accountId)}`;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (source || document.visibilityState === "hidden") return;
    const opened = createEventSource(url);
    source = opened;
    opened.addEventListener("mailbox-change", onChange);
    // Every (re)connect sends `ready`; changes while disconnected are not
    // 被重放，因此此时进行补偿。
    opened.addEventListener("ready", onChange);
    opened.addEventListener("error", () => {
      // EventSource 会自行重试断开的连接，但遇到错误响应
      // 就会放弃，否则该标签页将无法获得更新。
      if (opened.readyState !== EVENT_SOURCE_CLOSED || source !== opened)
        return;
      source = null;
      clearTimeout(retry);
      retry = setTimeout(open, CLOSED_STREAM_RETRY_MS);
    });
  };
  const close = () => {
    clearTimeout(retry);
    source?.close();
    source = null;
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") close();
    else open();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  open();
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    close();
  };
}
