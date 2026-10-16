"use client";

import { PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/utils";

export type MailSplitTab = {
  id: string;
  name: string;
  /** 内置分栏（例如“全部”）不能编辑或移除。 */
  deletable: boolean;
};

export type SplitTabsProps = {
  splits: MailSplitTab[];
  activeSplitId: string | null;
  /** 当前位于各分栏中的会话数。缺失的项和零保持空白。 */
  countsById?: ReadonlyMap<string, number>;
  onSelect: (splitId: string) => void;
  onDelete: (splitId: string) => void;
  onEdit?: (splitId: string) => void;
  onNewSplit: () => void;
  /** 创建分栏仍限定在单个账号内，因此在“全部账号”中隐藏。 */
  canCreateSplits: boolean;
  /** 位于标签之前，与下方的行复选框对齐。 */
  leading?: ReactNode;
  className?: string;
};

export function SplitTabs({
  splits,
  activeSplitId,
  countsById,
  onSelect,
  onDelete,
  onEdit,
  onNewSplit,
  canCreateSplits,
  leading,
  className,
}: SplitTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const tabs = tabsRef.current;
    const focusedTab = document.activeElement;
    if (
      !activeSplitId ||
      !(focusedTab instanceof HTMLButtonElement) ||
      !tabs?.contains(focusedTab) ||
      !focusedTab.hasAttribute("data-split-tab")
    ) {
      return;
    }

    activeTabRef.current?.focus({ preventScroll: true });
  }, [activeSplitId]);

  return (
    <div
      ref={tabsRef}
      className={cn(
        // 通过内边距使其位于工具栏搜索框下方而不是紧贴列边缘，
        // 并用分隔线隔开，使标签读起来像是列表的标题，
        // 而不是挤在第一行旁边。
        "flex flex-wrap items-center gap-1 border-border border-b px-3 pb-2",
        className,
      )}
    >
      {leading ? <span className="mr-1.5 flex">{leading}</span> : null}
      {splits.map((split) => {
        const active = split.id === activeSplitId;
        const countLabel = splitCountLabel(countsById?.get(split.id));

        return (
          <ContextMenu key={split.id}>
            <ContextMenuTrigger asChild disabled={!split.deletable}>
              <button
                type="button"
                ref={active ? activeTabRef : undefined}
                data-split-tab
                onClick={() => onSelect(split.id)}
                // 计数位于此按钮内，因此 innerText 会包含它。
                // 无障碍名称仍保持为分栏本身。
                aria-label={split.name}
                aria-current={active ? "true" : undefined}
                aria-description={
                  countLabel ? `${countLabel} 个位于此视图` : undefined
                }
                className={cn(
                  "flex items-center gap-1 rounded-full py-0.5 pr-2 pl-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span data-split-name>{split.name}</span>
                {countLabel ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "font-normal tabular-nums",
                      active ? "text-primary/70" : "opacity-70",
                    )}
                  >
                    {countLabel}
                  </span>
                ) : null}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              {onEdit && (
                <ContextMenuItem onSelect={() => onEdit(split.id)}>
                  编辑筛选条件和名称
                </ContextMenuItem>
              )}
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(split.id)}
              >
                关闭分栏
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      {canCreateSplits && (
        <button
          type="button"
          aria-label="新建分栏"
          onClick={onNewSplit}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function splitCountLabel(count: number | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  return count.toLocaleString("en-US");
}
