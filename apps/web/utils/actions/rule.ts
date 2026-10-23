"use server";

import { toggleRule } from "@/utils/rule/toggle-rule";
import { getDefaultMailSplitDrafts } from "@/utils/split-inbox/default-splits";
import { ONBOARDING_PROCESS_EMAILS_COUNT } from "@/utils/config";
import { after } from "next/server";
import {
  createRuleBody,
  updateRuleBody,
  enableDraftRepliesBody,
  enableMultiRuleSelectionBody,
  updateDraftReplyConfidenceBody,
  deleteRuleBody,
  createRulesOnboardingBody,
  type CategoryConfig,
  type CategoryAction,
  toggleRuleBody,
  toggleAllRulesBody,
  copyRulesFromAccountBody,
  importRulesBody,
} from "@/utils/actions/rule.validation";
import prisma from "@/utils/prisma";
import { isDuplicateError, isNotFoundError } from "@/utils/prisma-helpers";
import { flattenConditions } from "@/utils/condition";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import { sanitizeActionFields } from "@/utils/action-item";
import {
  deleteRule,
  upsertSystemRule,
  createRule,
  updateRule,
  createRuleWithResolvedActions,
  replaceRuleWithResolvedActions,
  setRuleEnabled,
  type RuleActionCreateData,
  addActionOwnershipToInput,
  assertIntegrationActionsConnected,
} from "@/utils/rule/rule";
import { SafeError } from "@/utils/error";
import {
  getRuleConfig,
  getCategoryAction,
  getActionTypesForCategoryAction,
  STANDARD_CATEGORY_SYSTEM_TYPES,
} from "@/utils/rule/consts";
import { actionClient, actionClientUser } from "@/utils/actions/safe-action";
import { assertRuleIsNotOrgManaged } from "@/utils/organizations/rules";
import { env } from "@/env";
import { ONE_WEEK_MINUTES } from "@/utils/date";
import { createEmailProvider } from "@/utils/email/provider";
import { resolveLabelNameAndId } from "@/utils/label/resolve-label";
import type { Logger } from "@/utils/logger";
import { validateGmailLabelName } from "@/utils/gmail/label-validation";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { bulkProcessInboxEmails } from "@/utils/ai/choose-rule/bulk-process-emails";
import { getEmailAccountForRuleExecution } from "@/utils/user/get";
import type { AttachmentSourceInput } from "@/utils/attachments/source-schema";
import { assertCanUseDigestsIfNeeded } from "@/utils/premium/server";
import { toCreateOrUpdateRuleCondition } from "@/utils/rule/create-rule-condition";
import { setDefaultMailSplits } from "@/utils/split-inbox/default-splits.server";

export const createRuleAction = actionClient
  .metadata({ name: "createRule" })
  .inputSchema(createRuleBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger, provider },
      parsedInput: {
        name,
        runOnThreads,
        actions,
        conditions: conditionsInput,
        conditionalOperator,
      },
    }) => {
      await assertCanUseDigestsIfNeeded(userId, actions ?? []);

      const conditions = flattenConditions(conditionsInput, logger);

      const resolvedActions = await resolveActionLabels(
        actions || [],
        emailAccountId,
        provider,
        logger,
      );

      try {
        const rule = await createRule({
          result: {
            name,
            condition: toCreateOrUpdateRuleCondition({
              aiInstructions: conditions.instructions,
              conditionalOperator: conditionalOperator || null,
              static: {
                from: conditions.from,
                to: conditions.to,
                subject: conditions.subject,
              },
            }),
            actions: resolvedActions.map(mapActionToSanitizedFields),
          },
          emailAccountId,
          provider,
          runOnThreads: runOnThreads ?? true,
          logger,
        });

        return { rule };
      } catch (error) {
        handleRuleError(error, logger);
      }
    },
  );

