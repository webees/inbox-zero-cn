import { z } from "zod";
import {
  ActionType,
  CategoryFilterType,
  DraftReplyConfidence,
  LogicalOperator,
  SystemType,
} from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";
import { NINETY_DAYS_MINUTES } from "@/utils/date";
import { validateLabelNameBasic } from "@/utils/gmail/label-validation";
import { findIntegration } from "@/utils/mcp/integrations";
import {
  getIntegrationArgKeys,
  getIntegrationToolSpec,
} from "@/utils/mcp/tool-specs";
import { addMissingRecipientIssue } from "@/utils/rule/recipient-validation";
import { attachmentSourceInputSchema } from "@/utils/attachments/source-schema";
import { addDisabledRuleActionIssue } from "@/utils/rule-action-feature-gates";

export const delayInMinutesSchema = z
  .number()
  .min(1, "支持的最短延迟为 1 分钟")
  .max(NINETY_DAYS_MINUTES, "支持的最长延迟为 90 天")
  .nullish()
  .describe(
    "Minutes to wait before executing this action. Only add when the user asks for a delay.",
  );

// 适配 LLM 的版本：不使用 .min()/.max()（Anthropic 的结构化输出会拒绝它们）。
// 约束改为通过 .describe() 传达。
export const delayInMinutesLlmSchema = z
  .number()
  .nullish()
  .describe(
    `Minutes to wait before executing this action (minimum 1, maximum ${NINETY_DAYS_MINUTES}). Only add when the user asks for a delay.`,
  );

const zodActionType = z.enum([
  ActionType.ARCHIVE,
  ActionType.DRAFT_EMAIL,
  ActionType.DRAFT_MESSAGING_CHANNEL,
  ActionType.FORWARD,
  ActionType.LABEL,
  ActionType.MARK_SPAM,
  ActionType.NOTIFY_MESSAGING_CHANNEL,
  ActionType.REPLY,
  ActionType.SEND_EMAIL,
  ActionType.CALL_WEBHOOK,
  ActionType.MARK_READ,
  ActionType.STAR,
  ActionType.DELETE,
  ActionType.DIGEST,
  ActionType.MOVE_FOLDER,
  ActionType.NOTIFY_SENDER,
  ActionType.INTEGRATION,
]);

// 参数键由下方选定的工具规范负责并校验。
const zodIntegrationArgs = z.record(z.string(), z.string().nullish()).nullish();
export type IntegrationActionArgs = z.infer<typeof zodIntegrationArgs>;

const zodConditionType = z.enum([ConditionType.AI, ConditionType.STATIC]);

const zodSystemRule = z.enum([
  SystemType.TO_REPLY,
  SystemType.AWAITING_REPLY,
  SystemType.FYI,
  SystemType.ACTIONED,
  SystemType.COLD_EMAIL,
  SystemType.NEWSLETTER,
  SystemType.MARKETING,
  SystemType.CALENDAR,
  SystemType.RECEIPT,
  SystemType.NOTIFICATION,
  SystemType.OTP,
]);

const zodAiCondition = z.object({
  instructions: z.string().nullish(),
});

const zodStaticCondition = z.object({
  to: z.string().nullish(),
  from: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.string().nullish(),
});

const zodCondition = z.object({
  type: zodConditionType,
  ...zodAiCondition.shape,
  ...zodStaticCondition.shape,
});
export type ZodCondition = z.infer<typeof zodCondition>;

const zodField = z
  .object({
    value: z.string().nullish(),
    ai: z.boolean().nullish(),
    // 仅前端需要
    setManually: z.boolean().nullish(),
    // 用于在没有 labelId 时作为备份的标签名称（仅用于标签字段）
    name: z.string().nullish(),
  })
  .nullish();

