"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  saveAiSettingsBody,
  saveDecisionModelSettingsBody,
  saveSensitiveDataPolicyBody,
  saveEmailUpdateSettingsBody,
  saveDigestScheduleBody,
  updateDigestItemsBody,
  toggleDigestBody,
} from "@/utils/actions/settings.validation";
import { DEFAULT_PROVIDER, Provider } from "@/utils/llms/config";
import prisma from "@/utils/prisma";
import {
  calculateNextScheduleDate,
  createCanonicalTimeOfDay,
} from "@/utils/schedule";
import { actionClientUser } from "@/utils/actions/safe-action";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { clearSpecificErrorMessages, ErrorType } from "@/utils/error-messages";
import { SafeError } from "@/utils/error";
import { env } from "@/env";
import { addActionOwnershipToInput } from "@/utils/rule/rule";
import { isSensitiveDataPolicyLocked } from "@/utils/dlp/policy.server";
import { assertCanUseDigests } from "@/utils/premium/server";

export const updateEmailSettingsAction = actionClient
  .metadata({ name: "updateEmailSettings" })
  .inputSchema(saveEmailUpdateSettingsBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { statsEmailFrequency, summaryEmailFrequency },
    }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          statsEmailFrequency,
          summaryEmailFrequency,
        },
      });
    },
  );

export const updateAiSettingsAction = actionClientUser
  .metadata({ name: "updateAiSettings" })
  .inputSchema(saveAiSettingsBody)
  .action(
    async ({
      ctx: { userId, logger },
      parsedInput: { aiProvider, aiModel, aiApiKey },
    }) => {
      if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
        throw new SafeError("AI 模型设置由部署方管理。");
      }

      if (aiProvider === Provider.AZURE && !env.AZURE_RESOURCE_NAME) {
        throw new Error("Azure 服务商需要在服务器上配置 AZURE_RESOURCE_NAME");
      }

      const providedAiApiKey = aiApiKey?.trim() || null;

      let nextAiApiKey: string | null = providedAiApiKey;

      if (!nextAiApiKey && aiProvider !== DEFAULT_PROVIDER) {
        const existingUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { aiProvider: true, aiApiKey: true },
        });

        if (!existingUser) throw new SafeError("未找到用户");

        nextAiApiKey =
          existingUser.aiProvider === aiProvider ? existingUser.aiApiKey : null;

        if (!nextAiApiKey) {
          throw new SafeError("你必须为此服务商提供 API 密钥");
        }
      }

      const result = await prisma.user.updateMany({
        where: { id: userId },
        data:
          aiProvider === DEFAULT_PROVIDER
            ? { aiProvider: null, aiModel: null, aiApiKey: null }
            : { aiProvider, aiModel, aiApiKey: nextAiApiKey },
      });

      if (result.count === 0) {
        throw new SafeError("未找到用户");
      }

      // 用户更新设置时清除与 AI 相关的错误消息
      // 这样如果新设置同样无效，他们可以再次收到通知
      await clearSpecificErrorMessages({
        userId,
        errorTypes: [
          ErrorType.INCORRECT_API_KEY,
          ErrorType.INVALID_AI_MODEL,
          ErrorType.API_KEY_DEACTIVATED,
          ErrorType.AI_QUOTA_ERROR,
          ErrorType.INSUFFICIENT_CREDITS,
          // 旧存储错误的遗留键
          ErrorType.INCORRECT_OPENAI_API_KEY,
          ErrorType.OPENAI_API_KEY_DEACTIVATED,
          ErrorType.ANTHROPIC_INSUFFICIENT_BALANCE,
        ],
        logger,
      });
    },
  );

export const updateDecisionModelSettingsAction = actionClientUser
  .metadata({ name: "updateDecisionModelSettings" })
  .inputSchema(saveDecisionModelSettingsBody)
  .action(
    async ({ ctx: { userId }, parsedInput: { decisionModelEnabled } }) => {
      if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
        throw new SafeError("AI 模型设置由部署方管理。");
      }

      await prisma.user.update({
        where: { id: userId },
        data: { decisionModelEnabled },
      });
    },
  );

