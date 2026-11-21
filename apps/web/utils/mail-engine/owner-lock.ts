import { MAIL_ENGINE_OWNER_LOCK } from "./tab-channel";

export async function holdMailEngineOwner(input: {
  signal: AbortSignal;
  start: () => Promise<void>;
  close: () => Promise<void>;
}) {
  async function hold() {
    if (input.signal.aborted) return;
    try {
      await input.start();
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve();
          return;
        }
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      // 下一个标签页启动前，必须先释放 SQLite 的 OPFS 句柄。
      await input.close();
    }
  }
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    await navigator.locks.request(
      MAIL_ENGINE_OWNER_LOCK,
      { signal: input.signal },
      hold,
    );
    return;
  }
  await hold();
}