const zodAction = z
  .object({
    id: z.string().optional(),
    type: zodActionType,
    messagingChannelId: z.string().cuid().nullish(),
    labelId: zodField,
    subject: zodField,
    content: zodField,
    to: zodField,
    cc: zodField,
    bcc: zodField,
    url: zodField,
    folderName: zodField,
    folderId: zodField,
    delayInMinutes: delayInMinutesSchema,
    staticAttachments: z.array(attachmentSourceInputSchema).optional(),
    integrationName: z.string().nullish(),
    integrationToolName: z.string().nullish(),
    integrationArgs: zodIntegrationArgs,
  })
  .superRefine((data, ctx) => {
    if (
      addDisabledRuleActionIssue(data.type, ctx, {
        allowExisting: Boolean(data.id),
      })
    ) {
      return;
    }

    if (data.type === ActionType.LABEL) {
      const labelValue =
        data.labelId?.value?.trim() || data.labelId?.name?.trim();

      if (!labelValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "请为标签操作输入标签名称",
          path: ["labelId"],
        });
        return;
      }

      const validation = validateLabelNameBasic(labelValue);
      if (!validation.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validation.error!,
          path: ["labelId"],
        });
      }
    }

    addRecipientRequirementIssue({
      actionType: data.type,
      recipient: data.to?.value,
      ctx,
      path: ["to"],
      forwardMessage: "请输入要转发到的邮箱地址",
      sendEmailMessage: "请输入要发送到的邮箱地址。自动回复请使用“回复”。",
    });

    if (data.type === ActionType.CALL_WEBHOOK && !data.url?.value?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请输入 Webhook URL",
        path: ["url"],
      });
    }

    if (
      data.type === ActionType.DRAFT_MESSAGING_CHANNEL &&
      // 已持久化的历史记录可能没有渠道；保持其可编辑。
      !data.messagingChannelId &&
      !data.id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请选择聊天目标",
        path: ["messagingChannelId"],
      });
    }

    if (
      data.type === ActionType.NOTIFY_MESSAGING_CHANNEL &&
      !data.messagingChannelId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请选择聊天目标",
        path: ["messagingChannelId"],
      });
    }
    // folderId 是可选的：仅提供名称的输入（来自 AI 生成的规则）
    // 会在规则保存前解析为文件夹 id。
    if (
      data.type === ActionType.MOVE_FOLDER &&
      !data.folderName?.value?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请从列表中选择一个文件夹",
        path: ["folderName"],
      });
    }

    addIntegrationActionIssues({
      actionType: data.type,
      integrationName: data.integrationName,
      integrationToolName: data.integrationToolName,
      integrationArgs: data.integrationArgs,
      ctx,
    });
  });

export const createRuleBody = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请输入名称"),
  instructions: z.string().nullish(),
  groupId: z.string().nullish(),
  runOnThreads: z.boolean().nullish(),
  digest: z.boolean().nullish(),
  notifyMessagingChannelId: z.string().nullish(),
  actions: z.array(zodAction).min(1, "至少需要一项操作"),
  conditions: z
    .array(zodCondition)
    .min(1, "至少需要一个条件")
    .refine(
      (conditions) => {
        // 如果多个 STATIC 条件填充了不同的字段，则允许它们共存
        // 但只允许一个 AI 条件
        const aiConditions = conditions.filter(
          (c) => c.type === ConditionType.AI,
        );
        if (aiConditions.length > 1) {
          return false;
        }

        // 对于 STATIC 条件，检查它们是否具有不同的字段
        const staticConditions = conditions.filter(
          (c) => c.type === ConditionType.STATIC,
        );

        // 过滤掉空的静态条件（即生效字段没有值的条件）
        const nonEmptyStaticConditions = staticConditions.filter(
          (c) =>
            c.from?.trim() ||
            c.to?.trim() ||
            c.subject?.trim() ||
            c.body?.trim(),
        );

        if (nonEmptyStaticConditions.length <= 1) {
          return true; // 不可能有重复项
        }

        // 根据填充了哪些字段，为每个非空静态条件创建一个签名
        const staticSignatures = nonEmptyStaticConditions.map((c) => {
          const fields = [];
          if (c.from) fields.push("from");
          if (c.to) fields.push("to");
          if (c.subject) fields.push("subject");
          if (c.body) fields.push("body");
          return fields.sort().join(",");
        });

        // 检查重复项
        const uniqueSignatures = new Set(staticSignatures);
        return uniqueSignatures.size === staticSignatures.length;
      },
      {
        message: "不能有重复的条件。",
      },
    ),
  conditionalOperator: z
    .enum([LogicalOperator.AND, LogicalOperator.OR])
    .optional(),
  systemType: zodSystemRule.nullish(),
});
export type CreateRuleBody = z.infer<typeof createRuleBody>;

