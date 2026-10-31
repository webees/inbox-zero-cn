"use client";

import { HoverCard } from "@/components/HoverCard";
import { cn } from "@/utils";

export function ThreadSkipHint({
  skippedThreadRuleNames,
  className,
}: {
  skippedThreadRuleNames: string[];
  className?: string;
}) {
  if (!skippedThreadRuleNames.length) return null;

  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      由于此邮件属于同一会话，部分规则被跳过。{" "}
      <HoverCard
        content={
          <div className="max-w-xs text-sm">
            已跳过：{skippedThreadRuleNames.join(", ")}
          </div>
        }
      >
        <button className="underline underline-offset-2" type="button">
          查看已跳过的规则
        </button>
      </HoverCard>
    </div>
  );
}
