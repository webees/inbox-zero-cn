import type { WebContents } from "electron";

const NAVIGATION_TIMEOUT_MS = 15_000;
// 从提交开始计时，因此覆盖到子资源和 hydration。仍在下载的页面在慢速链路上
// 会获得更多时间，直到上限。
const BOOT_CHECK_INTERVAL_MS = 30_000;
const MAX_BOOT_CHECKS = 3;
const FIRST_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 2 * 60_000;
const MAX_REPORTED_PATHS = 10;
const CONTENT_TYPE_TIMEOUT_MS = 5000;

export type DesktopBootFailure = {
  reason: "timeout" | "stylesheet-failed";
  attempt: number;
  documentFinished: boolean;
  stillLoading: boolean;
  failedRequests: Record<string, number>;
  netErrors: string[];
  failedPaths: string[];
};

/**
 * Keeps a window on the hosted app from getting stuck. A load only counts once
 * the web app signals it has hydrated (`markReady`): a document fetched while
 * the network is half-up can finish loading without its scripts or
 * stylesheets, which leaves an unstyled, dead page. Failures show a local
 * recovery page and retry with backoff.
 */
export function installDesktopLoadRecovery(
  contents: WebContents,
  {
    appOrigin,
    getStartUrl,
    onBootFailure,
  }: {
    appOrigin: string;
    getStartUrl: () => string;
    onBootFailure: (failure: DesktopBootFailure) => void;
  },
) {
  let targetUrl = getStartUrl();
  let showingRecovery = false;
  let loadingRecoveryPage = false;
  let booting = false;
  let booted = false;
  let documentFinished = false;
  let bootChecks = 0;
  let documentGeneration = 0;
  let failedAttempts = 0;
  let requestFailures = emptyRequestFailures();
  let navigationTimeout: ReturnType<typeof setTimeout> | undefined;
  let bootTimeout: ReturnType<typeof setTimeout> | undefined;
  let retryTimeout: ReturnType<typeof setTimeout> | undefined;

  function cancelTimers() {
    clearTimeout(navigationTimeout);
    clearTimeout(bootTimeout);
    clearTimeout(retryTimeout);
    navigationTimeout = undefined;
    bootTimeout = undefined;
    retryTimeout = undefined;
  }

  function showRecovery() {
    if (contents.isDestroyed()) return;
    cancelTimers();
    booting = false;
    booted = false;
    showingRecovery = true;
    loadingRecoveryPage = true;
    contents.loadURL(getDesktopRecoveryPage(targetUrl)).catch(() => {});
    retryTimeout = setTimeout(retryLoad, getRetryDelay(failedAttempts));
    failedAttempts++;
  }

  function failBoot(reason: DesktopBootFailure["reason"]) {
    onBootFailure({
      reason,
      attempt: failedAttempts + 1,
      documentFinished,
      stillLoading: contents.isLoading(),
      failedRequests: requestFailures.failedRequests,
      netErrors: [...requestFailures.netErrors],
      failedPaths: requestFailures.failedPaths,
    });
    contents.stop();
    showRecovery();
  }

  function checkBoot() {
    bootChecks++;
    if (contents.isLoading() && bootChecks < MAX_BOOT_CHECKS) {
      bootTimeout = setTimeout(checkBoot, BOOT_CHECK_INTERVAL_MS);
      return;
    }
    // 应用源上的路由处理程序（JSON、文件）不会挂载 Web 应用，因此无法发出信号。
    // 只有渲染进程知道它提交了什么。
    const generation = documentGeneration;
    readContentType(contents).then((contentType) => {
      if (
        contents.isDestroyed() ||
        !booting ||
        generation !== documentGeneration
      )
        return;
      if (contentType === null || contentType === "text/html") {
        failBoot("timeout");
        return;
      }
      markBooted();
    });
  }

  function markBooted() {
    clearTimeout(bootTimeout);
    bootTimeout = undefined;
    booting = false;
    booted = true;
    failedAttempts = 0;
  }

  function retryLoad() {
    if (!contents.isDestroyed()) contents.loadURL(targetUrl).catch(() => {});
  }

  contents.on(
    "did-start-navigation",
    ({ url, isSameDocument, isMainFrame }) => {
      if (!isMainFrame || !isAppUrl(url, appOrigin)) return;
      targetUrl = url;
      if (isSameDocument) return;
      cancelTimers();
      navigationTimeout = setTimeout(() => {
        contents.stop();
        showRecovery();
      }, NAVIGATION_TIMEOUT_MS);
    },
  );
  // 只对主框架的跨文档提交触发。在这里而不是导航开始时布防，意味着
  // 离开的文档发出的就绪信号不会被算到新文档上。从这里开始，能容忍
  // 缓慢但持续加载页面的启动看门狗会取代导航超时。
  contents.on("did-navigate", (_event, url) => {
    if (!isAppUrl(url, appOrigin)) return;
    clearTimeout(navigationTimeout);
    clearTimeout(bootTimeout);
    navigationTimeout = undefined;
    showingRecovery = false;
    booting = true;
    booted = false;
    documentFinished = false;
    bootChecks = 0;
    documentGeneration++;
    requestFailures = emptyRequestFailures();
    bootTimeout = setTimeout(checkBoot, BOOT_CHECK_INTERVAL_MS);
  });
  contents.on(
    "did-fail-load",
    (_event, code, _description, url, isMainFrame) => {
      // Chromium 会中止被取代的导航；图片和 iframe 绝不能把原本可用的
      // 收件箱替换成恢复界面。
      if (!isMainFrame || code === -3 || !isAppUrl(url, appOrigin)) return;
      targetUrl = url;
      showRecovery();
    },
  );
  contents.on("did-finish-load", () => {
    clearTimeout(navigationTimeout);
    navigationTimeout = undefined;
    if (booting) documentFinished = true;
  });
  contents.on("render-process-gone", showRecovery);
  contents.once("destroyed", cancelTimers);

  // 从“视图 > 重新加载”重新加载本地恢复页面应重试应用。
  contents.on("did-start-navigation", ({ url, isMainFrame }) => {
    if (!showingRecovery || !isMainFrame || !url.startsWith("data:text/html"))
      return;
    if (loadingRecoveryPage) {
      loadingRecoveryPage = false;
      return;
    }
    cancelTimers();
    retryTimeout = setTimeout(retryLoad, 0);
  });

  return {
    markReady() {
      if (!booting) return;
      // 脚本可以在没有 CSS 的情况下 hydrate，这仍会让应用无法使用。
      if (requestFailures.failedRequests.stylesheet) {
        failBoot("stylesheet-failed");
        return;
      }
      markBooted();
    },
    recordRequestError(details: {
      resourceType: string;
      url: string;
      error: string;
    }) {
      if (!booting || details.error === "net::ERR_ABORTED") return;
      const { failedRequests, netErrors, failedPaths } = requestFailures;
      failedRequests[details.resourceType] =
        (failedRequests[details.resourceType] ?? 0) + 1;
      netErrors.add(details.error);
      const blocksBoot =
        details.resourceType === "script" ||
        details.resourceType === "stylesheet";
      if (blocksBoot && failedPaths.length < MAX_REPORTED_PATHS) {
        failedPaths.push(URL.parse(details.url)?.pathname ?? "");
      }
    },
    /** 用于网络很可能恢复的时刻，例如从睡眠中唤醒。 */
    retryIfNotBooted() {
      if (booted || contents.isDestroyed()) return;
      if (!showingRecovery && !isAppUrl(contents.getURL(), appOrigin)) return;
      cancelTimers();
      retryLoad();
    },
  };
}

