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
  let checked: boolean | "indeterminate" = false;
  if (allSelected) {
    checked = true;
  } else if (selectedCount > 0) {
    checked = "indeterminate";
  }

  return (
    <Tooltip
      content={allSelected ? "取消选择所有会话" : undefined}
      shortcuts={
        allSelected ? undefined : [{ id: "selectAll", label: "选择所有会话" }]
      }
    >
      <Checkbox
        aria-label="选择所有会话"
        checked={checked}
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

/** 由各行复选框共用，这样全选与它们对齐且外观一致。 */
export const mailCheckboxClassName =
  "size-3.5 rounded border-input data-[state=checked]:border-primary data-[state=indeterminate]:border-primary [&_svg]:size-2.5";
