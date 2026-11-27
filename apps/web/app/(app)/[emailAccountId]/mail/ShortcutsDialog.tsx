"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Kbd } from "@/components/Kbd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatShortcutKeys,
  getShortcutGroups,
  SHORTCUT_GROUP_LABELS,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";
import { shortcutsDialogOpenAtom } from "@/store/command-palette";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

const SCOPES: readonly ShortcutScope[] = ["global", "mail"];

/**
 * Rendered straight from the shortcut registry, so a binding can never be
 * 在此记录它而不让它生效——或者让它生效却不记录。
 */
export function ShortcutsDialog() {
  const { i18n } = useLingui();
  const [open, setOpen] = useAtom(shortcutsDialogOpenAtom);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const groups = getShortcutGroups(SCOPES, { isDesktopApp });

  useEffect(() => {
    setIsDesktopApp(Boolean(getInboxZeroDesktopApp()));
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>键盘快捷键</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>这里的所有操作都无需使用鼠标。</Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map(({ group, shortcuts }) => (
            <div key={group} className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-primary">
                {i18n._(SHORTCUT_GROUP_LABELS[group])}
              </div>
              {shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center gap-3">
                  <Kbd className="min-w-9">{formatShortcutKeys(shortcut)}</Kbd>
                  <span className="text-sm text-foreground">
                    {i18n._(shortcut.label)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
