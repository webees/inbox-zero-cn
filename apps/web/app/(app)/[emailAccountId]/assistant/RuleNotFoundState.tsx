"use client";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function RuleNotFoundState() {
  return (
    <Empty className="min-h-56 border">
      <EmptyHeader>
        <EmptyTitle>未找到规则</EmptyTitle>
        <EmptyDescription>此规则已不存在。它可能已被删除。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
