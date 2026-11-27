"use client";

import { useQueryState } from "nuqs";
import { Trans, useLingui } from "@lingui/react/macro";
import { ProcessRulesContent } from "@/app/(app)/[emailAccountId]/assistant/ProcessRules";
import { Toggle } from "@/components/Toggle";
import { CardDescription } from "@/components/ui/card";

export function Process() {
  const { t } = useLingui();
  const [mode, setMode] = useQueryState("mode");
  const isApplyMode = mode === "apply";

  return (
    <>
      <div className="flex items-center justify-between pb-4">
        <div className="flex flex-col space-y-1.5">
          <CardDescription>
            {isApplyMode ? (
              <Trans>对以前的邮件运行你的规则</Trans>
            ) : (
              <Trans>检查你的规则在以前邮件上的表现</Trans>
            )}
          </CardDescription>
        </div>

        <div className="flex pt-1">
          <Toggle
            name="test-mode"
            label={t`测试`}
            labelRight={t`应用`}
            enabled={isApplyMode}
            onChange={(enabled) => setMode(enabled ? "apply" : "test")}
          />
        </div>
      </div>
      <ProcessRulesContent testMode={!isApplyMode} />
    </>
  );
}
