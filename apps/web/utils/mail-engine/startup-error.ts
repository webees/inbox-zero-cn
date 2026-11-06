export type MailEngineStartupStage =
  | "tab-channel"
  | "owner-lock"
  | "browser-start"
  | "worker-load"
  | "worker-start"
  | "wasm-init"
  | "opfs-open"
  | "store-init"
  | "account-init"
  | "initial-sync"
  | "publish-client"
  | "desktop-client"
  | "desktop-sync";

export class MailEngineStartupError extends Error {
  readonly stage: MailEngineStartupStage;

  constructor(stage: MailEngineStartupStage, error: unknown) {
    super(error instanceof Error ? error.message : "邮件引擎启动失败");
    this.name = error instanceof Error ? error.name : "Error";
    this.stage = stage;
    // 保留出错的调用位置，但不复制任意错误负载。
    if (error instanceof Error && error.stack) this.stack = error.stack;
  }
}
