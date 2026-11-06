"use server";

import { z } from "zod";
import prisma from "@/utils/prisma";
import {
  runRules,
  type RunRulesResult,
} from "@/utils/ai/choose-rule/run-rules";
import {
  runRulesBody,
  testAiCustomContentBody,
} from "@/utils/actions/ai-rule.validation";
import { setRuleRunOnThreads } from "@/utils/rule/rule";
import { assertRuleIsNotOrgManaged } from "@/utils/organizations/rules";
import { actionClient } from "@/utils/actions/safe-action";
import { flushLoggerSafely } from "@/utils/logger-flush";
import { getEmailAccountForRuleExecution } from "@/utils/user/get";
import { SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import { checkHasAccess } from "@/utils/premium/server";
import {
  RERUN_MINIMUM_TIER,
  RERUN_UPGRADE_MESSAGE,
} from "@/utils/premium/rerun";

export const runRulesAction = actionClient
  .metadata({ name: "runRules" })
  .inputSchema(runRulesBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, provider, logger: ctxLogger },
      parsedInput: { messageId, threadId, rerun, isTest, skipDraftReplies },
    }): Promise<RunRulesResult[]> => {
      const logger = ctxLogger.with({ messageId, threadId });

      logger.info("runRulesAction 已开始", { isTest, rerun });

      // 重新运行会丢弃现有结果并产生一次新的 LLM 调用费用，
      // 因此仅限最高档位使用。
      if (rerun && !isTest) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: RERUN_MINIMUM_TIER,
        });
        if (!hasAccess) {
          logger.warn("没有专业版权限，已阻止重新运行");
          throw new SafeError(RERUN_UPGRADE_MESSAGE);
        }
      }

      logger.info("正在加载用于规则执行的邮箱账号");
      const emailAccount = await getEmailAccountForRuleExecution({
        emailAccountId,
      }).catch((error) => {
        logger.error("加载用于规则执行的邮箱账号失败", {
          error,
        });
        return flushAndRethrowRunRulesActionError({
          logger,
          error,
          isTest,
          stage: "load-email-account",
        });
      });
      logger.info("已加载用于规则执行的邮箱账号", {
        emailAccountFound: Boolean(emailAccount),
      });

      if (!emailAccount) throw new SafeError("未找到邮箱账号");
      if (!provider) throw new SafeError("未找到服务商");

      logger.info("正在创建邮件服务商");
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      }).catch((error) => {
        logger.warn("创建邮件服务商失败", { error });
        return flushAndRethrowRunRulesActionError({
          logger,
          error,
          isTest,
          stage: "create-email-provider",
        });
      });
      logger.info("已创建邮件服务商");

      logger.info("正在获取用于规则执行的邮件");
      const message = await emailProvider
        .getMessage(messageId)
        .catch((error) => {
          logger.warn("获取用于规则执行的邮件失败", { error });
          return flushAndRethrowRunRulesActionError({
            logger,
            error,
            isTest,
            stage: "fetch-message",
          });
        });
      logger.info("已获取用于规则执行的邮件", {
        fetchedThreadId: message.threadId,
      });

      const fetchExecutedRule = !isTest && !rerun;

      logger.info("正在加载现有已执行规则", { fetchExecutedRule });
      const executedRules = await (fetchExecutedRule
        ? prisma.executedRule.findMany({
            where: {
              emailAccountId,
              threadId,
              messageId,
            },
            select: {
              id: true,
              reason: true,
              actionItems: true,
              rule: true,
              createdAt: true,
              status: true,
            },
          })
        : Promise.resolve([])
      ).catch((error) => {
        logger.error("加载现有已执行规则失败", { error });
        return flushAndRethrowRunRulesActionError({
          logger,
          error,
          isTest,
          stage: "load-existing-executed-rules",
        });
      });
      logger.info("已加载现有已执行规则", {
        executedRuleCount: executedRules.length,
      });

      if (executedRules.length > 0) {
        logger.info("跳过。规则已存在。");

        return executedRules.map((executedRule) => ({
          rule: executedRule.rule,
          actionItems: executedRule.actionItems,
          reason: executedRule.reason,
          existing: true,
          createdAt: executedRule.createdAt,
          status: executedRule.status,
        }));
      }

      logger.info("正在加载已启用规则以执行");
      const rules = await prisma.rule
        .findMany({
          where: {
            emailAccountId,
            enabled: true,
          },
          include: {
            actions: true,
          },
        })
        .catch((error) => {
          logger.error("加载已启用规则以执行失败", { error });
          return flushAndRethrowRunRulesActionError({
            logger,
            error,
            isTest,
            stage: "load-enabled-rules",
          });
        });
      logger.info("已加载用于执行的已启用规则", {
        ruleCount: rules.length,
      });

      logger.info("正在调用 runRules");
      const result = await runRules({
        isTest,
        provider: emailProvider,
        message,
        rules,
        emailAccount,
        logger,
        modelType: "chat",
        skipDraftReplies,
      }).catch((error) => {
        logger.error("runRules 失败", { error });
        return flushAndRethrowRunRulesActionError({
          logger,
          error,
          isTest,
          stage: "run-rules",
        });
      });

      logger.info("runRules 已完成", {
        resultCount: result.length,
        matchedCount: result.filter((item) => !!item.rule).length,
        skippedCount: result.filter((item) => !item.rule).length,
      });

      if (isTest) {
        await flushLoggerSafely(logger, {
          action: "runRules",
          flushReason: "test-mode",
        });
      }

      return result;
    },
  );