export const updateRuleBody = createRuleBody.extend({ id: z.string() });
export type UpdateRuleBody = z.infer<typeof updateRuleBody>;

export const deleteRuleBody = z.object({ id: z.string() });

export const enableDraftRepliesBody = z.object({ enable: z.boolean() });
export type EnableDraftRepliesBody = z.infer<typeof enableDraftRepliesBody>;

export const enableMultiRuleSelectionBody = z.object({ enable: z.boolean() });
export type EnableMultiRuleSelectionBody = z.infer<
  typeof enableMultiRuleSelectionBody
>;

export const updateDraftReplyConfidenceBody = z.object({
  confidence: z.nativeEnum(DraftReplyConfidence),
});
export type UpdateDraftReplyConfidenceBody = z.infer<
  typeof updateDraftReplyConfidenceBody
>;

const categoryAction = z.enum([
  "label",
  "label_archive",
  "label_archive_delayed",
  "move_folder",
  "move_folder_delayed",
  "none",
]);
export type CategoryAction = z.infer<typeof categoryAction>;

const categoryConfig = z.object({
  action: categoryAction.nullish(),
  hasDigest: z.boolean().nullish(),
  name: z
    .string()
    .trim()
    .min(1, "请输入名称")
    .max(40, "名称请控制在 40 个字符以内"),
  description: z.string(),
  key: zodSystemRule.nullable(),
});
export type CategoryConfig = z.infer<typeof categoryConfig>;

export const createRulesOnboardingBody = z.array(categoryConfig);
export type CreateRulesOnboardingBody = z.infer<
  typeof createRulesOnboardingBody
>;

export const toggleRuleBody = z
  .object({
    ruleId: z.string().optional(),
    systemType: zodSystemRule.optional(),
    enabled: z.boolean(),
  })
  .refine((data) => data.ruleId || data.systemType, {
    message: "必须提供 ruleId 或 systemType",
  });

export const toggleAllRulesBody = z.object({
  enabled: z.boolean(),
});
export type ToggleAllRulesBody = z.infer<typeof toggleAllRulesBody>;

export const copyRulesFromAccountBody = z.object({
  sourceEmailAccountId: z.string().min(1, "源账号为必填项"),
  targetEmailAccountId: z.string().min(1, "目标账号为必填项"),
  ruleIds: z.array(z.string()).min(1, "请至少选择一条要复制的规则"),
});
export type CopyRulesFromAccountBody = z.infer<typeof copyRulesFromAccountBody>;

// 从 JSON 导出导入规则的 schema
const importedAction = z
  .object({
    type: zodActionType,
    label: z.string().nullish(),
    to: z.string().nullish(),
    cc: z.string().nullish(),
    bcc: z.string().nullish(),
    subject: z.string().nullish(),
    content: z.string().nullish(),
    folderName: z.string().nullish(),
    url: z.string().nullish(),
    delayInMinutes: delayInMinutesSchema,
    integrationName: z.string().nullish(),
    integrationToolName: z.string().nullish(),
    integrationArgs: zodIntegrationArgs,
  })
  .superRefine((data, ctx) => {
    if (addDisabledRuleActionIssue(data.type, ctx)) return;

    if (data.type === ActionType.LABEL) {
      const labelValue = data.label?.trim();

      if (!labelValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "标签操作需要标签名称",
          path: ["label"],
        });
        return;
      }

      const validation = validateLabelNameBasic(labelValue);
      if (!validation.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validation.error!,
          path: ["label"],
        });
      }
    }

    addRecipientRequirementIssue({
      actionType: data.type,
      recipient: data.to,
      ctx,
      path: ["to"],
      forwardMessage: "转发操作需要收件人邮箱地址",
      sendEmailMessage:
        "发送邮件操作需要收件人邮箱地址。自动回复请使用“回复”。",
    });

    if (data.type === ActionType.CALL_WEBHOOK && !data.url?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Webhook 操作需要 URL",
        path: ["url"],
      });
    }

    if (data.type === ActionType.MOVE_FOLDER && !data.folderName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "移动文件夹操作需要文件夹名称",
        path: ["folderName"],
      });
    }

    addIntegrationActionIssues({
      actionType: data.type,
      integrationName: data.integrationName,
      integrationToolName: data.integrationToolName,
      integrationArgs: data.integrationArgs,
      ctx,
    });
  });

