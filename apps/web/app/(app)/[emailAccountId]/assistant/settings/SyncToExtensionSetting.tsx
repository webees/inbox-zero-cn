"use client";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EXTENSION_URL } from "@/utils/config";
import { env } from "@/env";
import {
  mapRulesToExtensionTabs,
  type SyncTab,
} from "@/utils/rule/mapRulesToExtensionTabs";
import { useRules } from "@/hooks/useRules";
import { SettingCard } from "@/components/SettingCard";

interface SyncResponse {
  error?: string;
  success: boolean;
  summary?: { enabled: number; created: number; skipped: number };
}

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { message: string };
        sendMessage: (
          extensionId: string,
          message: { action: string; tabs?: SyncTab[]; accountIndex?: string },
          callback: (response: SyncResponse) => void,
        ) => void;
      };
    };
  }
}

function sendMessageToExtension(message: {
  action: string;
  tabs?: SyncTab[];
  accountIndex?: string;
}): Promise<SyncResponse> {
  return new Promise((resolve, reject) => {
    if (!window.chrome?.runtime?.sendMessage) {
      reject(new Error("not_chrome"));
      return;
    }
    if (!EXTENSION_ID) {
      reject(new Error("not_chrome"));
      return;
    }
    try {
      window.chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
        if (window.chrome?.runtime?.lastError) {
          reject(new Error("extension_not_found"));
          return;
        }
        resolve(response);
      });
    } catch {
      reject(new Error("extension_not_found"));
    }
  });
}

const EXTENSION_ID = env.NEXT_PUBLIC_TABS_EXTENSION_ID;

export function SyncToExtensionSetting() {
  const { t } = useLingui();
  const { data: rules } = useRules();
  const [open, setOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const allTabs = useMemo(() => mapRulesToExtensionTabs(rules || []), [rules]);

  function getTabKey(tab: SyncTab) {
    return tab.type === "enable_default" ? tab.tabId : tab.displayLabel;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setDeselected(new Set());
    setOpen(nextOpen);
  }

  function toggleTab(tab: SyncTab) {
    const key = getTabKey(tab);
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedTabs = allTabs.filter((tab) => !deselected.has(getTabKey(tab)));

  async function handleSync() {
    if (selectedTabs.length === 0) {
      toast.info(t`No tabs selected`);
      return;
    }

    setIsSyncing(true);
    try {
      await sendMessageToExtension({ action: "ping" });

      const result = await sendMessageToExtension({
        action: "syncTabs",
        tabs: selectedTabs,
      });

      if (result.success && result.summary) {
        const { enabled, created, skipped } = result.summary;
        const parts: string[] = [];
        if (enabled > 0)
          parts.push(
            t`${plural(enabled, { one: "# enabled", other: "# enabled" })}`,
          );
        if (created > 0)
          parts.push(
            t`${plural(created, { one: "# created", other: "# created" })}`,
          );
        if (skipped > 0)
          parts.push(
            t`${plural(skipped, { one: "# already existed", other: "# already existed" })}`,
          );
        const summary = parts.join(", ");
        toast.success(t`Synced tabs to extension: ${summary}`);
      } else {
        toast.error(t`将标签页同步到扩展程序失败`);
      }
      setOpen(false);
    } catch (error) {
      if (error instanceof Error && error.message === "not_chrome") {
        toast.error(t`同步到扩展程序需要使用 Chromium 浏览器`);
      } else {
        toast.error(t`未找到 Inbox Zero 标签页扩展程序。请先安装。`, {
          action: {
            label: t`安装`,
            onClick: () => window.open(EXTENSION_URL, "_blank"),
          },
        });
      }
    } finally {
      setIsSyncing(false);
    }
  }

  if (!EXTENSION_ID) return null;

  return (
    <SettingCard
      title={t`同步到浏览器扩展程序`}
      description={t`将你的规则同步到 Inbox Zero 标签页浏览器扩展程序。每个标签规则都会成为 Gmail 中的一个标签页。`}
      right={
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trans>同步</Trans>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                <Trans>将标签页同步到扩展程序</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>选择要同步为 Gmail 标签页的标签规则。</Trans>
              </DialogDescription>
            </DialogHeader>

            {allTabs.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                <Trans>未找到包含标签操作的规则。</Trans>
              </p>
            ) : (
              <div className="space-y-2 py-2">
                {allTabs.map((tab) => {
                  const key = getTabKey(tab);
                  const checkboxId = `sync-tab-${encodeURIComponent(key)}`;
                  const checked = !deselected.has(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={() => toggleTab(tab)}
                      />
                      <label
                        htmlFor={checkboxId}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {tab.displayLabel}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={handleSync}
                loading={isSyncing}
                disabled={selectedTabs.length === 0}
              >
                {t`同步 ${plural(selectedTabs.length, { one: "# 个标签页", other: "# 个标签页" })}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    />
  );
}
