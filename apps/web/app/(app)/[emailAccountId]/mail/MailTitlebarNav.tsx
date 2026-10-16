"use client";

import { useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/utils";

/**
 * 位于 Mac 窗口控制按钮旁的窗口控件：侧边栏折叠后的
 * 侧边栏开关，然后是后退/前进。桌面应用没有浏览器外框，
 * 因此需要自己的历史按钮；浏览器标签页则已经有这些按钮。
 */
export function MailTitlebarNav({
  showHistory,
  className,
}: {
  showHistory: boolean;
  className?: string;
}) {
  const { state } = useSidebar();
  const isSidebarOpen = state.includes("left-sidebar");
  const canGoBack = useSyncExternalStore(
    subscribeToHistory,
    () => getNavigation()?.canGoBack ?? false,
    () => false,
  );
  const canGoForward = useSyncExternalStore(
    subscribeToHistory,
    () => getNavigation()?.canGoForward ?? false,
    () => false,
  );

  if (isSidebarOpen && !showHistory) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        // 侧边栏及其开关只在 `lg` 及以上存在。
        !showHistory && "hidden lg:flex",
        className,
      )}
    >
      {isSidebarOpen ? null : (
        <SidebarTrigger
          name="left-sidebar"
          className="hidden size-8 text-muted-foreground lg:inline-flex"
        />
      )}
      {showHistory ? (
        <>
          <Tooltip content="后退">
            <button
              type="button"
              aria-label="后退"
              disabled={!canGoBack}
              onClick={() => window.history.back()}
              className={historyButton}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content="前进">
            <button
              type="button"
              aria-label="前进"
              disabled={!canGoForward}
              onClick={() => window.history.forward()}
              className={historyButton}
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

const historyButton =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function getNavigation(): Navigation | null {
  return "navigation" in window ? window.navigation : null;
}

function subscribeToHistory(onChange: () => void) {
  const navigation = getNavigation();
  navigation?.addEventListener("currententrychange", onChange);
  return () => navigation?.removeEventListener("currententrychange", onChange);
}
