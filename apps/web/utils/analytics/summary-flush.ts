import posthog from "posthog-js";

const SUMMARY_FLUSH_INTERVAL_MS = 5 * 60 * 1000;

type CaptureSummary = (
  event: string,
  properties: Record<string, unknown>,
) => void;

/**
 * 每隔几分钟以及页面被隐藏时立即调用 `flush`，因为
 * 被隐藏的页面可能在再次可见之前就被丢弃。
 */
export function scheduleSummaryFlush(flush: (capture: CaptureSummary) => void) {
  setInterval(
    () => runWhenIdle(() => flush(captureQueued)),
    SUMMARY_FLUSH_INTERVAL_MS,
  );

  const flushNow = () => flush(captureWithBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

export function runWhenIdle(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 2000 });
  } else {
    setTimeout(callback, 0);
  }
}

function captureQueued(event: string, properties: Record<string, unknown>) {
  posthog.capture(event, properties);
}

// PostHog 的批次队列由其自身的 `pagehide` 监听器排空，该监听器可能
// 已经运行过，因此隐藏页面的摘要会跳过队列。
function captureWithBeacon(event: string, properties: Record<string, unknown>) {
  posthog.capture(event, properties, { transport: "sendBeacon" });
}