function getDesktopRecoveryPage(targetUrl: string) {
  const href = targetUrl
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Inbox Zero</title><style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafafa; color: #18181b; font: 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
main { max-width: 420px; padding: 40px; text-align: center; }
h1 { font-size: 24px; letter-spacing: -.5px; } p { color: #52525b; line-height: 1.6; }
a { display: inline-block; margin: 16px 0; padding: 12px 24px; background: #18181b; color: white; border-radius: 8px; text-decoration: none; }
small { display: block; color: #71717a; }
</style></head><body><main><h1>正在连接到 Inbox Zero</h1>
<p>无法加载您的邮箱。请检查网络连接。我们将自动重试。</p>
<a href="${href}">立即重试</a><small>您也可以使用 视图 → 重新加载。</small>
</main></body></html>`)}`;
}

function isAppUrl(url: string, origin: string) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function emptyRequestFailures() {
  return {
    failedRequests: {} as Record<string, number>,
    netErrors: new Set<string>(),
    failedPaths: [] as string[],
  };
}

function getRetryDelay(failedAttempts: number) {
  return Math.min(
    FIRST_RETRY_DELAY_MS * 2 ** failedAttempts,
    MAX_RETRY_DELAY_MS,
  );
}

// 卡死的渲染进程永远不会响应；把它当作未能启动的 HTML 页面处理。
function readContentType(contents: WebContents): Promise<string | null> {
  return Promise.race([
    contents
      .executeJavaScript("document.contentType")
      .then((value: unknown) => (typeof value === "string" ? value : null))
      .catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CONTENT_TYPE_TIMEOUT_MS),
    ),
  ]);
}
