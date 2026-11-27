import type { MailIpcSnapshotEvent } from "@inboxzero/mail-core/protocol/mail-ipc-client";
export type DesktopAuthProvider = "apple" | "google" | "microsoft";

export const DESKTOP_WEB_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export type InboxZeroDesktopApi = {
  /** 通知宿主外壳此页面已完成水合；若未通知，外壳会重新加载页面 */
  signalReady?: () => void;
  setUnreadCount?: (count: number) => void;
  openWindow?: (path: string) => Promise<void>;
  startAuth: (
    provider: DesktopAuthProvider,
    options?: { callbackPath?: string },
  ) => Promise<void>;
  supportsNoMatchingMessage?: boolean;
  mailEngine?: (payload: unknown) => Promise<unknown>;
  mailEngineSubscribe?: (input: unknown) => Promise<unknown>;
  mailEngineUnsubscribe?: (subscriptionId: string) => Promise<unknown>;
  onMailEngineSnapshot?: (
    listener: (event: MailIpcSnapshotEvent) => void,
  ) => () => void;
  onOpenSettings?: (listener: () => void) => () => void;
  onUpdateStatus?: (
    listener: (status: DesktopUpdateStatus) => void,
  ) => () => void;
  /** 应用正在打开本地邮箱时为 true，包括执行迁移期间 */
  onMailEngineOpening?: (listener: (opening: boolean) => void) => () => void;
  installUpdate?: () => Promise<void>;
  wipeMailbox?: () => Promise<unknown>;
  getDesktopHealth?: () => Promise<DesktopHealth | null>;
};

export type DesktopUpdateStatus =
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | null;

type DesktopDurationSummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

type DesktopMailSyncFreshness = {
  provider: "google" | "microsoft";
  connection: "ready" | "offline" | "blocked_auth";
  newestInboxMessageAgeMs: number | null;
  streams: number;
  streamsBehind: number;
  streamsPaused: number;
  oldestStreamCaughtUpAgeMs: number | null;
};

/** 自上次在任意窗口调用以来汇总的数据。 */
export type DesktopHealth = {
  version: string;
  intervalMs: number;
  mainEventLoopDelayMs: DesktopDurationSummary | null;
  engine: {
    running: boolean;
    restarts: number;
    child: {
      eventLoopDelayMs: DesktopDurationSummary | null;
      sqliteReadMs: DesktopDurationSummary | null;
      sqliteWriteMs: DesktopDurationSummary | null;
      mailCommandMs?: DesktopDurationSummary | null;
      /** 旧版桌面应用可能缺少此字段；每个本地账号一项。 */
      mailSync?: DesktopMailSyncFreshness[] | null;
    } | null;
  } | null;
  mailboxBytes: number;
};

declare global {
  interface Window {
    inboxZeroDesktop?: InboxZeroDesktopApi;
  }
}

export function getInboxZeroDesktopApp(): InboxZeroDesktopApi | undefined {
  if (typeof window === "undefined") return;
  return window.inboxZeroDesktop;
}

export function shouldCheckForDesktopWebUpdate({
  isDesktopApp,
  isOnline,
  isVisible,
  lastCheckedAt,
  now,
}: {
  isDesktopApp: boolean;
  isOnline: boolean;
  isVisible: boolean;
  lastCheckedAt: number | null;
  now: number;
}): boolean {
  if (!isDesktopApp || !isOnline || !isVisible) return false;
  return (
    lastCheckedAt === null ||
    now < lastCheckedAt ||
    now - lastCheckedAt >= DESKTOP_WEB_UPDATE_CHECK_INTERVAL_MS
  );
}