export const updateSensitiveDataPolicyAction = actionClient
  .metadata({ name: "updateSensitiveDataPolicy" })
  .inputSchema(saveSensitiveDataPolicyBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { sensitiveDataPolicy },
    }) => {
      if (isSensitiveDataPolicyLocked()) {
        throw new SafeError("敏感数据保护由部署方管理。");
      }

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { sensitiveDataPolicy },
      });
    },
  );

export const updateDigestScheduleAction = actionClient
  .metadata({ name: "updateDigestSchedule" })
  .inputSchema(saveDigestScheduleBody)
  .action(async ({ ctx: { emailAccountId, userId }, parsedInput }) => {
    await assertCanUseDigests(userId);

    const { intervalDays, daysOfWeek, timeOfDay, occurrences } = parsedInput;

    const create: Prisma.ScheduleUpsertArgs["create"] = {
      emailAccountId,
      intervalDays,
      daysOfWeek,
      timeOfDay,
      occurrences,
      lastOccurrenceAt: new Date(),
      nextOccurrenceAt: calculateNextScheduleDate({
        ...parsedInput,
        lastOccurrenceAt: null,
      }),
    };

    const { emailAccountId: _emailAccountId, ...update } = create;

    const schedule = await prisma.schedule.upsert({
      where: { emailAccountId },
      create,
      update,
    });

    return {
      success: true,
      nextOccurrenceAt: schedule.nextOccurrenceAt?.toISOString() ?? null,
    };
  });

export const updateDigestItemsAction = actionClient
  .metadata({ name: "updateDigestItems" })
  .inputSchema(updateDigestItemsBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { ruleDigestPreferences },
    }) => {
      if (Object.values(ruleDigestPreferences).some(Boolean)) {
        await assertCanUseDigests(userId);
      }

      const promises = Object.entries(ruleDigestPreferences).map(
        async ([ruleId, enabled]) => {
          // 校验该规则属于此邮箱账号
          const rule = await prisma.rule.findUnique({
            where: {
              id: ruleId,
              emailAccountId,
            },
            select: { id: true, actions: true, organizationRuleId: true },
          });

          if (!rule) {
            logger.error("未找到规则", { ruleId });
            return;
          }

          if (rule.organizationRuleId) return;

          const hasDigestAction = rule.actions.some(
            (action) => action.type === ActionType.DIGEST,
          );

          if (enabled && !hasDigestAction) {
            // 添加 DIGEST 操作
            await prisma.action.create({
              data: addActionOwnershipToInput(
                {
                  ruleId: rule.id,
                  type: ActionType.DIGEST,
                },
                emailAccountId,
              ),
            });
          } else if (!enabled && hasDigestAction) {
            // 移除 DIGEST 操作
            await prisma.action.deleteMany({
              where: {
                ruleId: rule.id,
                type: ActionType.DIGEST,
              },
            });
          }
        },
      );

      await Promise.all(promises);
      return { success: true };
    },
  );

export const toggleDigestAction = actionClient
  .metadata({ name: "toggleDigest" })
  .inputSchema(toggleDigestBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { enabled, timeOfDay },
    }) => {
      if (enabled) {
        await assertCanUseDigests(userId);

        const defaultSchedule = {
          intervalDays: 1,
          occurrences: 1,
          daysOfWeek: 127,
          timeOfDay: timeOfDay ?? createCanonicalTimeOfDay(9, 0),
        };

        await prisma.schedule.upsert({
          where: { emailAccountId },
          create: {
            emailAccountId,
            ...defaultSchedule,
            lastOccurrenceAt: new Date(),
            nextOccurrenceAt: calculateNextScheduleDate({
              ...defaultSchedule,
              lastOccurrenceAt: null,
            }),
          },
          update: {},
        });

        const newsletterRule = await prisma.rule.findFirst({
          where: { emailAccountId, systemType: SystemType.NEWSLETTER },
          include: { actions: true },
        });

        if (
          newsletterRule &&
          !newsletterRule.actions.some((a) => a.type === ActionType.DIGEST)
        ) {
          await prisma.action.create({
            data: addActionOwnershipToInput(
              {
                ruleId: newsletterRule.id,
                type: ActionType.DIGEST,
              },
              emailAccountId,
            ),
          });
        }
      } else {
        await prisma.schedule.deleteMany({
          where: { emailAccountId },
        });
      }

      return { success: true };
    },
  );
