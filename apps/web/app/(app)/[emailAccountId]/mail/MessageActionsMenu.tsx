"use client";

import type { ComponentProps } from "react";
import { MoreHorizontalIcon, SparklesIcon } from "lucide-react";
import { FixWithChat } from "@/app/(app)/[emailAccountId]/assistant/FixWithChat";
import { getRuleResultReasonDisplay } from "@/app/(app)/[emailAccountId]/assistant/ResultDisplay";
import { RuleActions } from "@/components/RuleActions";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useChat } from "@/providers/ChatProvider";
import type { ThreadPlan } from "@/app/(app)/[emailAccountId]/mail/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ExecutedRuleStatus } from "@/generated/prisma/enums";
import type { ParsedMessage } from "@/utils/types";

type FixWithChatResults = ComponentProps<typeof FixWithChat>["results"];

export function MessageActionsMenu({
  message,
  plans,
  showFixWithChat,
}: {
  message: ParsedMessage;
  plans: ThreadPlan[];
  showFixWithChat: boolean;
}) {
  const messagePlans = plans.filter((plan) => plan.messageId === message.id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多邮件操作"
          size="iconXs"
          variant="ghostMuted"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SparklesIcon className="mr-2 size-4" />
            匹配原因
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-0"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {messagePlans.length ? (
                messagePlans.map((plan) => (
                  <RuleAttribution
                    key={plan.id}
                    message={message}
                    plan={plan}
                    showFixWithChat={showFixWithChat}
                  />
                ))
              ) : (
                <p className="p-3 text-muted-foreground text-xs">
                  此邮件没有匹配的规则。
                </p>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuleAttribution({
  plan,
  message,
  showFixWithChat,
}: {
  plan: ThreadPlan;
  message: ParsedMessage | null;
  showFixWithChat: boolean;
}) {
  const { provider } = useAccount();
  const { setInput: setChatInput } = useChat();
  const reasonDisplay = getRuleResultReasonDisplay(plan.reason ?? "");

  return (
    <div className="min-w-0 border-border border-b px-3 py-3 last:border-b-0">
      <div className="min-w-0 text-xs">
        <span className="text-muted-foreground">
          {plan.status === ExecutedRuleStatus.APPLIED
            ? "已应用规则："
            : "匹配规则："}{" "}
        </span>
        <span className="font-medium text-foreground break-words [overflow-wrap:anywhere]">
          {plan.rule?.name ?? "已删除的规则"}
        </span>
      </div>

      {reasonDisplay.reason ? (
        <p className="mt-1.5 whitespace-pre-wrap text-foreground text-xs leading-relaxed break-words [overflow-wrap:anywhere]">
          {reasonDisplay.reason}
        </p>
      ) : null}

      {reasonDisplay.actionFailureMessages.length > 0 ? (
        <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
          <div className="font-medium">
            {reasonDisplay.actionFailureMessages.length === 1
              ? "操作问题"
              : "操作问题"}
          </div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {reasonDisplay.actionFailureMessages.map(
              (failureMessage, failureIndex) => (
                <li
                  className="break-words [overflow-wrap:anywhere]"
                  key={`${failureMessage}-${failureIndex}`}
                >
                  {failureMessage}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {plan.actionItems.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="font-medium text-xs">
            {plan.status === ExecutedRuleStatus.APPLIED &&
            reasonDisplay.actionFailureMessages.length === 0
              ? "已应用的操作"
              : "规则操作"}
          </div>
          <RuleActions
            actions={plan.actionItems}
            provider={provider}
            labels={[]}
            showDetails={false}
          />
        </div>
      ) : null}

      {message && showFixWithChat ? (
        <div className="mt-2.5">
          <FixWithChat
            message={message}
            results={toFixResults(plan)}
            setInput={setChatInput}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * `ThreadPlan` 没有 `createdAt`：列表路由用它按邮件挑出每条规则的
 * 最新一次执行，然后将其丢弃。`FixWithChat` 内的 `ResultsDisplay`
 * 仍要求提供该字段——但只是作为它对批次分组和排序的键，
 * 从不会渲染它。每个菜单项只传入一个结果，因此分组无事可做，
 * 任何常量都可以；在这里执行时间未知的情况下，用一个哨兵值比
 * 编造一个真实日期更诚实。
 */
const FIX_RESULT_BATCH = new Date(0);

function toFixResults(plan: ThreadPlan): FixWithChatResults {
  return [
    {
      rule: plan.rule,
      actionItems: plan.actionItems,
      reason: plan.reason,
      status: plan.status,
      createdAt: FIX_RESULT_BATCH,
    },
  ];
}
