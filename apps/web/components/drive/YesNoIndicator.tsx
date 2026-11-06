"use client";

import type { MouseEvent } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/utils";

interface YesNoIndicatorProps {
  /** 当值为 "wrong" 时，X 按钮会变为下拉触发器（不调用 onClick，也不 stopPropagation） */
  dropdownTrigger?: "wrong";
  onClick?: (value: boolean) => void;
  size?: "sm" | "md";
  value: boolean | null | undefined;
  /** 即使 value !== false，也强制让 X 按钮显示为激活（红色）状态 */
  wrongActive?: boolean;
}

export function YesNoIndicator({
  value,
  onClick,
  size = "md",
  dropdownTrigger,
  wrongActive,
}: YesNoIndicatorProps) {
  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  const isInteractive = !!onClick || !!dropdownTrigger;

  if (!isInteractive) {
    if (value === true) {
      return (
        <span
          className="rounded-full p-1.5 bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 inline-flex"
          role="status"
          aria-label="正确"
        >
          <CheckIcon className={iconSize} />
        </span>
      );
    }
    if (value === false) {
      return (
        <span
          className="rounded-full p-1.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 inline-flex"
          role="status"
          aria-label="错误"
        >
          <XIcon className={iconSize} />
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">&mdash;</span>;
  }

  const handleCheckClick = (e: MouseEvent) => {
    if (dropdownTrigger) e.stopPropagation();
    if (value !== true) onClick?.(true);
  };

  const handleXClick = (_e: MouseEvent) => {
    if (dropdownTrigger === "wrong") {
      // 让点击事件向上冒泡到 DropdownMenuTrigger 父元素
      return;
    }
    if (value !== false) onClick?.(false);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleCheckClick}
        onPointerDown={dropdownTrigger ? (e) => e.stopPropagation() : undefined}
        className={cn(
          "rounded-full p-1.5 transition-colors",
          value === true && !wrongActive
            ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 hover:opacity-80"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-label="正确"
      >
        <CheckIcon className={iconSize} />
      </button>
      <button
        type="button"
        onClick={handleXClick}
        className={cn(
          "rounded-full p-1.5 transition-colors",
          value === false || wrongActive
            ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 hover:opacity-80"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-label="错误"
      >
        <XIcon className={iconSize} />
      </button>
    </div>
  );
}
