import { MessageCircleIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ParsedMessage } from "@/utils/types";
import type { RunRulesResult } from "@/utils/ai/choose-rule/run-rules";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LoadingContent } from "@/components/LoadingContent";
import { useRules } from "@/hooks/useRules";
import { useModal } from "@/hooks/useModal";
import { NEW_RULE_ID } from "@/app/(app)/[emailAccountId]/assistant/consts";
import { Label } from "@/components/Input";
import { ButtonList } from "@/components/ButtonList";
import type { RulesResponse } from "@/app/api/user/rules/route";
import { ResultsDisplay } from "@/app/(app)/[emailAccountId]/assistant/ResultDisplay";
import { NONE_RULE_ID } from "@/app/(app)/[emailAccountId]/assistant/consts";
import { useSidebar } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useChat } from "@/providers/ChatProvider";
import {
  NEW_RULE_ID as CONST_NEW_RULE_ID,
  NONE_RULE_ID as CONST_NONE_RULE_ID,
} from "@/app/(app)/[emailAccountId]/assistant/consts";
import type { MessageContext } from "@/utils/ai/assistant/chat-context-validation";
import {
  serializeMatchReasons,
  type SerializedMatchReason,
} from "@/utils/ai/choose-rule/types";

type FixWithChatResult = RunRulesResult & {
  matchMetadata?: SerializedMatchReason[] | null;
};

export function FixWithChat({
  setInput,
  message,
  results,
}: {
  setInput: (input: string) => void;
  message: ParsedMessage;
  results: FixWithChatResult[];
}) {
  const { data, isLoading, error } = useRules();
  const { isModalOpen, setIsModalOpen } = useModal();
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [showExplanation, setShowExplanation] = useState(false);

  const { setOpen } = useSidebar();
  const { setContext } = useChat();

  const selectedRuleName = useMemo(() => {
    if (!data) return null;
    if (selectedRuleId === NEW_RULE_ID) return "新规则";
    if (selectedRuleId === NONE_RULE_ID) return "无";
    return data.find((r) => r.id === selectedRuleId)?.name ?? null;
  }, [data, selectedRuleId]);

  const handleRuleSelect = (ruleId: string | null) => {
    setSelectedRuleId(ruleId);
    setShowExplanation(true);
  };

  const handleSubmit = () => {
    if (!selectedRuleId) return;

    let input: string;

    if (selectedRuleId === CONST_NEW_RULE_ID) {
      input = explanation?.trim()
        ? `为这样的邮件创建一条新规则：${explanation.trim()}`
        : "为这样的邮件创建一条新规则：";
    } else if (selectedRuleId === CONST_NONE_RULE_ID) {
      input = explanation?.trim()
        ? `这封邮件不应匹配任何规则，因为 ${explanation.trim()}`
        : "这封邮件不应匹配任何规则，因为 ";
    } else {
      const rulePart = selectedRuleName
        ? `“${selectedRuleName}”规则`
        : "另一条规则";
      input = explanation?.trim()
        ? `这封邮件本应匹配${rulePart}，因为 ${explanation.trim()}`
        : `这封邮件本应匹配${rulePart}，因为 `;
    }

    const context: MessageContext = {
      type: "fix-rule",
      message: {
        id: message.id,
        threadId: message.threadId,
        snippet: message.snippet,
        textPlain: message.textPlain,
        textHtml: message.textHtml,
        headers: {
          from: message.headers.from,
          to: message.headers.to,
          subject: message.headers.subject,
          cc: message.headers.cc,
          date: message.headers.date,
          "reply-to": message.headers["reply-to"],
        },
        internalDate: message.internalDate,
      },
      results: results.map((r) => ({
        ruleName: r.rule?.name ?? null,
        systemType: r.rule?.systemType ?? null,
        reason: r.reason ?? "",
        matchMetadata: r.matchMetadata ?? serializeMatchReasons(r.matchReasons),
      })),
      expected:
        selectedRuleId === CONST_NEW_RULE_ID
          ? "new"
          : selectedRuleId === CONST_NONE_RULE_ID
            ? "none"
            : {
                id: selectedRuleId,
                name: selectedRuleName || "Unknown",
              },
    };
    setContext(context);

    setInput(input);
    setOpen((arr) => [...arr, "chat-sidebar"]);
    setIsModalOpen(false);

    // 重置状态
    setSelectedRuleId(null);
    setExplanation("");
    setShowExplanation(false);
  };

  const handleClose = (open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      // 关闭时重置状态
      setSelectedRuleId(null);
      setExplanation("");
      setShowExplanation(false);
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageCircleIcon className="mr-2 size-4" />
          修复
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>改进规则</DialogTitle>
        </DialogHeader>

        <LoadingContent loading={isLoading} error={error}>
          {data && !showExplanation ? (
            <RuleMismatch
              results={results}
              rules={data}
              onSelectExpectedRuleId={handleRuleSelect}
            />
          ) : data && showExplanation ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">选中的规则：</span>
                <Badge variant="secondary">
                  {selectedRuleId === NEW_RULE_ID
                    ? "✨ 新规则"
                    : selectedRuleId === NONE_RULE_ID
                      ? "❌ 无"
                      : data.find((r) => r.id === selectedRuleId)?.name ||
                        "未知"}
                </Badge>
              </div>

              <div>
                <Label
                  name="explanation"
                  label="为什么本应应用此规则？（可选）"
                />
                <Textarea
                  id="explanation"
                  name="explanation"
                  className="mt-1"
                  rows={2}
                  value={explanation}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setExplanation(e.target.value)
                  }
                  aria-describedby="explanation-help"
                  autoFocus
                />
                <p id="explanation-help" className="mt-1 text-xs text-gray-500">
                  提供说明有助于 AI 更好地理解你的意图
                </p>
              </div>

              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowExplanation(false);
                    setSelectedRuleId(null);
                    setExplanation("");
                  }}
                >
                  返回
                </Button>
                <Button onClick={handleSubmit}>下一步</Button>
              </div>
            </div>
          ) : null}
        </LoadingContent>
      </DialogContent>
    </Dialog>
  );
}

function RuleMismatch({
  results,
  rules,
  onSelectExpectedRuleId,
}: {
  results: FixWithChatResult[];
  rules: RulesResponse;
  onSelectExpectedRuleId: (ruleId: string | null) => void;
}) {
  return (
    <div>
      <Label name="matchedRule" label="已匹配：" />
      <div className="mt-1">
        {results.length > 0 ? (
          <ResultsDisplay results={results} />
        ) : (
          <p>没有匹配的规则</p>
        )}
      </div>
      <div className="mt-4">
        <ButtonList
          title="你期望它匹配哪条规则？"
          emptyMessage="你还没有创建任何规则！"
          items={[
            { id: NONE_RULE_ID, name: "❌ 无" },
            { id: NEW_RULE_ID, name: "✨ 新规则" },
            ...rules,
          ]}
          onSelect={onSelectExpectedRuleId}
          itemClassName="h-auto min-h-10 justify-start whitespace-normal text-wrap py-2 text-left"
        />
      </div>
    </div>
  );
}
