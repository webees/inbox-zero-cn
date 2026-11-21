"use client";

import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { useDesktopUpdateStatus } from "@/hooks/useDesktopUpdateStatus";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

const DESKTOP_UPDATE_TOAST_ID = "desktop-app-update";
const ANNOUNCED_VERSION_KEY = "desktop-update-announced-version";

export function DesktopUpdateToast() {
  const { t } = useLingui();
  const status = useDesktopUpdateStatus();
  const isVisible = useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === "visible",
    () => false,
  );
  const current = useRef(status);
  const dismissedVersion = useRef<string | null>(null);
  const shownReadyVersion = useRef<string | null>(null);

  useEffect(() => {
    current.current = status;

    if (status?.state === "ready") {
      dismissedVersion.current = null;
      // 每次加载页面和新窗口时都会重放“已就绪”状态，每次都提示会打扰用户
      // 每个版本只提示一次；侧边栏项仍作为重新启动的常驻入口
      // 桌面端标签页共享存储，因此只有可见的渲染进程可以认领提示
      if (!isVisible) return;
      if (shownReadyVersion.current === status.version) return;
      if (getAnnouncedVersion() === status.version) {
        toast.dismiss(DESKTOP_UPDATE_TOAST_ID);
        return;
      }
      setAnnouncedVersion(status.version);
      shownReadyVersion.current = status.version;
      toast(t`Inbox Zero ${status.version} 已就绪`, {
        id: DESKTOP_UPDATE_TOAST_ID,
        description: t`重启应用以完成更新。`,
        duration: Number.POSITIVE_INFINITY,
        onDismiss: undefined,
        action: {
          label: t`重启`,
          onClick: () => {
            getInboxZeroDesktopApp()?.installUpdate?.();
          },
        },
      });
      return;
    }

    if (status?.state !== "downloading") {
      dismissedVersion.current = null;
      toast.dismiss(DESKTOP_UPDATE_TOAST_ID);
      return;
    }
    // 关闭提示后仍会收到进度更新；不要重新打开同一下载的提示
    if (dismissedVersion.current === status.version) return;
    toast(t`正在下载 Inbox Zero ${status.version}`, {
      id: DESKTOP_UPDATE_TOAST_ID,
      description: (
        <div className="mt-2 flex items-center gap-2">
          <Progress value={status.percent} className="h-1.5" />
          <span className="w-9 text-right text-xs tabular-nums">
            {status.percent}%
          </span>
        </div>
      ),
      duration: Number.POSITIVE_INFINITY,
      action: undefined,
      onDismiss: () => {
        if (current.current?.state === "downloading") {
          dismissedVersion.current = current.current.version;
        }
      },
    });
  }, [status, isVisible, t]);

  useEffect(
    () => () => {
      toast.dismiss(DESKTOP_UPDATE_TOAST_ID);
    },
    [],
  );
  return null;
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getAnnouncedVersion() {
  try {
    return window.localStorage.getItem(ANNOUNCED_VERSION_KEY);
  } catch {
    return null;
  }
}

function setAnnouncedVersion(version: string) {
  try {
    window.localStorage.setItem(ANNOUNCED_VERSION_KEY, version);
  } catch {}
}