export const updateRuleAction = actionClient
  .metadata({ name: "updateRule" })
  .inputSchema(updateRuleBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger, provider },
      parsedInput: {
        id,
        name,
        runOnThreads,
        actions,
        conditions: conditionsInput,
        conditionalOperator,
      },
    }) => {
      await assertRuleIsNotOrgManaged({ ruleId: id, emailAccountId });

      const existingRule = await prisma.rule.findFirst({
        where: { id, emailAccountId },
        select: { actions: { select: { type: true } } },
      });

      await assertCanUseDigestsIfNeeded(userId, actions, existingRule?.actions);

      const conditions = flattenConditions(conditionsInput, logger);

      const resolvedActions = await resolveActionLabels(
        actions,
        emailAccountId,
        provider,
        logger,
      );

      try {
        const rule = await updateRule({
          ruleId: id,
          result: {
            name: name || "",
            condition: toCreateOrUpdateRuleCondition({
              aiInstructions: conditions.instructions,
              conditionalOperator: conditionalOperator || null,
              static: {
                from: conditions.from,
                to: conditions.to,
                subject: conditions.subject,
              },
            }),
            actions: resolvedActions.map(mapActionToSanitizedFields),
          },
          emailAccountId,
          provider,
          logger,
          runOnThreads: runOnThreads ?? undefined,
        });

        return { rule };
      } catch (error) {
        handleRuleError(error, logger);
      }
    },
  );

export const enableDraftRepliesAction = actionClient
  .metadata({ name: "enableDraftReplies" })
  .inputSchema(enableDraftRepliesBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { enable },
    }) => {
      if (env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED && enable) return;

      const existingRule = await prisma.rule.findUnique({
        where: {
          emailAccountId_systemType: {
            emailAccountId,
            systemType: SystemType.TO_REPLY,
          },
        },
        include: { actions: true },
      });

      if (!existingRule && !enable) {
        return;
      }

      const rule = existingRule
        ? existingRule.enabled === enable
          ? existingRule
          : await setRuleEnabled({
              ruleId: existingRule.id,
              emailAccountId,
              enabled: enable,
            })
        : await toggleRule({
            emailAccountId,
            enabled: enable,
            systemType: SystemType.TO_REPLY,
            provider,
            ruleId: undefined,
            logger,
          });

      if (enable) {
        const alreadyDraftingReplies = rule.actions.find(
          (a) => a.type === ActionType.DRAFT_EMAIL,
        );
        if (!alreadyDraftingReplies) {
          await prisma.action.create({
            data: addActionOwnershipToInput(
              {
                ruleId: rule.id,
                type: ActionType.DRAFT_EMAIL,
              },
              emailAccountId,
            ),
          });
        }
      } else {
        await prisma.action.deleteMany({
          where: {
            ruleId: rule.id,
            type: ActionType.DRAFT_EMAIL,
          },
        });
      }
    },
  );

export const enableMultiRuleSelectionAction = actionClient
  .metadata({ name: "enableMultiRuleSelection" })
  .inputSchema(enableMultiRuleSelectionBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { enable } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { multiRuleSelectionEnabled: enable },
    });
  });

export const updateDraftReplyConfidenceAction = actionClient
  .metadata({ name: "updateDraftReplyConfidence" })
  .inputSchema(updateDraftReplyConfidenceBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { confidence } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { draftReplyConfidence: confidence },
    });
  });

export const deleteRuleAction = actionClient
  .metadata({ name: "deleteRule" })
  .inputSchema(deleteRuleBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { id } }) => {
    const rule = await prisma.rule.findUnique({
      where: {
        id_emailAccountId: {
          id,
          emailAccountId,
        },
      },
      select: { systemType: true, groupId: true, organizationRuleId: true },
    });
    if (!rule) return; // 已删除
    if (rule.organizationRuleId) {
      throw new SafeError("此规则由你的组织管理，无法在此删除。");
    }
    if (rule.systemType) {
      throw new SafeError("默认规则无法删除。请改为禁用它们。");
    }

    try {
      await deleteRule({
        ruleId: id,
        emailAccountId,
        groupId: rule.groupId,
      });
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  });

