import groupBy from "lodash/groupBy";
import sortBy from "lodash/sortBy";
import { capitalCase } from "capital-case";
import he from "he";
import { HoverCard } from "@/components/HoverCard";
import { Badge } from "@/components/Badge";
import { conditionTypesToString } from "@/utils/condition";
import {
  ActionType,
  ExecutedRuleStatus,
  LogicalOperator,
} from "@/generated/prisma/enums";
import type { Rule } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { MessageText, MutedText } from "@/components/Typography";
import { EyeIcon } from "lucide-react";
import { useRuleDialog } from "@/app/(app)/[emailAccountId]/assistant/RuleDialog";
import { ThreadSkipHint } from "@/app/(app)/[emailAccountId]/assistant/ThreadSkipHint";
import { LearnedPatternExclusionHint } from "@/app/(app)/[emailAccountId]/assistant/LearnedPatternExclusionHint";
import type { RunRulesResult } from "@/utils/ai/choose-rule/run-rules";
import { RuleActions } from "@/components/RuleActions";
import { useAccount } from "@/providers/EmailAccountProvider";

export function ResultsDisplay({
  results,
  showFullContent = false,
}: {
  results: RunRulesResult[];
  showFullContent?: boolean;
}) {
  const groupedResults = groupBy(results, (result) =>
    result.createdAt.toString(),
  );

  const sortedBatches = sortBy(
    Object.entries(groupedResults),
    ([, batchResults]) => {
      const createdAt = batchResults[0]?.createdAt;
      return createdAt ? -new Date(createdAt) : 0; // Negative for descending order
    },
  );

  return (
    <div className="flex flex-col gap-2">
      {sortedBatches.map(([date, batchResults], batchIndex) => (
        <div key={date}>
          {batchIndex === 1 && sortedBatches.length > 1 && (
            <div className="my-1 text-xs text-muted-foreground">之前：</div>
          )}
          <div
            className={
              showFullContent
                ? "flex flex-col gap-4"
                : "flex flex-wrap gap-1 sm:flex-nowrap"
            }
          >
            {batchResults.map((result, resultIndex) => (
              <ResultDisplay
                key={`${date}-${resultIndex}`}
                result={result}
                showFullContent={showFullContent}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultDisplay({
  result,
  showFullContent = false,
}: {
  result: RunRulesResult;
  showFullContent?: boolean;
}) {
  const { rule, status } = result;

  if (showFullContent) {
    return (
      <div className="w-full">
        <ResultDisplayContent result={result} />
      </div>
    );
  }

  return (
    <HoverCard
      content={<ResultDisplayContent result={result} />}
      className="w-max min-w-64 max-w-[min(32rem,calc(100vw-2rem))] overflow-visible"
    >
      <Badge
        color={rule ? "green" : "red"}
        className="whitespace-nowrap max-sm:whitespace-normal max-sm:break-all max-sm:max-w-full"
      >
        {rule
          ? rule.name
          : status === ExecutedRuleStatus.SKIPPED
            ? "未找到匹配项"
            : capitalCase(status)}
        <EyeIcon className="ml-1.5 size-3.5 shrink-0 opacity-70" />
      </Badge>
    </HoverCard>
  );
}

export function ResultDisplayContent({ result }: { result: RunRulesResult }) {
  const { rule, status, reason } = result;
  const reasonDisplay = getRuleResultReasonDisplay(reason ?? "");
  const skippedThreadRuleNames =
    result.selectionMetadata?.skippedThreadRuleNames ?? [];
  const learnedPatternExcludedRules =
    result.selectionMetadata?.learnedPatternExcludedRules ?? [];

  const { ruleDialog, RuleDialogComponent } = useRuleDialog();
  const { provider } = useAccount();

  return (
    <div>
      <div className="flex justify-between font-medium">
        {rule ? (
          <>
            {rule.name}
            <Badge color="blue">{conditionTypesToString(rule)}</Badge>
          </>
        ) : (
          status === ExecutedRuleStatus.SKIPPED && "未找到匹配项"
        )}
      </div>
      <div className="mt-2">
        {rule ? <PrettyConditions rule={rule} /> : null}
      </div>
      <div className="mt-2">
        {!!rule && (
          <Button
            size="sm"
            onClick={() => {
              ruleDialog.onOpen({ ruleId: rule.id });
            }}
          >
            查看匹配的规则
          </Button>
        )}
      </div>

      <div className="mt-2">
        {result.actionItems?.length ? (
          <>
            <div className="font-medium text-sm mb-1">操作：</div>
            <RuleActions
              actions={
                result.actionItems?.map((action) => ({
                  id: action.id,
                  type: action.type,
                  label: action.label,
                  folderName: action.folderName,
                  content: action.content,
                  to: action.to,
                  subject: action.subject,
                  cc: action.cc,
                  bcc: action.bcc,
                  url: action.url,
                })) || []
              }
              provider={provider}
              labels={[]}
            />
          </>
        ) : (
          <div className="text-muted-foreground text-sm">未执行任何操作</div>
        )}
      </div>

      {(status === ExecutedRuleStatus.SKIPPED ||
        learnedPatternExcludedRules.length > 0) && (
        <div className="mt-3 space-y-2">
          {status === ExecutedRuleStatus.SKIPPED && (
            <ThreadSkipHint skippedThreadRuleNames={skippedThreadRuleNames} />
          )}
          {learnedPatternExcludedRules.length > 0 && (
            <LearnedPatternExclusionHint
              learnedPatternExcludedRules={learnedPatternExcludedRules}
            />
          )}
        </div>
      )}

      {(!!reasonDisplay.reason ||
        reasonDisplay.actionFailureMessages.length > 0) && (
        <div className="mt-4 space-y-2 bg-muted p-2 rounded-md">
          <div className="font-medium text-sm">选择此规则的原因：</div>
          {!!reasonDisplay.reason && (
            <MessageText className="whitespace-pre-wrap break-words">
              {reasonDisplay.reason}
            </MessageText>
          )}
          {reasonDisplay.actionFailureMessages.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium text-sm">操作问题：</div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700 dark:text-foreground">
                {reasonDisplay.actionFailureMessages.map((message) => (
                  <li key={message} className="break-words">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <RuleDialogComponent />
    </div>
  );
}

function PrettyConditions({
  rule,
}: {
  rule: Pick<
    Rule,
    "from" | "to" | "subject" | "body" | "instructions" | "conditionalOperator"
  >;
}) {
  const conditions: { text: string; isInstructions?: boolean }[] = [];

  // 静态条件——用逗号分组
  const staticConditions: string[] = [];
  if (rule.from) staticConditions.push(`发件人：${rule.from}`);
  if (rule.subject) staticConditions.push(`主题："${rule.subject}"`);
  if (rule.to) staticConditions.push(`收件人：${rule.to}`);
  if (rule.body) staticConditions.push(`正文："${rule.body}"`);
  if (staticConditions.length)
    conditions.push({ text: staticConditions.join(", ") });

  if (rule.instructions)
    conditions.push({ text: rule.instructions, isInstructions: true });

  const operator =
    rule.conditionalOperator === LogicalOperator.AND ? "且" : "或";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.map((condition, index) => (
        <div key={index} className="flex min-w-0 items-center gap-1.5">
          <MutedText
            className={
              condition.isInstructions
                ? "line-clamp-2 whitespace-pre-line break-words"
                : undefined
            }
          >
            {condition.text}
          </MutedText>
          {index < conditions.length - 1 && (
            <Badge color="purple" className="text-xs">
              {operator}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

export function getRuleResultReasonDisplay(reason: string): {
  reason: string;
  actionFailureMessages: string[];
} {
  const actionFailureMessages: string[] = [];
  const reasonLines: string[] = [];

  const plainText = stripHtmlTagsFromReason(he.decode(reason));

  for (const line of plainText.split(/\r?\n/)) {
    const trimmedLine = line.replace(/\s+/g, " ").trim();
    if (trimmedLine.startsWith("Action failures:")) {
      actionFailureMessages.push(
        ...getActionFailureMessages(
          trimmedLine.slice("Action failures:".length),
        ),
      );
    } else {
      reasonLines.push(trimmedLine);
    }
  }

  return {
    reason: reasonLines.join("\n").trim(),
    actionFailureMessages,
  };
}

function stripHtmlTagsFromReason(reason: string) {
  let plainText = "";

  for (let index = 0; index < reason.length; index++) {
    const char = reason[index];
    if (char !== "<") {
      plainText += char;
      continue;
    }

    const tagStart = index + (reason[index + 1] === "/" ? 2 : 1);
    const tagName = readTagName(reason, tagStart);
    if (!tagName) {
      plainText += char;
      continue;
    }

    const tagEnd = reason.indexOf(">", tagStart + tagName.length);
    if (tagEnd === -1) {
      plainText += char;
      continue;
    }

    if (BLOCK_REASON_TAGS.has(tagName)) plainText += " ";
    index = tagEnd;
  }

  return plainText;
}

const BLOCK_REASON_TAGS = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function readTagName(value: string, start: number) {
  let tagName = "";

  for (let index = start; index < value.length; index++) {
    const char = value[index]?.toLowerCase();
    if (!char) break;

    const isTagNameChar =
      (char >= "a" && char <= "z") ||
      (tagName.length > 0 && char >= "0" && char <= "9");
    if (!isTagNameChar) break;

    tagName += char;
  }

  return tagName;
}

function getActionFailureMessages(failures: string): string[] {
  return failures
    .split(",")
    .map((failure) => failure.trim())
    .filter(Boolean)
    .map((failure) => {
      const separatorIndex = failure.indexOf(":");
      if (separatorIndex === -1) return getActionFailureMessage(failure, "");

      return getActionFailureMessage(
        failure.slice(0, separatorIndex),
        failure.slice(separatorIndex + 1),
      );
    });
}

const ACTION_FAILURE_MESSAGES: Partial<
  Record<ActionType, { fallback: string; codes: Record<string, string> }>
> = {
  [ActionType.DRAFT_MESSAGING_CHANNEL]: {
    fallback: "无法完成起草回复操作。",
    codes: {
      MESSAGING_DELIVERY_FAILED: "无法将草稿回复发送到消息渠道。",
      MISSING_MESSAGING_CHANNEL: "起草回复操作需要一个消息渠道。",
    },
  },
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: {
    fallback: "无法完成消息渠道通知。",
    codes: {
      MESSAGING_DELIVERY_FAILED: "无法发送消息渠道通知。",
      MISSING_MESSAGING_CHANNEL: "消息渠道通知需要一个渠道。",
    },
  },
  [ActionType.NOTIFY_SENDER]: {
    fallback: "无法完成发件人通知。",
    codes: {
      RESEND_NOT_CONFIGURED: "无法发送发件人通知，因为未配置邮件发送。",
      MISSING_SENDER_EMAIL: "无法发送发件人通知，因为找不到发件人邮箱。",
      SEND_FAILED: "无法发送发件人通知。",
    },
  },
  // 存储的原因中只保留操作类型和错误代码，因此这段文案保持与具体集成无关。
  // 执行器会在其旁边记录一条指明该集成的消息。
  [ActionType.INTEGRATION]: {
    fallback: "无法完成集成操作。",
    codes: {
      INTEGRATION_NOT_CONNECTED: "该集成尚未连接。请在“集成”页面连接它。",
      MISSING_INTEGRATION_ARGS: "无法运行集成操作，因为某个必填字段为空。",
      INTEGRATION_CALL_FAILED: "无法完成集成操作。",
    },
  },
};

function getActionFailureMessage(actionType: string, errorCode: string) {
  const entry = Object.hasOwn(ACTION_FAILURE_MESSAGES, actionType)
    ? ACTION_FAILURE_MESSAGES[actionType as ActionType]
    : undefined;
  if (!entry) return "无法完成某项操作。";
  return Object.hasOwn(entry.codes, errorCode)
    ? entry.codes[errorCode]
    : entry.fallback;
}
