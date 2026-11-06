"use client";

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
  type ShortcutScope,
} from "@/lib/shortcuts/registry";
import { shortcutsDialogOpenAtom } from "@/store/command-palette";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

const SCOPES: readonly ShortcutScope[] = ["global", "mail"];

/**
 * 直接根据快捷键注册表渲染，因此某个绑定不可能在这里被记录却没有
 * 绑定——也不可能被绑定却没有被记录。
 */
export function ShortcutsDialog() {
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
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>这里的一切都无需鼠标即可操作。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map(({ group, shortcuts }) => (
            <div key={group} className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-primary">{group}</div>
              {shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center gap-3">
                  <Kbd className="min-w-9">{formatShortcutKeys(shortcut)}</Kbd>
                  <span className="text-sm text-foreground">
                    {shortcut.label}
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
