import { LogicalOperator } from "@/generated/prisma/enums";
import type { Rule } from "@/generated/prisma/client";
import { ConditionType, type CoreConditionType } from "@/utils/config";
import type {
  CreateRuleBody,
  ZodCondition,
} from "@/utils/actions/rule.validation";
import type { Logger } from "@/utils/logger";

export type RuleConditions = Partial<
  Pick<
    Rule,
    | "groupId"
    | "instructions"
    | "from"
    | "to"
    | "subject"
    | "body"
    | "conditionalOperator"
  > & {
    group?: { name: string } | null;
  }
>;

export function isAIRule<T extends RuleConditions>(
  rule: T,
): rule is T & { instructions: string } {
  return !!rule.instructions;
}

export function isGroupRule<T extends RuleConditions>(
  rule: T,
): rule is T & { groupId: string } {
  return !!rule.groupId;
}

export function isStaticRule(rule: RuleConditions) {
  return !!rule.from || !!rule.to || !!rule.subject || !!rule.body;
}

export function getConditions(rule: RuleConditions) {
  const conditions: CreateRuleBody["conditions"] = [];

  if (isAIRule(rule)) {
    conditions.push({
      type: ConditionType.AI,
      instructions: rule.instructions,
      from: null,
      to: null,
      subject: null,
      body: null,
    });
  }

  if (isStaticRule(rule)) {
    // 将静态条件按已填充的字段拆分为独立条件
    // 这与新 UI 一致：每个条件只包含一个字段
    if (rule.from) {
      conditions.push({
        type: ConditionType.STATIC,
        from: rule.from,
        to: null,
        subject: null,
        body: null,
        instructions: null,
      });
    }
    if (rule.to) {
      conditions.push({
        type: ConditionType.STATIC,
        from: null,
        to: rule.to,
        subject: null,
        body: null,
        instructions: null,
      });
    }
    if (rule.subject) {
      conditions.push({
        type: ConditionType.STATIC,
        from: null,
        to: null,
        subject: rule.subject,
        body: null,
        instructions: null,
      });
    }
    if (rule.body) {
      conditions.push({
        type: ConditionType.STATIC,
        from: null,
        to: null,
        subject: null,
        body: rule.body,
        instructions: null,
      });
    }
  }

  return conditions;
}

export function getConditionTypes(
  rule: RuleConditions,
): Record<CoreConditionType, boolean> {
  return getConditions(rule).reduce(
    (acc, condition) => {
      acc[condition.type] = true;
      return acc;
    },
    {} as Record<CoreConditionType, boolean>,
  );
}

export function getEmptyCondition(type: CoreConditionType): ZodCondition {
  switch (type) {
    case ConditionType.AI:
      return {
        type: ConditionType.AI,
        instructions: "",
      };
    case ConditionType.STATIC:
      // 新的 STATIC 条件默认使用 "from" 字段
      return {
        type: ConditionType.STATIC,
        from: null,
        to: null,
        subject: null,
        body: null,
        instructions: null,
      };
    default:
      // biome-ignore lint/correctness/noSwitchDeclarations: intentional exhaustive check
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
  }
}

type FlattenedConditions = {
  instructions?: string | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
};

export const flattenConditions = (
  conditions: ZodCondition[],
  logger: Logger,
): FlattenedConditions => {
  return conditions.reduce((acc, condition) => {
    switch (condition.type) {
      case ConditionType.AI:
        acc.instructions = condition.instructions;
        break;
      case ConditionType.STATIC:
        if (condition.to) acc.to = condition.to;
        if (condition.from) acc.from = condition.from;
        if (condition.subject) acc.subject = condition.subject;
        if (condition.body) acc.body = condition.body;
        break;
      default:
        logger.warn("未知的条件类型", { condition });
        // biome-ignore lint/correctness/noSwitchDeclarations: intentional exhaustive check
        const exhaustiveCheck: never = condition.type;
        return exhaustiveCheck;
    }
    return acc;
  }, {} as FlattenedConditions);
};

//========================================
// toString 工具
//========================================

export function conditionTypesToString(rule: RuleConditions) {
  return getConditions(rule)
    .map((condition) => conditionTypeToString(condition.type))
    .join(", ");
}

function conditionTypeToString(conditionType: ConditionType): string {
  switch (conditionType) {
    case ConditionType.AI:
      return "AI";
    case ConditionType.STATIC:
      return "静态";
    case ConditionType.LEARNED_PATTERN:
      return "分组";
    case ConditionType.PRESET:
      return "预设";
    default:
      // biome-ignore lint/correctness/noSwitchDeclarations: intentional exhaustive check
      const exhaustiveCheck: never = conditionType;
      return exhaustiveCheck;
  }
}

export function conditionsToString(rule: RuleConditions) {
  const conditions: string[] = [];
  const connector =
    rule.conditionalOperator === LogicalOperator.AND ? " AND " : " OR ";

  // 静态条件 - 用逗号分组
  const staticConditions: string[] = [];
  if (rule.from) staticConditions.push(`发件人：${rule.from}`);
  if (rule.subject) staticConditions.push(`主题："${rule.subject}"`);
  if (rule.to) staticConditions.push(`收件人：${rule.to}`);
  if (rule.body) staticConditions.push(`正文："${rule.body}"`);
  if (staticConditions.length) conditions.push(staticConditions.join(", "));

  // AI 条件
  if (rule.instructions) conditions.push(rule.instructions);

  return conditions.join(connector);
}
