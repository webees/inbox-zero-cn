import { useRules } from "@/hooks/useRules";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingContent } from "@/components/LoadingContent";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseAsString, useQueryState } from "nuqs";
import { ChevronDown, Tag } from "lucide-react";

export function RulesSelect() {
  const { data, isLoading, error } = useRules();
  const [ruleId, setRuleId] = useQueryState(
    "ruleId",
    parseAsString.withDefault("all"),
  );
  const getCurrentLabel = () => {
    if (ruleId === "all") return "所有规则";
    if (ruleId === "skipped") return "无匹配";
    const rule = data?.find((rule) => rule.id === ruleId);
    if (!rule) return "所有规则";
    return rule.enabled ? rule.name : `${rule.name}（已停用）`;
  };

  return (
    <LoadingContent
      loading={isLoading}
      error={error}
      loadingComponent={<Skeleton className="h-10 w-[200px]" />}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-10 whitespace-nowrap"
          >
            <Tag className="mr-2 h-4 w-4" />
            {getCurrentLabel()}
            <ChevronDown className="ml-2 h-4 w-4 text-gray-400" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRuleId("all")}>
            所有规则
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRuleId("skipped")}>
            无匹配
          </DropdownMenuItem>
          {data?.map((rule) => (
            <DropdownMenuItem key={rule.id} onClick={() => setRuleId(rule.id)}>
              {rule.name}
              {!rule.enabled && (
                <span className="ml-1 text-muted-foreground">（已停用）</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </LoadingContent>
  );
}
