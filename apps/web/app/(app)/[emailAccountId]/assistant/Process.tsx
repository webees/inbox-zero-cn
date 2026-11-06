"use client";

import { useQueryState } from "nuqs";
import { ProcessRulesContent } from "@/app/(app)/[emailAccountId]/assistant/ProcessRules";
import { Toggle } from "@/components/Toggle";
import { CardDescription } from "@/components/ui/card";

export function Process() {
  const [mode, setMode] = useQueryState("mode");
  const isApplyMode = mode === "apply";

  return (
    <>
      <div className="flex items-center justify-between pb-4">
        <div className="flex flex-col space-y-1.5">
          <CardDescription>
            {isApplyMode
              ? "对历史邮件运行你的规则"
              : "检查你的规则对历史邮件的执行效果"}
          </CardDescription>
        </div>

        <div className="flex pt-1">
          <Toggle
            name="test-mode"
            label="测试"
            labelRight="应用"
            enabled={isApplyMode}
            onChange={(enabled) => setMode(enabled ? "apply" : "test")}
          />
        </div>
      </div>
      <ProcessRulesContent testMode={!isApplyMode} />
    </>
  );
}