export const createRulesOnboardingAction = actionClient
  .metadata({ name: "createRulesOnboarding" })
  .inputSchema(createRulesOnboardingBody)
  .action(
    async ({ ctx: { emailAccountId, provider, logger }, parsedInput }) => {
      const systemCategoryMap: Map<SystemType, CategoryConfig> = new Map();
      const customCategories: CategoryConfig[] = [];

      for (const category of parsedInput) {
        if (category.key) {
          systemCategoryMap.set(category.key, category);
        } else {
          customCategories.push(category);
        }
      }

      const emailAccount = await getEmailAccountForRuleExecution({
        emailAccountId,
      });
      if (!emailAccount) throw new SafeError("未找到用户");

      const promises: Promise<unknown>[] = [];
      const defaultSplitRulePromises: Array<
        ReturnType<typeof upsertSystemRule>
      > = [];

      const isSet = (
        value: string | undefined | null,
      ): value is
        | "label"
        | "label_archive"
        | "label_archive_delayed"
        | "move_folder"
        | "move_folder_delayed" => value !== "none" && value !== undefined;

      async function createSystemRuleForOnboarding(
        systemType: SystemType,
        userSelectedAction?: CategoryAction,
      ) {
        const ruleConfiguration = getRuleConfig(systemType);
        const { name, instructions, label, runOnThreads } = ruleConfiguration;
        const categoryAction =
          userSelectedAction || getCategoryAction(systemType, provider);

        const promise = (async () => {
          const actions = await getActionsFromCategoryAction({
            emailAccountId,
            ruleName: name,
            categoryAction,
            label,
            hasDigest: false,
            draftReply: !!ruleConfiguration.draftReply,
            provider,
            logger,
            systemType,
          });

          return upsertSystemRule({
            name,
            instructions,
            actions,
            emailAccountId,
            systemType,
            runOnThreads,
            enabled: true,
            logger,
          });
        })();

        promises.push(promise);

        return promise;
      }

      async function deleteRule(
        systemType: SystemType,
        emailAccountId: string,
      ) {
        const promise = async () => {
          const rule = await prisma.rule.findUnique({
            where: {
              emailAccountId_systemType: { emailAccountId, systemType },
            },
          });
          if (!rule) return;
          await prisma.rule.delete({ where: { id: rule.id } });
        };
        promises.push(promise());
      }

      // 处理系统规则
      for (const type of STANDARD_CATEGORY_SYSTEM_TYPES) {
        const config = systemCategoryMap.get(type);
        if (config && isSet(config.action)) {
          defaultSplitRulePromises.push(
            createSystemRuleForOnboarding(type, config.action),
          );
        } else {
          deleteRule(type, emailAccountId);
        }
      }

      const conversationRules = [
        SystemType.FYI,
        SystemType.AWAITING_REPLY,
        SystemType.ACTIONED,
      ];

      for (const type of conversationRules) {
        const config = systemCategoryMap.get(SystemType.TO_REPLY);
        if (config && isSet(config.action)) {
          createSystemRuleForOnboarding(type);
        } else {
          deleteRule(type, emailAccountId);
        }
      }

      // 为自定义分类创建规则
      for (const customCategory of customCategories) {
        if (customCategory.action && isSet(customCategory.action)) {
          const actions = await getActionsFromCategoryAction({
            emailAccountId,
            ruleName: customCategory.name,
            categoryAction: customCategory.action,
            label: customCategory.name,
            hasDigest: false,
            draftReply: false,
            provider,
            logger,
            systemType: undefined,
          });

          const promise = createRuleWithResolvedActions({
            emailAccountId,
            data: {
              name: customCategory.name,
              instructions:
                customCategory.description ||
                `Custom category: ${customCategory.name}`,
              systemType: null,
              runOnThreads: true,
            },
            actions,
          })
            .then(() => {})
            .catch((error) => {
              if (isDuplicateError(error, "name")) return;
              logger.error("创建规则时出错", { error });
              throw error;
            });

          promises.push(promise);
        }
      }

      await Promise.allSettled(promises);

      try {
        const systemRules = await Promise.all(defaultSplitRulePromises);
        await setDefaultMailSplits({
          emailAccountId,
          defaultSplits: getDefaultMailSplitDrafts(systemRules),
          enabled: true,
        });
      } catch (error) {
        logger.error("创建默认邮件拆分时出错", { error });
      }

      after(() =>
        bulkProcessInboxEmails({
          emailAccount,
          provider,
          maxEmails: ONBOARDING_PROCESS_EMAILS_COUNT,
          skipArchive: true,
          logger,
        }),
      );
    },
  );

