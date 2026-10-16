"use server";

import { after } from "next/server";
import { actionClient } from "@/utils/actions/safe-action";
import prisma from "@/utils/prisma";
import { aiAnalyzePersona } from "@/utils/ai/knowledge/persona";
import { createEmailProvider } from "@/utils/email/provider";
import { getEmailAccountWithAiAndTokens } from "@/utils/user/get";
import { SafeError } from "@/utils/error";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { updateContactRole } from "@inboxzero/loops";
import {
  updateHiddenAiDraftLinksBody,
  updateReferralSignatureBody,
  updateSentWithSignatureBody,
  updateSentMessageOpenTrackingBody,
} from "@/utils/actions/email-account.validation";
import { z } from "zod";

export const updateEmailAccountRoleAction = actionClient
  .metadata({ name: "updateEmailAccountRole" })
  .inputSchema(
    z.object({
      role: z.string(),
      writeOnboardingAnswers: z.boolean().optional().default(true),
    }),
  )
  .action(
    async ({
      ctx: { emailAccountId, userEmail, userId, logger },
      parsedInput: { role, writeOnboardingAnswers },
    }) => {
      await prisma.$transaction([
        prisma.emailAccount.update({
          where: { id: emailAccountId },
          data: { role },
        }),
        prisma.user.update({
          where: { id: userId },
          data: {
            ...(writeOnboardingAnswers
              ? { onboardingAnswers: { answers: { role } } }
              : {}),
            surveyRole: role,
          },
        }),
      ]);

      after(async () => {
        await updateContactRole({
          email: userEmail,
          role,
        }).catch((error) => {
          logger.error("Loops：更新角色时出错", { error });
        });
      });
    },
  );

export const analyzePersonaAction = actionClient
  .metadata({ name: "analyzePersona" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    const existingPersona = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { personaAnalysis: true },
    });

    if (existingPersona?.personaAnalysis) {
      return existingPersona.personaAnalysis;
    }

    const emailAccount = await getEmailAccountWithAiAndTokens({
      emailAccountId,
    });

    if (!emailAccount) {
      throw new SafeError("未找到邮箱账号");
    }

    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });

    const messagesResponse = await emailProvider.getMessagesWithPagination({
      maxResults: 200,
    });

    if (!messagesResponse.messages || messagesResponse.messages.length === 0) {
      throw new SafeError("没有找到可用于用户画像分析的邮件");
    }

    const messages = messagesResponse.messages;

    const emails = messages.map((message) =>
      getEmailForLLM(message, { removeForwarded: true, maxLength: 2000 }),
    );

    const personaAnalysis = await aiAnalyzePersona({ emails, emailAccount });

    if (!personaAnalysis) {
      throw new SafeError("分析用户画像失败");
    }

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { personaAnalysis },
    });

    return personaAnalysis;
  });

export const updateReferralSignatureAction = actionClient
  .metadata({ name: "updateReferralSignature" })
  .inputSchema(updateReferralSignatureBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { enabled } }) => {
      logger.info("正在更新推荐签名", { enabled });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { includeReferralSignature: enabled },
      });
    },
  );

export const updateSentWithSignatureAction = actionClient
  .metadata({ name: "updateSentWithSignature" })
  .inputSchema(updateSentWithSignatureBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { enabled } }) => {
      logger.info("正在更新已发送邮件的签名", { enabled });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { includeSentWithSignature: enabled },
      });
    },
  );

export const updateHiddenAiDraftLinksAction = actionClient
  .metadata({ name: "updateHiddenAiDraftLinks" })
  .inputSchema(updateHiddenAiDraftLinksBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { enabled } }) => {
      logger.info("正在更新隐藏的 AI 草稿链接", { enabled });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { allowHiddenAiDraftLinks: enabled },
      });
    },
  );

export const updateSentMessageOpenTrackingAction = actionClient
  .metadata({ name: "updateSentMessageOpenTracking" })
  .inputSchema(updateSentMessageOpenTrackingBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { enabled } }) => {
      logger.info("正在更新已发送邮件的打开追踪", { enabled });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { sentMessageOpenTrackingEnabled: enabled },
      });
    },
  );

export const fetchSignaturesFromProviderAction = actionClient
  .metadata({ name: "fetchSignaturesFromProvider" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });

    const signatures = await emailProvider.getSignatures();

    return { signatures };
  });
