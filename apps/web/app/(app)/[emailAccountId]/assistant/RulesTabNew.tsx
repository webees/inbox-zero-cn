import { Rules } from "@/app/(app)/[emailAccountId]/assistant/Rules";
import { AddRuleDialog } from "@/app/(app)/[emailAccountId]/assistant/AddRuleDialog";
import { MutedText } from "@/components/Typography";
import { BulkRunRules } from "@/app/(app)/[emailAccountId]/assistant/BulkRunRules";

export function RulesTab() {
  return (
    <div>
      <div className="flex items-center mb-2 justify-between gap-2">
        <MutedText className="hidden sm:block">
          你的助手使用这些规则自动整理收到的邮件。
        </MutedText>

        <div className="flex shrink-0 items-center gap-2">
          <BulkRunRules />
          <AddRuleDialog />
        </div>
      </div>
      <Rules showAddRuleButton={false} />
    </div>
  );
}