export const toggleRuleAction = actionClient
  .metadata({ name: "toggleRule" })
  .inputSchema(toggleRuleBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { ruleId, systemType, enabled },
    }) => {
      await toggleRule({
        ruleId,
        systemType,
        enabled,
        emailAccountId,
        provider,
        logger,
      });
    },
  );

export const toggleAllRulesAction = actionClient
  .metadata({ name: "toggleAllRules" })
  .inputSchema(toggleAllRulesBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { enabled } }) => {
    if (enabled) {
      await prisma.rule.updateMany({
        where: { emailAccountId, organizationRuleId: null },
        data: { enabled },
      });
    } else {
      await prisma.$transaction([
        prisma.rule.updateMany({
          where: { emailAccountId, organizationRuleId: null },
          data: { enabled },
        }),
        prisma.emailAccount.update({
          where: { id: emailAccountId },
          data: {
            followUpAwaitingReplyDays: null,
            followUpNeedsReplyDays: null,
          },
        }),
      ]);
    }

    return { success: true };
  });

export const copyRulesFromAccountAction = actionClientUser
  .metadata({ name: "copyRulesFromAccount" })
  .inputSchema(copyRulesFromAccountBody)
  .action(
    async ({
      ctx: { userId, logger },
      parsedInput: { sourceEmailAccountId, targetEmailAccountId, ruleIds },
    }) => {
      if (sourceEmailAccountId === targetEmailAccountId) {
        throw new SafeError("源账号和目标账号必须不同");
      }

      // 校验用户拥有这两个账号
      const [sourceAccount, targetAccount] = await Promise.all([
        prisma.emailAccount.findUnique({
          where: { id: sourceEmailAccountId },
          select: {
            id: true,
            email: true,
            account: { select: { userId: true, provider: true } },
          },
        }),
        prisma.emailAccount.findUnique({
          where: { id: targetEmailAccountId },
          select: {
            id: true,
            email: true,
            account: { select: { userId: true, provider: true } },
          },
        }),
      ]);

      if (!sourceAccount || sourceAccount.account.userId !== userId) {
        throw new SafeError("未找到源账号或未授权");
      }
      if (!targetAccount || targetAccount.account.userId !== userId) {
        throw new SafeError("未找到目标账号或未授权");
      }

      const sourceRules = await prisma.rule.findMany({
        where: {
          emailAccountId: sourceEmailAccountId,
          id: { in: ruleIds },
          organizationRuleId: null,
        },
        include: { actions: true },
      });

      if (sourceRules.length === 0) {
        return { copiedCount: 0, replacedCount: 0 };
      }

      await assertCanUseDigestsIfNeeded(
        userId,
        sourceRules.flatMap((rule) => rule.actions),
      );

      const targetRules = await prisma.rule.findMany({
        where: {
          emailAccountId: targetEmailAccountId,
          organizationRuleId: null,
        },
        select: { id: true, name: true, systemType: true },
      });

      // 为匹配现有规则构建查找映射
      const targetRulesByName = new Map(
        targetRules.map((r) => [r.name.toLowerCase(), r.id]),
      );
      const targetRulesBySystemType = new Map(
        targetRules
          .filter((r) => r.systemType)
          .map((r) => [r.systemType!, r.id]),
      );

      let copiedCount = 0;
      let replacedCount = 0;

      for (const sourceRule of sourceRules) {
        // 系统规则按 systemType 匹配；普通规则按名称匹配
        const existingRuleId = sourceRule.systemType
          ? targetRulesBySystemType.get(sourceRule.systemType)
          : targetRulesByName.get(sourceRule.name.toLowerCase());

        // 映射操作 - 保留标签名称但清除 ID（规则执行时会解析它们）
        const mappedActions = sourceRule.actions.map((action) => ({
          type: action.type,
          label: action.label,
          labelId: null, // 清除 ID - 它是账号特有的
          subject: action.subject,
          content: action.content,
          to: action.to,
          cc: action.cc,
          bcc: action.bcc,
          url: action.url,
          folderName: action.folderName,
          folderId: null, // 清除 ID - 它是账号特有的
          delayInMinutes: action.delayInMinutes,
        }));

        if (existingRuleId) {
          await replaceRuleWithResolvedActions({
            ruleId: existingRuleId,
            emailAccountId: targetEmailAccountId,
            data: {
              instructions: sourceRule.instructions,
              enabled: sourceRule.enabled,
              runOnThreads: sourceRule.runOnThreads,
              conditionalOperator: sourceRule.conditionalOperator,
              from: sourceRule.from,
              to: sourceRule.to,
              subject: sourceRule.subject,
              body: sourceRule.body,
              groupId: null,
            },
            actions: mappedActions,
          });
          replacedCount++;
        } else {
          try {
            await createRuleWithResolvedActions({
              emailAccountId: targetEmailAccountId,
              data: {
                name: sourceRule.name,
                systemType: sourceRule.systemType,
                instructions: sourceRule.instructions,
                enabled: sourceRule.enabled,
                runOnThreads: sourceRule.runOnThreads,
                conditionalOperator: sourceRule.conditionalOperator,
                from: sourceRule.from,
                to: sourceRule.to,
                subject: sourceRule.subject,
                body: sourceRule.body,
                groupId: null,
              },
              actions: mappedActions,
            });
            copiedCount++;
          } catch (error) {
            if (!isDuplicateError(error, "name")) throw error;
            logger.info("目标账号中已存在该规则，跳过");
          }
        }
      }

      logger.info("已在账号之间复制规则", {
        sourceEmailAccountId,
        targetEmailAccountId,
        copiedCount,
        replacedCount,
      });

      return { copiedCount, replacedCount };
    },
  );

