"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { holdMailEngineOwner } from "./owner-lock";
import { reportMailEngineStartupFailure } from "./startup-failure";
import type { MailEngineStartupStage } from "./startup-error";
import { usePathname } from "next/navigation";
import type { MailClient } from "@inboxzero/mail-core/engine";
import { MailEngineProvider } from "@inboxzero/mail-react/MailEngineProvider";
import { LoadingContent } from "@/components/LoadingContent";
import { env } from "@/env";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  createBrowserMailEngine,
  type BrowserMailEngine,
} from "@/utils/mail-engine/create-browser-engine";
import {
  startDesktopIpcMailClient,
  hasDesktopMailEngineIpc,
} from "@/utils/mail-engine/desktop-ipc";
import {
  selectMailEngineRuntimeMode,
  shouldStartMailEngine,
} from "@/utils/mail-engine/runtime-mode";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { fetchEmailAccounts } from "@/utils/fetch-email-accounts";
import { followMailboxChanges } from "@/utils/mail-engine/follow-mailbox-changes";
import { browserMailEngineCapabilities } from "@/utils/mail-engine/worker-protocol";
import {
  MAIL_ENGINE_TAB_CHANNEL,
  bindTabMailOwner,
  createBroadcastTabBus,
  createTabFollowerClient,
  disposeTabFollowerClient,
} from "@/utils/mail-engine/tab-channel";
import {
  setActiveMailClient,
  subscribeMailEngineLogout,
} from "@/utils/mail-engine/active-client";

type MailEngineRuntimeStatus = {
  client: MailClient | null;
  mounted: boolean;
  failed: boolean;
  retry: () => void;
  requestBrowserEngine: () => void;
};

type MailEngineInspectTransport = "browser" | "desktop-ipc";

const MailEngineRuntimeStatusContext = createContext<MailEngineRuntimeStatus>({
  client: null,
  mounted: false,
  failed: false,
  retry: () => {},
  requestBrowserEngine: () => {},
});

export function useMailEngineDemand() {
  const { requestBrowserEngine } = useContext(MailEngineRuntimeStatusContext);
  useEffect(requestBrowserEngine, [requestBrowserEngine]);
}

export function MailEngineRuntime({ children }: { children: ReactNode }) {
  const status = useContext(MailEngineRuntimeStatusContext);
  if (status.mounted) return children;
  return <MailEngineRuntimeInner>{children}</MailEngineRuntimeInner>;
}

export function MailEngineHost({ children }: { children: ReactNode }) {
  return (
    <MailEngineRuntime>
      <MailCoverageGate>{children}</MailCoverageGate>
    </MailEngineRuntime>
  );
}

export function MailCoverageGate({ children }: { children: ReactNode }) {
  const status = useContext(MailEngineRuntimeStatusContext);
  // SSR 没有 OPFS；在水合之前检查能力会渲染出
  // 存储错误的外壳，而不是共享的加载状态。
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  if (!isClient) {
    return <LoadingContent loading>{null}</LoadingContent>;
  }
  const mode = selectMailEngineRuntimeMode({
    desktopIpc: hasDesktopMailEngineIpc(),
    ...browserMailEngineCapabilities(),
  });
  if (status.failed || mode === "unavailable") {
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10">
            <AlertCircle className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>
            {status.failed ? "邮件无法启动" : "此浏览器不支持邮件"}
          </EmptyTitle>
          <EmptyDescription>
            {status.failed
              ? "请重试。如果问题持续出现，请使用非隐私窗口和最新版浏览器。"
              : "邮件功能需要支持持久化文件存储（OPFS）和 Web Worker 的浏览器。请使用非隐私窗口中的最新版浏览器。"}
          </EmptyDescription>
        </EmptyHeader>
        {status.failed && (
          <Button variant="outline" onClick={status.retry}>
            重试
          </Button>
        )}
      </Empty>
    );
  }
  if (!status.client) {
    return <LoadingContent loading>{null}</LoadingContent>;
  }
  return children;
}