const importedRule = z
  .object({
    name: z.string().min(1),
    instructions: z.string().nullish(),
    enabled: z.boolean().optional().default(true),
    automate: z.boolean().optional().default(true),
    runOnThreads: z.boolean().optional().default(false),
    systemType: zodSystemRule.nullish(),
    conditionalOperator: z
      .enum([LogicalOperator.AND, LogicalOperator.OR])
      .optional()
      .default(LogicalOperator.AND),
    from: z.string().nullish(),
    to: z.string().nullish(),
    subject: z.string().nullish(),
    body: z.string().nullish(),
    categoryFilterType: z
      .enum([CategoryFilterType.INCLUDE, CategoryFilterType.EXCLUDE])
      .nullish(),
    actions: z.array(importedAction).min(1),
    group: z.string().nullish(),
  })
  .refine(
    (data) =>
      data.systemType ||
      data.from?.trim() ||
      data.to?.trim() ||
      data.subject?.trim() ||
      data.body?.trim() ||
      data.instructions?.trim(),
    {
      message: "至少需要提供一个条件（发件人、收件人、主题、正文或指令）",
    },
  );

export const importRulesBody = z.object({
  rules: z.array(importedRule).min(1, "没有可导入的规则"),
});
export type ImportRulesBody = z.infer<typeof importRulesBody>;
export type ImportedRule = z.infer<typeof importedRule>;

function addIntegrationActionIssues({
  actionType,
  integrationName,
  integrationToolName,
  integrationArgs,
  ctx,
}: {
  actionType: ActionType;
  integrationName: string | null | undefined;
  integrationToolName: string | null | undefined;
  integrationArgs: IntegrationActionArgs;
  ctx: z.RefinementCtx;
}) {
  if (actionType !== ActionType.INTEGRATION) return;

  const integration = integrationName
    ? findIntegration(integrationName)
    : undefined;
  if (!integration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "未知集成",
      path: ["integrationName"],
    });
    return;
  }

  const spec = getIntegrationToolSpec(integrationName, integrationToolName);
  if (
    !spec ||
    !integrationToolName ||
    !integration.ruleActionWriteTools?.includes(integrationToolName)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "不支持的集成工具",
      path: ["integrationToolName"],
    });
    return;
  }

  const args = (integrationArgs ?? {}) as Record<string, unknown>;
  const knownKeys = new Set(getIntegrationArgKeys(spec));
  for (const key of Object.keys(args)) {
    if (args[key] == null || knownKeys.has(key)) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `此集成工具有未知参数：${key}`,
      path: ["integrationArgs", key],
    });
  }

  for (const arg of spec.args) {
    if (!arg.required) continue;
    const value =
      typeof args[arg.key] === "string" ? (args[arg.key] as string) : "";
    // 当 AI 在执行时填充该值时，允许为空。
    if (value.trim() || arg.aiPrompt) continue;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `请输入 ${arg.label.toLowerCase()} 的值`,
      path: ["integrationArgs", arg.key],
    });
  }
}

function addRecipientRequirementIssue({
  actionType,
  recipient,
  ctx,
  path,
  forwardMessage,
  sendEmailMessage,
}: {
  actionType: ActionType;
  recipient: string | null | undefined;
  ctx: z.RefinementCtx;
  path: (string | number)[];
  forwardMessage: string;
  sendEmailMessage: string;
}) {
  addMissingRecipientIssue({
    actionType,
    recipient,
    ctx,
    path,
    forwardMessage,
    sendEmailMessage,
  });
}