function mapActionToSanitizedFields(action: {
  type: ActionType;
  messagingChannelId?: string | null;
  labelId?: {
    name?: string | null;
    value?: string | null;
    ai?: boolean | null;
  } | null;
  subject?: { value?: string | null } | null;
  content?: { value?: string | null } | null;
  to?: { value?: string | null } | null;
  cc?: { value?: string | null } | null;
  bcc?: { value?: string | null } | null;
  url?: { value?: string | null } | null;
  folderName?: { value?: string | null } | null;
  folderId?: { value?: string | null } | null;
  delayInMinutes?: number | null;
  staticAttachments?: AttachmentSourceInput[] | null;
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: Record<string, string | null | undefined> | null;
}) {
  const nonEmptyIntegrationArgs = action.integrationArgs
    ? (Object.fromEntries(
        Object.entries(action.integrationArgs).filter(
          ([, value]) => typeof value === "string" && value.trim() !== "",
        ),
      ) as Record<string, string>)
    : undefined;

  const sanitized = sanitizeActionFields({
    type: action.type,
    messagingChannelId: action.messagingChannelId ?? null,
    label: action.labelId?.name,
    labelId: action.labelId?.value,
    subject: action.subject?.value,
    content: action.content?.value,
    to: action.to?.value,
    cc: action.cc?.value,
    bcc: action.bcc?.value,
    url: action.url?.value,
    folderName: action.folderName?.value,
    folderId: action.folderId?.value,
    delayInMinutes: action.delayInMinutes,
    staticAttachments: action.staticAttachments?.length
      ? action.staticAttachments
      : undefined,
    integrationName: action.integrationName,
    integrationToolName: action.integrationToolName,
    integrationArgs: nonEmptyIntegrationArgs,
  });

  return {
    type: sanitized.type,
    fields: {
      label: sanitized.label ?? null,
      to: sanitized.to ?? null,
      cc: sanitized.cc ?? null,
      bcc: sanitized.bcc ?? null,
      subject: sanitized.subject ?? null,
      content: sanitized.content ?? null,
      webhookUrl: sanitized.url ?? null,
      folderName: sanitized.folderName ?? null,
    },
    messagingChannelId: sanitized.messagingChannelId ?? null,
    labelId: sanitized.labelId ?? null,
    folderId: sanitized.folderId ?? null,
    delayInMinutes: sanitized.delayInMinutes ?? null,
    staticAttachments: sanitized.staticAttachments ?? null,
    integrationName: sanitized.integrationName ?? null,
    integrationToolName: sanitized.integrationToolName ?? null,
    integrationArgs: sanitized.integrationArgs ?? null,
  };
}

