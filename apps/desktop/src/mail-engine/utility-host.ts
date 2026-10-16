import { randomUUID } from "node:crypto";
import { isObservationRequest, parseMailIpcRequest } from "./ipc";
import type { DesktopMailOwner } from "./owner";
import type {
  ChildHealth,
  ChildToMainMessage,
  MainToChildMessage,
} from "./utility-child";

const RESTART_BASE_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 60_000;
// 保持运行这么久的子进程会被重新视为健康，因此之后的崩溃会快速重启，
// 而不会继承旧的退避时间。
const STABLE_UPTIME_MS = 60_000;
const CLOSE_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;

/** 代理使用的 Electron `UtilityProcess` 接口面。 */
export type MailChildProcess = {
  postMessage(message: MainToChildMessage): void;
  on(
    event: "message",
    listener: (message: ChildToMainMessage) => void,
  ): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
};

export type DesktopMailProcessOwner = DesktopMailOwner & {
  health(): Promise<{
    running: boolean;
    restarts: number;
    child: ChildHealth | null;
  }>;
};

/**
 * Main-process proxy for the mail engine running in a utility process. Keeps
 * session cookies and crash recovery here, and the engine and SQLite there.
 */
export function createDesktopMailProcessOwner(input: {
  databasePath: string;
  origin: string;
  fork: () => MailChildProcess;
  cookieHeader: (url: string) => Promise<string>;
  onEngineError: (error: Error) => void;
  onNewMail?: (payload: unknown) => void;
}): DesktopMailProcessOwner {
  const subscriptions = new Map<
    string,
    { payload: unknown; onSnapshot: (snapshot: unknown) => void }
  >();
  let current: RunningChild | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let consecutiveCrashes = 0;
  let restarts = 0;
  let closed = false;

  function spawn() {
    const child = input.fork();
    const channel: ChildChannel = { child, pending: new Map() };
    child.on("message", (message) => handleMessage(running, message));
    const exited = new Promise<void>((resolve) => {
      child.on("exit", (code) => {
        resolve();
        handleExit(running, code);
      });
    });
    const ready = call(channel, (id) => ({
      type: "start",
      id,
      databasePath: input.databasePath,
      origin: input.origin,
    })).then(() => {
      running.isReady = true;
      for (const [subscriptionId, { payload }] of subscriptions) {
        child.postMessage({ type: "subscribe", subscriptionId, payload });
      }
    });
    // 无法打开邮箱的子进程会以退避方式重启。在 start 回复之前退出或关闭
    // 会先清除 `current` 或设置 `closed`，而退出处理程序已经上报了崩溃。
    ready.catch((error: unknown) => {
      if (closed || running !== current) return;
      input.onEngineError(asError(error));
      running.exitReported = true;
      child.kill();
    });
    const running: RunningChild = {
      ...channel,
      startedAt: Date.now(),
      isReady: false,
      exitReported: false,
      ready,
      exited,
    };
    current = running;
    return running;
  }

  async function callReady(message: (id: string) => MainToChildMessage) {
    const running = requireChild();
    await running.ready;
    return call(running, message);
  }

  function requireChild() {
    if (closed) throw new Error("邮件引擎已关闭");
    if (current) return current;
    if (restartTimer) throw new Error("邮件引擎正在重启");
    return spawn();
  }

  function handleMessage(running: RunningChild, message: ChildToMainMessage) {
    switch (message.type) {
      case "reply": {
        const waiter = running.pending.get(message.id);
        running.pending.delete(message.id);
        if (message.status === "ok") waiter?.resolve(message.result);
        else waiter?.reject(new Error(message.message));
        return;
      }
      case "newMail":
        if (running === current && !closed) input.onNewMail?.(message.payload);
        return;
      case "snapshot":
        if (running === current) {
          subscriptions
            .get(message.subscriptionId)
            ?.onSnapshot(message.snapshot);
        }
        return;
      case "engineError": {
        const error = new Error(message.message);
        if (message.stack) error.stack = message.stack;
        input.onEngineError(error);
        return;
      }
      case "cookieHeaderRequest":
        readCookieHeader(message.url).then((cookieHeader) => {
          if (running !== current) return;
          running.child.postMessage({
            type: "cookieHeader",
            requestId: message.requestId,
            cookieHeader,
          });
        });
        return;
      default: {
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  }

  // 子进程按 URL 请求 cookie，因此只有应用源会拿到它们。
  async function readCookieHeader(url: string) {
    if (URL.parse(url)?.origin !== new URL(input.origin).origin) return "";
    try {
      return await input.cookieHeader(url);
    } catch {
      return "";
    }
  }

  function handleExit(running: RunningChild, code: number) {
    for (const waiter of running.pending.values()) {
      waiter.reject(new Error("邮件引擎进程已退出"));
    }
    running.pending.clear();
    if (running !== current) return;
    current = undefined;
    if (closed) return;
    consecutiveCrashes =
      Date.now() - running.startedAt >= STABLE_UPTIME_MS
        ? 1
        : consecutiveCrashes + 1;
    const delay = Math.min(
      RESTART_MAX_DELAY_MS,
      RESTART_BASE_DELAY_MS * 2 ** (consecutiveCrashes - 1),
    );
    // 退出或安装更新可能在应用的退出处理程序运行前就杀掉子进程。
    // 只在重启仍待执行、且 close() 已有机会取消它时才上报，
    // 可以将这些退出排除在崩溃报告之外。
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (!running.exitReported) {
        input.onEngineError(
          new Error(
            `mail engine process exited unexpectedly with code ${code}`,
          ),
        );
      }
      restarts += 1;
      spawn();
    }, delay);
  }

  spawn();

  return {
    async handleIpc(payload) {
      return (await callReady((id) => ({
        type: "ipc",
        id,
        payload,
      }))) as Awaited<ReturnType<DesktopMailOwner["handleIpc"]>>;
    },
    subscribe(payload, onSnapshot) {
      const parsed = parseMailIpcRequest(payload);
      if (!parsed.success || !isObservationRequest(parsed.data)) return null;
      const subscriptionId = randomUUID();
      subscriptions.set(subscriptionId, { payload, onSnapshot });
      // 在子进程就绪之前，它的 start 会发送每一个订阅。
      if (current?.isReady) {
        current.child.postMessage({
          type: "subscribe",
          subscriptionId,
          payload,
        });
      }
      return () => {
        if (!subscriptions.delete(subscriptionId)) return;
        current?.child.postMessage({ type: "unsubscribe", subscriptionId });
      };
    },
    async recover() {
      await callReady((id) => ({ type: "recover", id }));
    },
    async health() {
      const running = current;
      if (!running?.isReady) return { running: false, restarts, child: null };
      const child = (await withTimeout(
        call(running, (id) => ({ type: "health", id })),
        HEALTH_TIMEOUT_MS,
      ).catch(() => null)) as ChildHealth | null;
      return { running: true, restarts, child };
    },
    async close() {
      closed = true;
      clearTimeout(restartTimer);
      restartTimer = undefined;
      subscriptions.clear();
      const running = current;
      if (!running) return;
      // 擦除接下来会删除数据库文件，因此子进程必须已经退出。
      await withTimeout(
        running.ready.then(() =>
          call(running, (id) => ({ type: "close", id })),
        ),
        CLOSE_TIMEOUT_MS,
      ).catch(() => undefined);
      running.child.kill();
      await running.exited;
    },
  };
}

type ChildChannel = {
  child: MailChildProcess;
  pending: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
};

type RunningChild = ChildChannel & {
  startedAt: number;
  isReady: boolean;
  /** 当退出原因已上报时设置。 */
  exitReported: boolean;
  ready: Promise<void>;
  exited: Promise<void>;
};

function call(
  channel: ChildChannel,
  message: (id: string) => MainToChildMessage,
) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    channel.pending.set(id, { resolve, reject });
    channel.child.postMessage(message(id));
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("超时")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