export const testAiCustomContentAction = actionClient
  .metadata({ name: "testAiCustomContent" })
  .inputSchema(testAiCustomContentBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { content },
    }) => {
      try {
        const emailAccount = await getEmailAccountForRuleExecution({
          emailAccountId,
        });

        if (!emailAccount) throw new SafeError("未找到邮箱账号");

        const emailProvider = await createEmailProvider({
          emailAccountId,
          provider,
          logger,
        });

        const rules = await prisma.rule.findMany({
          where: {
            emailAccountId,
            enabled: true,
            instructions: { not: null },
          },
          include: {
            actions: true,
          },
        });

        const testId = `testMessageId-${Date.now()}`;

        const result = await runRules({
          isTest: true,
          provider: emailProvider,
          logger,
          message: {
            id: testId,
            // 匹配 id，这样 Gmail 的 isReplyInThread（比较 id !== threadId）
            // 会将这条合成的测试邮件视为会话中的第一条消息。
            threadId: testId,
            snippet: content,
            textPlain: content,
            headers: {
              date: new Date().toISOString(),
              from: "",
              to: "",
              subject: "",
            },
            historyId: "",
            inline: [],
            internalDate: new Date().toISOString(),
            subject: "",
            date: new Date().toISOString(),
          },
          rules,
          emailAccount,
          modelType: "chat",
        });

        logger.info("testAiCustomContent 已完成", {
          resultCount: result.length,
          matchedCount: result.filter((item) => !!item.rule).length,
          skippedCount: result.filter((item) => !item.rule).length,
        });

        await flushLoggerSafely(logger, {
          action: "testAiCustomContent",
          flushReason: "test-mode",
        });

        return result;
      } catch (error) {
        logger.warn("testAiCustomContent 失败", { error });
        await flushLoggerSafely(logger, {
          action: "testAiCustomContent",
          flushReason: "test-mode-error",
        });
        throw error;
      }
    },
  );

export const setRuleRunOnThreadsAction = actionClient
  .metadata({ name: "setRuleRunOnThreads" })
  .inputSchema(z.object({ ruleId: z.string(), runOnThreads: z.boolean() }))
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { ruleId, runOnThreads },
    }) => {
      await assertRuleIsNotOrgManaged({ ruleId, emailAccountId });
      await setRuleRunOnThreads({ ruleId, emailAccountId, runOnThreads });
    },
  );

type FlushableLogger = Parameters<typeof flushLoggerSafely>[0];

async function flushAndRethrowRunRulesActionError({
  logger,
  error,
  isTest,
  stage,
}: {
  logger: FlushableLogger;
  error: unknown;
  isTest?: boolean;
  stage: string;
}): Promise<never> {
  if (isTest) {
    await flushLoggerSafely(logger, {
      action: "runRules",
      flushReason: "test-mode-error",
      stage,
    });
  }

  throw error;
}
