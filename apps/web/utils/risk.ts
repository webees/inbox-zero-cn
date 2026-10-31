import type { RulesResponse } from "@/app/api/user/rules/route";
import type { Prisma } from "@/generated/prisma/client";
import { isAIRule, type RuleConditions } from "@/utils/condition";
import { ActionType } from "@/generated/prisma/enums";
import { TEMPLATE_VARIABLE_PATTERN } from "@/utils/template";
import {
  getIntegrationToolSpec,
  isAiFilledArgValue,
} from "@/utils/mcp/tool-specs";

const RISK_LEVELS = {
  VERY_HIGH: "very-high",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS];

export type RiskAction = {
  type: ActionType;
  subject: string | null;
  content: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: Prisma.JsonValue | null;
};

export function getActionRiskLevel(
  action: RiskAction,
  rule: RuleConditions,
): {
  level: RiskLevel;
  message: string;
} {
  const highRiskActions = [
    ActionType.REPLY,
    ActionType.FORWARD,
    ActionType.SEND_EMAIL,
    ActionType.INTEGRATION,
  ];
  if (!highRiskActions.some((type) => type === action.type)) {
    return {
      level: RISK_LEVELS.LOW,
      message: "低风险：不执行任何邮件发送操作。",
    };
  }

  const fieldStatus = getFieldsDynamicStatus(action);

  const contentFields = [
    fieldStatus.subject,
    fieldStatus.content,
    fieldStatus.integrationArgs,
  ];
  const recipientFields = [fieldStatus.to, fieldStatus.cc, fieldStatus.bcc];

  const hasFullyDynamicContent = hasAnyFieldWithStatus(
    contentFields,
    "fully-dynamic",
  );
  const hasPartiallyDynamicContent = hasAnyFieldWithStatus(
    contentFields,
    "partially-dynamic",
  );

  const hasFullyDynamicRecipient = hasAnyFieldWithStatus(
    recipientFields,
    "fully-dynamic",
  );
  const hasPartiallyDynamicRecipient = hasAnyFieldWithStatus(
    recipientFields,
    "partially-dynamic",
  );

  // 现在所有规则都自动执行，因此我们始终检查动态内容风险
  if (hasFullyDynamicContent && hasFullyDynamicRecipient) {
    const level = isAIRule(rule) ? RISK_LEVELS.VERY_HIGH : RISK_LEVELS.HIGH;
    return {
      level,
      message: `${level === RISK_LEVELS.VERY_HIGH ? "极高" : "高"}风险：AI 可以生成任意内容并发送到任意地址。恶意行为者可能诱骗 AI 以你的名义发送垃圾邮件或其他不需要的邮件。`,
    };
  }

  if (hasFullyDynamicRecipient) {
    return {
      level: RISK_LEVELS.HIGH,
      message:
        "高风险：AI 可以将邮件发送到任意地址。恶意行为者可能利用这一点以你的名义发送垃圾邮件或其他不需要的邮件。",
    };
  }

  if (hasFullyDynamicContent) {
    if (action.type === ActionType.INTEGRATION) {
      return {
        level: RISK_LEVELS.HIGH,
        message:
          "高风险：AI 可以根据匹配的邮件生成任意任务内容。恶意发件人可能诱骗 AI 在你已连接的集成中创建不需要或具有误导性的任务。",
      };
    }
    return {
      level: RISK_LEVELS.HIGH,
      message:
        "高风险：AI 可以自动生成并发送任意邮件内容。恶意行为者可能诱骗 AI 生成不需要或不恰当的内容。",
    };
  }

  if (hasPartiallyDynamicContent || hasPartiallyDynamicRecipient) {
    return {
      level: RISK_LEVELS.MEDIUM,
      message:
        "中风险：AI 可以使用模板生成内容或收件人。虽然比完全动态的内容受到更多限制，但仍请仔细检查模板。",
    };
  }

  return {
    level: RISK_LEVELS.LOW,
    message: "低风险：所有内容和收件人都是静态的。",
  };
}

function hasAnyFieldWithStatus(
  fields: (string | null)[],
  status: "fully-dynamic" | "partially-dynamic",
) {
  return fields.some((field) => field === status);
}

function compareRiskLevels(a: RiskLevel, b: RiskLevel): RiskLevel {
  const riskOrder: Record<RiskLevel, number> = {
    [RISK_LEVELS.VERY_HIGH]: 4,
    [RISK_LEVELS.HIGH]: 3,
    [RISK_LEVELS.MEDIUM]: 2,
    [RISK_LEVELS.LOW]: 1,
  };
  return riskOrder[a] >= riskOrder[b] ? a : b;
}

export function getRiskLevel(
  rule: Pick<RulesResponse[number], "actions"> & RuleConditions,
): {
  level: RiskLevel;
  message: string;
} {
  // 获取每个操作的风险等级并返回最高风险
  return rule.actions.reduce<{ level: RiskLevel; message: string }>(
    (highestRisk, action) => {
      const actionRisk = getActionRiskLevel(action, rule);
      if (
        compareRiskLevels(actionRisk.level, highestRisk.level) ===
        actionRisk.level
      ) {
        return actionRisk;
      }
      return highestRisk;
    },
    {
      level: RISK_LEVELS.LOW,
      message: "低风险：所有内容和收件人都是静态的。",
    },
  );
}

function getFieldsDynamicStatus(action: RiskAction) {
  return {
    subject: checkFieldStatus(action.subject),
    content: checkFieldStatus(action.content),
    to: checkFieldStatus(action.to),
    cc: checkFieldStatus(action.cc),
    bcc: checkFieldStatus(action.bcc),
    integrationArgs: getIntegrationArgsDynamicStatus(action),
  };
}

function checkFieldStatus(field: string | null) {
  if (!field) return null;
  if (isFullyDynamicField(field)) return "fully-dynamic";
  if (isPartiallyDynamicField(field)) return "partially-dynamic";
  return "static";
}

function getIntegrationArgsDynamicStatus(action: RiskAction) {
  if (action.type !== ActionType.INTEGRATION) return null;

  const spec = getIntegrationToolSpec(
    action.integrationName,
    action.integrationToolName,
  );
  // 故障安全：无法识别的工具会被假定为写入 AI 生成的内容，
  // 因此它仍会触发高风险关卡，而不会被视为静态。
  if (!spec) return "fully-dynamic";

  const integrationArgs =
    action.integrationArgs &&
    typeof action.integrationArgs === "object" &&
    !Array.isArray(action.integrationArgs)
      ? (action.integrationArgs as Record<string, unknown>)
      : {};

  const statuses = spec.args.map((arg) => {
    const rawValue = integrationArgs[arg.key];
    const value = typeof rawValue === "string" ? rawValue : "";
    // AI 在执行时填充的参数与 {{template}} 一样动态，
    // 即使它存储为空值。
    if (isAiFilledArgValue(arg, value)) return "fully-dynamic";
    return checkFieldStatus(value);
  });

  if (statuses.includes("fully-dynamic")) return "fully-dynamic";
  if (statuses.includes("partially-dynamic")) return "partially-dynamic";
  if (statuses.includes("static")) return "static";
  return null;
}

// 辅助函数
export function isFullyDynamicField(field: string) {
  const trimmed = field.trim();
  return trimmed.startsWith("{{") && trimmed.endsWith("}}");
}

export function isPartiallyDynamicField(field: string) {
  return new RegExp(TEMPLATE_VARIABLE_PATTERN).test(field);
}