function handleRuleError(error: unknown, logger: Logger) {
  if (error instanceof SafeError) throw error;

  if (isDuplicateError(error, "name")) {
    throw new SafeError("规则名称已存在");
  }
  if (isDuplicateError(error, "groupId")) {
    throw new SafeError("分组已有规则。请使用现有规则。");
  }
  logger.error("创建/更新规则时出错", { error });
  throw new SafeError("创建/更新规则时出错");
}

async function resolveActionLabels<
  T extends {
    type: ActionType;
    labelId?: {
      name?: string | null;
      value?: string | null;
      ai?: boolean | null;
    } | null;
    folderName?: {
      value?: string | null;
    } | null;
    folderId?: {
      value?: string | null;
    } | null;
  },
>(actions: T[], emailAccountId: string, provider: string, logger: Logger) {
  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider,
    logger,
  });

  return Promise.all(
    actions.map(async (action) => {
      if (action.type === ActionType.LABEL) {
        const labelName = action.labelId?.name || action.labelId?.value || null;

        if (isGoogleProvider(provider) && labelName) {
          const validation = validateGmailLabelName(labelName);
          if (!validation.valid) {
            throw new SafeError(validation.error);
          }
        }

        const { label: resolvedLabel, labelId: resolvedLabelId } =
          await resolveLabelNameAndId({
            emailProvider,
            label: action.labelId?.name || null,
            labelId: action.labelId?.value || null,
          });
        return {
          ...action,
          labelId: {
            value: resolvedLabelId,
            name: resolvedLabel,
            ai: action.labelId?.ai,
          },
        };
      }
      if (action.type === ActionType.MOVE_FOLDER) {
        const folderName = action.folderName?.value;
        if (folderName && !action.folderId?.value) {
          const resolvedFolderId =
            await emailProvider.getOrCreateFolderIdByName(folderName);
          return {
            ...action,
            folderId: {
              value: resolvedFolderId,
            },
            folderName: {
              value: folderName,
            },
          };
        }
      }
      return action;
    }),
  );
}

async function getActionsFromCategoryAction({
  emailAccountId,
  ruleName,
  categoryAction,
  label,
  draftReply,
  hasDigest,
  provider,
  logger,
  systemType,
}: {
  emailAccountId: string;
  ruleName: string;
  categoryAction: CategoryAction;
  label: string;
  hasDigest: boolean;
  draftReply: boolean;
  provider: string;
  logger: Logger;
  systemType?: SystemType;
}): Promise<RuleActionCreateData[]> {
  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider,
    logger,
  });

  function normalizeCategory(action: CategoryAction) {
    switch (action) {
      case "label_archive_delayed":
        return { base: "label_archive" as const, isDelayed: true };
      case "move_folder_delayed":
        return { base: "move_folder" as const, isDelayed: true };
      default:
        return {
          base: action as "label" | "label_archive" | "move_folder",
          isDelayed: false,
        };
    }
  }

  const { base: baseCategoryAction, isDelayed } =
    normalizeCategory(categoryAction);

  const actionTypes = getActionTypesForCategoryAction({
    categoryAction: baseCategoryAction,
    systemType,
    draftReply,
    hasDigest,
  });

  const actions: RuleActionCreateData[] = [];

  for (const actionType of actionTypes) {
    switch (actionType.type) {
      case ActionType.LABEL: {
        const { label: labelName, labelId } = await resolveLabelNameAndId({
          emailProvider,
          label,
          labelId: null,
        });

        logger.info("在引导流程中解析了标签 ID", {
          requestedLabel: label,
          resolvedLabelName: labelName,
          resolvedLabelId: labelId,
          ruleName,
        });

        actions.push({ type: ActionType.LABEL, label: labelName, labelId });
        break;
      }
      case ActionType.MOVE_FOLDER: {
        const folderId =
          await emailProvider.getOrCreateFolderIdByName(ruleName);

        logger.info("在引导流程中解析了文件夹 ID", {
          folderName: ruleName,
          resolvedFolderId: folderId,
          categoryAction,
        });

        actions.push({
          type: ActionType.MOVE_FOLDER,
          folderId,
          folderName: ruleName,
          delayInMinutes: isDelayed ? ONE_WEEK_MINUTES : undefined,
        });
        break;
      }
      case ActionType.ARCHIVE: {
        actions.push({
          type: ActionType.ARCHIVE,
          delayInMinutes: isDelayed ? ONE_WEEK_MINUTES : undefined,
        });
        break;
      }
      default: {
        actions.push({ type: actionType.type });
      }
    }
  }

  return actions;
}

