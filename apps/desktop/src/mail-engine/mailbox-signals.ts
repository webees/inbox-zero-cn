const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
const ACCOUNT_RESCAN_MS = 5000;
const CHANGE_EVENT_LINES = new Set(["event: mailbox-change", "event: ready"]);

export function consumeMailboxSignalBuffer(buffer: string) {
  const events = buffer.split("\n\n");
  const rest = events.pop() ?? "";
  // 每次（重新）连接都会发送 `ready`；断开期间的变更不会被重放，
  // 因此把它当作一次变更立即追赶。
  const changed = events.some((event) =>
    event.split("\n").some((line) => CHANGE_EVENT_LINES.has(line.trim())),
  );
  return { rest, changed };
}

export async function followMailboxSignal(input: {
  origin: string;
  accountId: string;
  cookieHeader: (url: string) => Promise<string> | string;
  signal: AbortSignal;
  onChange: () => void;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  let retryMs = INITIAL_RETRY_MS;
  while (!input.signal.aborted) {
    try {
      await readMailboxSignal(input, fetchImpl);
      retryMs = INITIAL_RETRY_MS;
      if (input.signal.aborted) return;
      await abortableDelay(INITIAL_RETRY_MS, input.signal);
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) return;
      await abortableDelay(retryMs, input.signal);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }
  }
}

export async function watchMailboxSignals(input: {
  readAccountIds: () => Promise<string[]>;
  follow: (
    accountId: string,
    signal: AbortSignal,
    onChange: () => void,
  ) => Promise<void>;
  onChange: (accountId: string) => Promise<void> | void;
  signal: AbortSignal;
  rescanMs?: number;
}) {
  const active = new Map<string, AbortController>();
  const follows = new Set<Promise<void>>();
  const changes = new Set<Promise<void>>();
  try {
    while (!input.signal.aborted) {
      let accountIds: string[];
      try {
        accountIds = await input.readAccountIds();
      } catch {
        await abortableDelay(input.rescanMs ?? ACCOUNT_RESCAN_MS, input.signal);
        continue;
      }
      const wanted = new Set(accountIds);
      for (const [accountId, controller] of active) {
        if (wanted.has(accountId)) continue;
        controller.abort();
        active.delete(accountId);
      }
      for (const accountId of wanted) {
        if (active.has(accountId)) continue;
        const controller = new AbortController();
        const abortChild = () => controller.abort();
        input.signal.addEventListener("abort", abortChild, { once: true });
        active.set(accountId, controller);
        startAccountFollow({
          input,
          accountId,
          controller,
          active,
          abortChild,
          follows,
          changes,
        });
      }
      await abortableDelay(input.rescanMs ?? ACCOUNT_RESCAN_MS, input.signal);
    }
  } finally {
    for (const controller of active.values()) controller.abort();
    active.clear();
    // 跟随者在退订过程中仍可能发出同步。要在跟随者自身之后排空，
    // 这样关闭时不会与引擎产生竞态。
    await Promise.allSettled(follows);
    await Promise.allSettled(changes);
  }
}

function startAccountFollow({
  input,
  accountId,
  controller,
  active,
  abortChild,
  follows,
  changes,
}: {
  input: Parameters<typeof watchMailboxSignals>[0];
  accountId: string;
  controller: AbortController;
  active: Map<string, AbortController>;
  abortChild: () => void;
  follows: Set<Promise<void>>;
  changes: Set<Promise<void>>;
}) {
  track(
    follows,
    input
      .follow(accountId, controller.signal, () => {
        const pending = input.onChange(accountId);
        if (pending instanceof Promise) track(changes, pending);
      })
      .finally(() => {
        input.signal.removeEventListener("abort", abortChild);
        if (active.get(accountId) === controller) active.delete(accountId);
      }),
  );
}

async function readMailboxSignal(
  input: {
    origin: string;
    accountId: string;
    cookieHeader: (url: string) => Promise<string> | string;
    signal: AbortSignal;
    onChange: () => void;
  },
  fetchImpl: typeof fetch,
) {
  const url = new URL("/api/mail-stream", input.origin);
  url.searchParams.set("emailAccountId", input.accountId);
  const cookieHeader = await cookieFor(
    input.cookieHeader,
    url.toString(),
    input.signal,
  );
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/event-stream",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`邮箱信号请求失败（${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!input.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const consumed = consumeMailboxSignalBuffer(buffer);
      buffer = consumed.rest;
      if (consumed.changed) input.onChange();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function cookieFor(
  cookieHeader: (url: string) => Promise<string> | string,
  url: string,
  signal: AbortSignal,
) {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(cookieHeader(url)).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function track(work: Set<Promise<void>>, pending: Promise<unknown>) {
  const settled = pending.then(
    () => undefined,
    () => undefined,
  );
  work.add(settled);
  settled.finally(() => {
    work.delete(settled);
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function abortError() {
  return new DOMException("操作已中止", "AbortError");
}
