"use client";

import { Trans } from "@lingui/react/macro";
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
        <EmptyTitle>
          <Trans>未找到规则</Trans>
        </EmptyTitle>
        <EmptyDescription>
          <Trans>此规则已不存在，可能已被删除。</Trans>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