function MailEngineRuntimeInner({ children }: { children: ReactNode }) {
  const { emailAccountId, provider } = useAccount();
  const pathname = usePathname();
  const desktopIpc = useSyncExternalStore(
    subscribeNever,
    hasDesktopMailEngineIpc,
    () => false,
  );
  const [browserRequested, setBrowserRequested] = useState(false);
  const requestBrowserEngine = useCallback(() => setBrowserRequested(true), []);
  const enabled = shouldStartMailEngine({
    pathname,
    desktopIpc,
    browserRequested,
  });
  const [client, setClient] = useState<MailClient | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry must tear down the previous attempt and start a new engine.
  useEffect(() => {
    if (!emailAccountId || !provider || !enabled) {
      setFailed(false);
      return;
    }
    // 在发起页面或写信窗口关闭后，保持排队中的发送和撤销继续工作。
    if (!desktopIpc) requestBrowserEngine();
    setFailed(false);
    const capabilities = browserMailEngineCapabilities();
    const mode = selectMailEngineRuntimeMode({ desktopIpc, ...capabilities });
    if (mode === "unavailable") {
      return;
    }
    const mailProvider = isMicrosoftProvider(provider) ? "microsoft" : "google";
    const abort = new AbortController();
    let published: MailClient | undefined;
    let stage: MailEngineStartupStage =
      mode === "desktop-ipc" ? "desktop-client" : "owner-lock";
    function fail(error: unknown) {
      if (abort.signal.aborted) return;
      setFailed(true);
      report(error, stage);
    }

    function report(error: unknown, stage: MailEngineStartupStage) {
      if (abort.signal.aborted) return;
      reportMailEngineStartupFailure(error, {
        runtimeMode: mode,
        platform: getInboxZeroDesktopApp() ? "desktop" : "web",
        capabilities,
        stage,
      });
    }

    async function publishClient(
      next: MailClient,
      role: "owner" | "follower",
      transport: MailEngineInspectTransport,
    ) {
      if (abort.signal.aborted) return;
      stage = "publish-client";
      if (published && published !== next) disposeTabFollowerClient(published);
      published = next;
      publishMailEngineInspect(next, emailAccountId, role, transport);
      setActiveMailClient(next);
      setFailed(false);
      setClient(next);
    }

    if (mode === "desktop-ipc") {
      startDesktopIpcMailClient({
        provider: mailProvider,
        accountId: emailAccountId,
        publish: (client) => publishClient(client, "owner", "desktop-ipc"),
        onSyncError: (error) => report(error, "desktop-sync"),
      }).catch(fail);
      const unsubscribeLogout = subscribeMailEngineLogout(() => abort.abort());
      return () => {
        unsubscribeLogout();
        abort.abort();
        if (published) disposeTabFollowerClient(published);
        clearMailEngineInspect();
        setActiveMailClient(null);
        setClient(null);
      };
    }

    let engine: BrowserMailEngine | undefined;
    let unbindOwner: (() => void) | undefined;
    let unbindHello: (() => void) | undefined;
    let channel: BroadcastChannel | null = null;
    stage = "tab-channel";
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(MAIL_ENGINE_TAB_CHANNEL);
      }
    } catch (error) {
      fail(error);
      return;
    }
    const bus = channel ? createBroadcastTabBus(channel) : null;

    if (bus) {
      unbindHello = bus.subscribe((message) => {
        if (message.type === "ready" && !engine && !published) {
          bus.post({
            type: "hello",
            accountId: emailAccountId,
            provider: mailProvider,
          });
          return;
        }
        if (
          message.type !== "owner" ||
          message.accountId !== emailAccountId ||
          engine ||
          published
        ) {
          return;
        }
        publishClient(
          createTabFollowerClient({
            accountId: emailAccountId,
            provider: mailProvider,
            bus,
          }),
          "follower",
          "browser",
        ).catch(fail);
      });
      bus.post({
        type: "hello",
        accountId: emailAccountId,
        provider: mailProvider,
      });
    }

    async function start() {
      stage = "owner-lock";
      const create = async () => {
        stage = "browser-start";
        engine = await createBrowserMailEngine({
          accountId: emailAccountId,
          provider: mailProvider,
          online: typeof navigator === "undefined" || navigator.onLine,
        });
        if (abort.signal.aborted) {
          return;
        }
        if (bus) {
          unbindOwner = bindTabMailOwner({
            client: engine,
            bus,
            ensureAccount: engine.ensureAccount,
          });
          bus.post({ type: "ready" });
        }
        await publishClient(engine, "owner", "browser");
      };
      await holdMailEngineOwner({
        signal: abort.signal,
        start: create,
        close: async () => {
          unbindOwner?.();
          await engine?.close().catch(() => undefined);
        },
      });
    }

    start().catch(fail);

    const unsubscribeLogout = subscribeMailEngineLogout(() => {
      abort.abort();
    });

    return () => {
      unsubscribeLogout();
      abort.abort();
      unbindOwner?.();
      unbindHello?.();
      if (published) disposeTabFollowerClient(published);
      clearMailEngineInspect();
      setActiveMailClient(null);
      channel?.close();
      setClient(null);
    };
  }, [
    emailAccountId,
    provider,
    enabled,
    desktopIpc,
    requestBrowserEngine,
    attempt,
  ]);

  useEffect(() => {
    if (!client || !emailAccountId) return;
    let cancelled = false;
    // 在其他设备上删除的账号会保留在此设备的本地存储中，
    // 并持续同步，直到服务器列表显示它们已消失。当前打开的
    // 账号也会保留，因为组织管理员可能正在查看成员的邮件。
    fetchEmailAccounts()
      .then(({ emailAccounts }) => {
        if (cancelled || emailAccounts.length === 0) return;
        return client.retainAccounts([
          emailAccountId,
          ...emailAccounts.map((account) => account.id),
        ]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, emailAccountId]);

  useEffect(() => {
    // 桌面引擎会自行跟踪邮箱变化。
    if (!client || !emailAccountId || hasDesktopMailEngineIpc()) return;
    return followMailboxChanges({
      accountId: emailAccountId,
      onChange: () => {
        client.requestSync([emailAccountId]).catch(() => undefined);
      },
    });
  }, [client, emailAccountId]);

  useEffect(() => {
    if (!client || !emailAccountId) return;
    const resumeDeferred = () => {
      if (!navigator.onLine) return;
      client.requestSync([emailAccountId]).catch(() => undefined);
    };
    window.addEventListener("online", resumeDeferred);
    return () => window.removeEventListener("online", resumeDeferred);
  }, [client, emailAccountId]);

  return (
    <MailEngineRuntimeStatusContext.Provider
      value={{ client, mounted: true, failed, retry, requestBrowserEngine }}
    >
      <MailEngineProvider client={client}>{children}</MailEngineProvider>
    </MailEngineRuntimeStatusContext.Provider>
  );
}

function publishMailEngineInspect(
  client: MailClient,
  accountId: string,
  role: "owner" | "follower",
  transport: MailEngineInspectTransport,
) {
  if (!canExposeMailEngineInspect()) return;
  window.__inboxZeroMailInspect = {
    accountId,
    role,
    transport,
    capabilities: browserMailEngineCapabilities(),
    read: () => client.getDiagnostics(accountId),
    requestSync: () => client.requestSync([accountId]),
    inspect: () =>
      "inspect" in client && typeof client.inspect === "function"
        ? (
            client as MailClient & {
              inspect: () => Promise<unknown>;
            }
          ).inspect()
        : Promise.resolve(null),
  };
}

function clearMailEngineInspect() {
  if (typeof window === "undefined") return;
  window.__inboxZeroMailInspect = undefined;
}

function canExposeMailEngineInspect() {
  return (
    typeof window !== "undefined" &&
    (process.env.NODE_ENV !== "production" ||
      env.NEXT_PUBLIC_MAIL_ENGINE_TEST_INSPECT)
  );
}

function subscribeNever() {
  return () => undefined;
}

declare global {
  interface Window {
    __inboxZeroMailInspect?: {
      accountId: string;
      role: "owner" | "follower";
      transport: MailEngineInspectTransport;
      capabilities: ReturnType<typeof browserMailEngineCapabilities>;
      read: () => Promise<unknown>;
      requestSync: () => Promise<unknown>;
      inspect: () => Promise<unknown>;
    };
  }
}
