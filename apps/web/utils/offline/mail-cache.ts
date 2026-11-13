const MAIL_PATH = /^\/[^/]+\/mail\/?$/u;
export const ACCOUNT_PATH = "/api/user/email-accounts";
export const OFFLINE_MAIL_CACHE_PREFIX = "inbox-zero:offline-mail:";
export const MAIL_ENGINE_STATIC_CACHE = "inbox-zero:mail-engine-static";
export const CLEAR_OFFLINE_MAIL = "inbox-zero:clear-offline-mail";
export const CLEAR_OFFLINE_MAIL_ACCOUNT =
  "inbox-zero:clear-offline-mail-account";
export const SAVE_OFFLINE_MAIL = "inbox-zero:save-offline-mail";
export const SKIP_WAITING = "SKIP_WAITING";

type WaitUntil = (promise: Promise<unknown>) => void;

// 外壳文档和账号元数据让邮件路由在激活后可以从缓存存储重新打开。邮箱状态
// 保存在 SQLite 中；API 变更和身份认证始终走网络。
export function createOfflineMailCache({
  origin,
  cacheName,
}: {
  origin: string;
  cacheName: string;
}) {
  let generation = 0;
  let accountsGeneration = 0;
  let activeClears = 0;
  let writes: Promise<unknown> = Promise.resolve();
  const saves = new Map<string, Promise<void>>();
  const removedMailKeys = new Set<string>();

  function queueWrite(operation: (cache: Cache) => Promise<unknown>) {
    writes = writes
      .then(async () => operation(await caches.open(cacheName)))
      .catch(() => {});
    return writes;
  }

  async function clear() {
    generation++;
    activeClears++;
    saves.clear();
    try {
      await queueWrite(async (cache) => {
        await Promise.all((await cache.keys()).map((key) => cache.delete(key)));
      });
    } finally {
      activeClears--;
    }
  }

  async function handle(request: Request, waitUntil: WaitUntil) {
    const startedAtGeneration = activeClears ? undefined : generation;
    const startedAccountsGeneration = accountsGeneration;
    const url = new URL(request.url);
    // 邮件的查询参数用于选择同一账号的不同客户端视图。
    const key = `${origin}${url.pathname}`;
    const isDocument = isOfflineMailPath(url.pathname);
    const controller = new AbortController();
    const abortRequest = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortRequest, { once: true });
    if (request.signal.aborted) abortRequest();
    const networkTimeout = setTimeout(() => {
      controller.abort(new Error("邮箱请求超时"));
    }, 15_000);
    const cached = async () => {
      if (startedAtGeneration !== generation) return;
      try {
        // 正在进行的刷新不得阻止读取先前保存的副本。
        const response = await (await caches.open(cacheName)).match(key);
        return startedAtGeneration === generation ? response : undefined;
      } catch {
        return;
      }
    };
    const network = (async () => {
      const response = await fetch(request, { signal: controller.signal });
      const responsePath = response.url
        ? new URL(response.url).pathname
        : url.pathname;
      if (
        response.status === 401 ||
        response.status === 403 ||
        (isDocument && response.redirected && responsePath !== url.pathname)
      ) {
        if (startedAtGeneration === generation) await clear();
        return response;
      }
      if (response.status >= 500) {
        return (await cached()) ?? response;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (
        response.status === 200 &&
        contentType.includes(isDocument ? "text/html" : "application/json") &&
        startedAtGeneration === generation
      ) {
        // 流式 HTML 可能无限期停滞，但响应头可能已经到达。
        // 在文档真正可读之前，保持超时处于激活状态。
        await response.clone().arrayBuffer();
        const copy = response.clone();
        waitUntil(
          queueWrite(async (cache) => {
            // 在打开缓存存储或写入其他条目时仍可能发生退出登录。
            if (
              startedAtGeneration === generation &&
              !removedMailKeys.has(key) &&
              (key !== `${origin}${ACCOUNT_PATH}` ||
                startedAccountsGeneration === accountsGeneration)
            ) {
              await cache.put(key, copy);
            }
          }),
        );
      }
      return response;
    })().finally(() => {
      clearTimeout(networkTimeout);
      request.signal.removeEventListener("abort", abortRequest);
    });
    // 即使超时后已返回保存的文档，也要保留迟到的成功响应，
    // 以便刷新离线副本。
    waitUntil(network.catch(() => {}));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fallback = new Promise<Response>((resolve) => {
      timeout = setTimeout(async () => {
        const response = await cached();
        if (response) resolve(response);
      }, 3000);
    });
    try {
      return await Promise.race([
        network.catch(async (error: unknown) => {
          const response = await cached();
          if (response) return response;
          throw error;
        }),
        fallback,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  function save(url: string, waitUntil: WaitUntil): Promise<void> {
    const parsed = new URL(url);
    if (
      activeClears ||
      parsed.origin !== origin ||
      !isOfflineMailPath(parsed.pathname)
    )
      return Promise.resolve();
    const key = parsed.pathname;
    const existing = saves.get(key);
    if (existing) return existing;
    const startedAtGeneration = generation;
    const backgroundWork: Promise<unknown>[] = [];
    const trackWork: WaitUntil = (promise) => {
      backgroundWork.push(promise);
      waitUntil(promise);
    };
    const saving = (async () => {
      const response = await handle(
        new Request(url, {
          credentials: "include",
          headers: { Accept: "text/html" },
        }),
        trackWork,
      );
      if (
        response.status !== 200 ||
        response.redirected ||
        startedAtGeneration !== generation
      )
        return;
      await handle(
        new Request(`${origin}${ACCOUNT_PATH}`, {
          credentials: "include",
        }),
        trackWork,
      );
    })().finally(async () => {
      // 实时刷新仍在进行时，缓存回退可能已经返回。
      await Promise.all(backgroundWork);
      await writes;
      if (saves.get(key) === saving) saves.delete(key);
    });
    saves.set(key, saving);
    return saving;
  }

  async function removeAccount(accountId: string) {
    if (!isSafeOfflineMailAccountId(accountId)) return;
    const { mailKeys, accountsKey } = offlineMailAccountCacheKeys(
      origin,
      accountId,
    );
    for (const key of mailKeys) removedMailKeys.add(key);
    accountsGeneration += 1;
    await queueWrite(async (cache) => {
      await Promise.all(
        [...mailKeys, accountsKey].map((key) => cache.delete(key)),
      );
    });
  }

  return { handle, clear, save, removeAccount };
}

export function matchesOfflineMailRequest(request: Request, origin: string) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== origin) return false;
  if (request.headers.has("RSC")) return false;
  return (
    (request.mode === "navigate" && isOfflineMailPath(url.pathname)) ||
    (url.pathname === ACCOUNT_PATH && !url.search)
  );
}

export function matchesMailEngineStaticRequest(
  request: Request,
  origin: string,
) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== origin) return false;
  if (url.pathname.includes("hot-update") || url.pathname.endsWith(".map")) {
    return false;
  }
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".wasm") ||
    request.destination === "worker"
  );
}

export function isOfflineMailPath(pathname: string) {
  return MAIL_PATH.test(pathname);
}

export function isSafeOfflineMailAccountId(accountId: string) {
  return (
    accountId.length > 0 &&
    !accountId.includes("/") &&
    !accountId.includes("\\") &&
    !accountId.includes("..")
  );
}

export function offlineMailAccountCacheKeys(origin: string, accountId: string) {
  return {
    mailKeys: [`${origin}/${accountId}/mail`, `${origin}/${accountId}/mail/`],
    accountsKey: `${origin}${ACCOUNT_PATH}`,
  };
}

export function clearsOfflineMailOnGet(request: Request, origin: string) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== origin) return false;
  return (
    url.pathname === "/api/sso/signin" ||
    url.pathname.startsWith("/api/auth/sso/") ||
    (request.mode === "navigate" &&
      ["/login", "/welcome-redirect", "/connect-mailbox"].includes(
        url.pathname,
      ))
  );
}
