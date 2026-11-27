"use client";

import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpIcon } from "lucide-react";
import { Badge } from "@/components/Badge";
import { getActionColor } from "@/components/PlanBadge";
import { IllustrationWindow } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/IllustrationWindow";
import { ActionType } from "@/generated/prisma/enums";
import { getActionIcon } from "@/utils/action-display";

const rules = [
  {
    instruction: msg`把收据和发票转发给我的会计`,
    actions: [
      { type: ActionType.LABEL, text: msg`收据` },
      { type: ActionType.FORWARD, text: "accountant@example.com" },
    ],
  },
  {
    instruction: msg`给新闻邮件加标签，并在一周后归档`,
    actions: [
      { type: ActionType.LABEL, text: msg`新闻邮件` },
      { type: ActionType.ARCHIVE, text: msg`7 天后归档` },
    ],
  },
  {
    instruction: msg`根据我们的帮助文档起草对客户问题的回复`,
    actions: [
      { type: ActionType.LABEL, text: msg`支持` },
      { type: ActionType.DRAFT_EMAIL, text: msg`起草回复` },
    ],
  },
  {
    instruction: msg`有投资人发邮件时在 Slack 通知我`,
    actions: [
      { type: ActionType.LABEL, text: msg`投资人` },
      { type: ActionType.NOTIFY_MESSAGING_CHANNEL, text: msg`在 Slack 中通知` },
    ],
  },
];

export function CustomRulesIllustration() {
  const { i18n } = useLingui();
  const reduceMotion = useReducedMotion();
  const enter = reduceMotion ? false : { opacity: 0, y: 8 };

  return (
    <IllustrationWindow className="w-full max-w-[600px]">
      <div className="space-y-2.5 bg-muted/40 p-5">
        {rules.map((rule, index) => (
          <motion.div
            key={rule.instruction.id}
            initial={enter}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.12 }}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <p className="text-sm font-medium text-foreground">
              {i18n._(rule.instruction)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {rule.actions.map((action) => {
                const Icon = getActionIcon(action.type);
                return (
                  <Badge key={action.type} color={getActionColor(action.type)}>
                    <Icon className="mr-1.5 size-3" />
                    {typeof action.text === "string"
                      ? action.text
                      : i18n._(action.text)}
                  </Badge>
                );
              })}
            </div>
          </motion.div>
        ))}

        <motion.div
          initial={enter}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: rules.length * 0.12 }}
          className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-card py-2.5 pr-2.5 pl-4"
        >
          <span className="flex-1 truncate text-sm text-muted-foreground">
            <Trans>物流更新送达后即归档</Trans>
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ArrowUpIcon className="size-4" />
          </span>
        </motion.div>
      </div>
    </IllustrationWindow>
  );
}
