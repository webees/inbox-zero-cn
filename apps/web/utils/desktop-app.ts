import type { MailIpcSnapshotEvent } from "@inboxzero/mail-core/protocol/mail-ipc-client";
export type DesktopAuthProvider = "apple" | "google" | "microsoft";

export const DESKTOP_WEB_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export type InboxZeroDesktopApi = {
  /** 告知外壳此页面已完成水合；否则外壳会重新加载页面。 */
  signalReady?: () => void;
  setUnreadCount?: (count: number) => void;
  openWindow?: (path: string) => Promise<void>;
  startAuth: (
    provider: DesktopAuthProvider,
    options?: { callbackPath?: string },
  ) => Promise<void>;
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

/** 自任一窗口上次调用以来聚合的数据。 */
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
