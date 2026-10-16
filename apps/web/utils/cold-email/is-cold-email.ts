import { z } from "zod";
import { env } from "@/env";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { Group, GroupItem, Rule } from "@/generated/prisma/client";
import { GroupItemType } from "@/generated/prisma/enums";
import prisma from "@/utils/prisma";
import { DEFAULT_COLD_EMAIL_PROMPT } from "@/utils/cold-email/prompt";
import { stringifyEmail } from "@/utils/stringify-email";
import type { Logger } from "@/utils/logger";
import type { EmailForLLM } from "@/utils/types";
import type { EmailProvider } from "@/utils/email/types";
import { getModel, type ModelType } from "@/utils/llms/model";
import { createGenerateObject } from "@/utils/llms";
import { extractEmailAddress, isSameOrganization } from "@/utils/email";
import { isWhitelistedSender } from "@/utils/email/whitelist";
import { hasPriorContactOrAssumeYes } from "@/utils/cold-email/has-prior-contact";
import { decideColdEmail } from "@/utils/decision-model/cold-email";
import { runDecisionModelOrFallback } from "@/utils/decision-model/decision-model";

export const COLD_EMAIL_FOLDER_NAME = "Cold Emails";

type ColdEmailBlockerReason =
  | "hasPreviousEmail"
  | "applicationSender"
  | "ai"
  | "ai-already-labeled"
  | "excluded";

export type ColdEmailPatternMatch = {
  group: Pick<Group, "id" | "name">;
  groupItem: Pick<GroupItem, "id" | "type" | "value" | "exclude">;
};

type ColdEmailResult = {
  isColdEmail: boolean;
  reason: ColdEmailBlockerReason;
  aiReason?: string | null;
  patternMatch?: ColdEmailPatternMatch;
};

type ColdEmailGuardsInput = {
  email: EmailForLLM & { threadId?: string };
  emailAccount: EmailAccountWithAI;
  provider: EmailProvider;
  coldEmailRule: Pick<Rule, "instructions" | "groupId"> | null;
  logger: Logger;
};

/**
 * 运行确定性的冷邮件检查（白名单、同一组织、已学习
 * 的模式、先前联系）。当只剩 AI 检查时返回 null，以便
 * 调用方自行执行该检查。
 */
export async function checkColdEmailGuards({
  email,
  emailAccount,
  provider,
  coldEmailRule,
  logger,
}: ColdEmailGuardsInput): Promise<ColdEmailResult | null> {
  logger.info("正在检查是否为冷邮件");

  if (
    isWhitelistedSender(email.from, env.RESEND_FROM_EMAIL) ||
    isWhitelistedSender(email.from, env.WHITELIST_FROM)
  ) {
    logger.info("发件人是应用发件人");
    return { isColdEmail: false, reason: "applicationSender" };
  }

  // 你自己公司的任何人都不是冷邮件发送者。此处进行检查，而不只是在
  // 操作处检查，这样同事就不会被标记或归档。
  if (isSameOrganization(email.from, emailAccount.email)) {
    logger.info("发件人为内部人员");
    return { isColdEmail: false, reason: "hasPreviousEmail" };
  }

  // 检查我们是否已将其标记为冷邮件
  const groupId = coldEmailRule?.groupId;
  let patternMatch:
    | (Pick<GroupItem, "id" | "type" | "value" | "exclude"> & {
        group: Pick<Group, "id" | "name"> | null;
      })
    | null = null;

  if (groupId) {
    const normalizedFrom = extractEmailAddress(email.from) || email.from;
    patternMatch = await prisma.groupItem.findFirst({
      where: {
        groupId,
        type: GroupItemType.FROM,
        value: normalizedFrom,
      },
      select: {
        id: true,
        type: true,
        value: true,
        exclude: true,
        group: { select: { id: true, name: true } },
      },
    });
  }

  if (patternMatch && !patternMatch.exclude) {
    logger.info("已知的冷邮件发件人", { from: email.from });
    const { group, ...groupItem } = patternMatch;
    return {
      isColdEmail: true,
      reason: "ai-already-labeled",
      ...(group ? { patternMatch: { group, groupItem } } : {}),
    };
  }

  if (patternMatch?.exclude) {
    logger.info("发件人已被显式排除在冷邮件拦截之外", {
      from: email.from,
    });
    return { isColdEmail: false, reason: "excluded" };
  }

  const hasPreviousEmail = await hasPriorContactOrAssumeYes({
    provider,
    from: extractEmailAddress(email.from) || email.from,
    date: email.date,
    messageId: email.id,
    logger,
  });

  if (hasPreviousEmail) {
    logger.info("存在先前邮件");
    return { isColdEmail: false, reason: "hasPreviousEmail" };
  }

  return null;
}

