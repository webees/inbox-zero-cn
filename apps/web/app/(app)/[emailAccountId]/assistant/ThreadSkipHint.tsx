"use client";

import { Trans } from "@lingui/react/macro";
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
      <Trans>部分规则已被跳过，因为这封邮件属于一个会话。</Trans>{" "}
      <HoverCard
        content={
          <div className="max-w-xs text-sm">
            <Trans>已跳过：{skippedThreadRuleNames.join(", ")}</Trans>
          </div>
        }
      >
        <button className="underline underline-offset-2" type="button">
          <Trans>查看已跳过的规则</Trans>
        </button>
      </HoverCard>
    </div>
  );
}
