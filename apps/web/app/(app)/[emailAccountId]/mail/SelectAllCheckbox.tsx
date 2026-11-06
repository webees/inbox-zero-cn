"use client";

import { Tooltip } from "@/components/Tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils";

export function SelectAllCheckbox({
  threadCount,
  selectedCount,
  onSelectAll,
  onClearSelection,
}: {
  threadCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const allSelected = threadCount > 0 && selectedCount === threadCount;

  return (
    <Tooltip
      content={allSelected ? "取消选择所有会话" : undefined}
      shortcuts={
        allSelected ? undefined : [{ id: "selectAll", label: "选择所有会话" }]
      }
    >
      <Checkbox
        aria-label="选择所有会话"
        checked={allSelected}
        className={cn(mailCheckboxClassName, "shrink-0")}
        disabled={threadCount === 0}
        onCheckedChange={(value) => {
          if (value === true) {
            onSelectAll();
          } else {
            onClearSelection();
          }
        }}
      />
    </Tooltip>
  );
}

/**
 * 行复选框共用此项样式，让全选与行选择对齐且外观一致。
 * 以 `aria-checked` 为键，因为外层提示触发器会覆盖 `data-state`。
 * 选中态使用蓝色描边和勾选标记而非填充，以保持轻量。
 */
export const mailCheckboxClassName =
  "size-3.5 rounded border-input aria-checked:border-primary aria-checked:bg-transparent aria-checked:text-primary data-[state=checked]:bg-transparent data-[state=checked]:text-primary [&_svg]:size-2.5";

/**
 * 行复选框在悬停时显示，并具有超出方框的不可见点击区域，
 * 这样略微点偏时仍会选中，而不会打开会话。
 */
export function getMailRowCheckboxClassName(visible: boolean) {
  return cn(
    mailCheckboxClassName,
    "relative transition-opacity after:absolute after:-inset-3 after:content-['']",
    visible
      ? "opacity-100"
      : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
  );
}