export async function isColdEmail({
  email,
  emailAccount,
  provider,
  modelType,
  coldEmailRule,
  logger,
}: ColdEmailGuardsInput & {
  modelType?: ModelType;
}): Promise<ColdEmailResult> {
  const guardResult = await checkColdEmailGuards({
    email,
    emailAccount,
    provider,
    coldEmailRule,
    logger,
  });

  if (guardResult) return guardResult;

  return checkColdEmailWithAi({
    email,
    emailAccount,
    coldEmailRule,
    modelType,
    logger,
  });
}

/** `isColdEmail` 的 AI 步骤，供已运行过各项守卫的调用方使用。 */
export async function checkColdEmailWithAi({
  email,
  emailAccount,
  coldEmailRule,
  modelType,
  logger,
}: Omit<ColdEmailGuardsInput, "provider"> & {
  modelType?: ModelType;
}): Promise<ColdEmailResult> {
  return runDecisionModelOrFallback({
    emailAccount,
    logger,
    feature: "cold-email classification",
    decide: async (config) => {
      const result = await decideColdEmail({
        config,
        email,
        emailAccount,
        coldEmailRule,
        logger,
      });
      logger.info("决策模型已检查冷邮件", {
        coldEmail: result.coldEmail,
      });
      return {
        isColdEmail: result.coldEmail,
        reason: "ai" as const,
        aiReason: result.reason,
      };
    },
    fallback: () =>
      checkColdEmailWithLlm({
        email,
        emailAccount,
        coldEmailRule,
        modelType,
        logger,
      }),
  });
}

export async function checkColdEmailWithLlm({
  email,
  emailAccount,
  coldEmailRule,
  modelType,
  logger,
}: Omit<ColdEmailGuardsInput, "provider"> & {
  modelType?: ModelType;
}): Promise<ColdEmailResult> {
  const res = await aiIsColdEmail(
    email,
    emailAccount,
    coldEmailRule?.instructions || DEFAULT_COLD_EMAIL_PROMPT,
    modelType,
  );

  logger.info("AI 判断是否为冷邮件？", {
    coldEmail: res.coldEmail,
  });

  return {
    isColdEmail: !!res.coldEmail,
    reason: "ai",
    aiReason: res.reason,
  };
}

async function aiIsColdEmail(
  email: EmailForLLM,
  emailAccount: EmailAccountWithAI,
  coldEmailPrompt: string,
  modelType?: ModelType,
) {
  const system = `Decide whether the email is cold outreach. Give a concise reason.

<instructions>
${coldEmailPrompt || DEFAULT_COLD_EMAIL_PROMPT}
</instructions>`;

  const prompt = `<email>
${stringifyEmail(email, 500)}
</email>`;

  const modelOptions = getModel(emailAccount.user, modelType);

  const generateObject = createGenerateObject({
    emailAccount,
    label: "冷邮件检查",
    modelOptions,
    promptHardening: { trust: "untrusted", level: "compact" },
  });

  const response = await generateObject({
    ...modelOptions,
    instructions: system,
    prompt,
    schema: z.object({
      coldEmail: z.boolean(),
      reason: z.string(),
    }),
  });

  return response.object;
}
