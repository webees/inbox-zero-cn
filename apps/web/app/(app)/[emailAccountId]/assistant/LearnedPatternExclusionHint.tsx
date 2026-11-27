"use client";

import uniqBy from "lodash/uniqBy";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { HoverCard } from "@/components/HoverCard";
import { LearnedPatternsDialog } from "@/app/(app)/[emailAccountId]/assistant/group/LearnedPatterns";
import { cn } from "@/utils";
import type { RuleSelectionMetadata } from "@/utils/ai/choose-rule/types";
import { GroupItemType } from "@/generated/prisma/enums";

const ITEM_TYPE_LABELS: Record<GroupItemType, MessageDescriptor> = {
  [GroupItemType.FROM]: msg`from`,
  [GroupItemType.SUBJECT]: msg`subject`,
  [GroupItemType.BODY]: msg`body`,
};

export function LearnedPatternExclusionHint({
  learnedPatternExcludedRules,
  className,
}: {
  learnedPatternExcludedRules: RuleSelectionMetadata["learnedPatternExcludedRules"];
  className?: string;
}) {
  const { i18n } = useLingui();
  if (!learnedPatternExcludedRules.length) return null;

  const uniqueGroups = uniqBy(learnedPatternExcludedRules, (e) => e.groupId);

  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      <Trans>部分规则已被学习到的模式排除。</Trans>{" "}
      <HoverCard
        className="w-96"
        content={
          <div className="space-y-3 text-sm">
            {uniqueGroups.map((group) => (
              <div key={group.groupId} className="space-y-2">
                <div className="space-y-1">
                  <div className="font-medium text-foreground">
                    {group.ruleName}
                  </div>
                  <div>
                    <Trans>
                      已根据{i18n._(ITEM_TYPE_LABELS[group.itemType])}排除：{" "}
                      <span className="font-medium text-foreground">
                        {group.itemValue}
                      </span>
                    </Trans>
                  </div>
                </div>
                <LearnedPatternsDialog
                  ruleId={group.ruleId}
                  groupId={group.groupId}
                />
              </div>
            ))}
          </div>
        }
      >
        <button className="underline underline-offset-2" type="button">
          <Trans>查看排除项</Trans>
        </button>
      </HoverCard>
    </div>
  );
}