export const importRulesAction = actionClient
  .metadata({ name: "importRules" })
  .inputSchema(importRulesBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { rules },
    }) => {
      logger.info("正在导入规则", { count: rules.length });

      await assertCanUseDigestsIfNeeded(
        userId,
        rules.flatMap((rule) => rule.actions),
      );

      const existingRules = await prisma.rule.findMany({
        where: { emailAccountId, organizationRuleId: null },
        select: { id: true, name: true, systemType: true },
      });

      const rulesByName = new Map(
        existingRules.map((r) => [r.name.toLowerCase(), r.id]),
      );
      const rulesBySystemType = new Map(
        existingRules
          .filter((r) => r.systemType)
          .map((r) => [r.systemType!, r.id]),
      );

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const rule of rules) {
        try {
          // 先按 systemType 匹配，再按名称匹配
          const existingRuleId = rule.systemType
            ? rulesBySystemType.get(rule.systemType)
            : rulesByName.get(rule.name.toLowerCase());

          // 映射操作 - 保留标签名称但清除 ID
          const mappedActions = rule.actions.map((action) => ({
            type: action.type,
            label: action.label,
            labelId: null,
            subject: action.subject,
            content: action.content,
            to: action.to,
            cc: action.cc,
            bcc: action.bcc,
            folderName: action.folderName,
            folderId: null,
            url: action.url,
            delayInMinutes: action.delayInMinutes,
            integrationName: action.integrationName,
            integrationToolName: action.integrationToolName,
            integrationArgs: action.integrationArgs ?? undefined,
          }));

          await assertIntegrationActionsConnected(
            mappedActions,
            emailAccountId,
          );

          if (existingRuleId) {
            await replaceRuleWithResolvedActions({
              ruleId: existingRuleId,
              emailAccountId,
              data: {
                instructions: rule.instructions,
                enabled: rule.enabled ?? true,
                automate: rule.automate ?? true,
                runOnThreads: rule.runOnThreads ?? false,
                conditionalOperator: rule.conditionalOperator,
                categoryFilterType: rule.categoryFilterType,
                from: rule.from,
                to: rule.to,
                subject: rule.subject,
                body: rule.body,
                groupId: null,
              },
              actions: mappedActions,
            });
            updatedCount++;
          } else {
            await createRuleWithResolvedActions({
              emailAccountId,
              data: {
                name: rule.name,
                systemType: rule.systemType,
                instructions: rule.instructions,
                enabled: rule.enabled ?? true,
                automate: rule.automate ?? true,
                runOnThreads: rule.runOnThreads ?? false,
                conditionalOperator: rule.conditionalOperator,
                categoryFilterType: rule.categoryFilterType,
                from: rule.from,
                to: rule.to,
                subject: rule.subject,
                body: rule.body,
                groupId: null,
              },
              actions: mappedActions,
            });
            createdCount++;
          }
        } catch (error) {
          logger.error("Failed to import rule", { ruleName: rule.name, error });
          skippedCount++;
        }
      }

      logger.info("导入完成", {
        createdCount,
        updatedCount,
        skippedCount,
      });

      return { createdCount, updatedCount, skippedCount };
    },
  );
