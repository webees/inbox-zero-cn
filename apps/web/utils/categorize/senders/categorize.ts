import prisma from "@/utils/prisma";
import { aiCategorizeSenders } from "@/utils/ai/categorize-sender/ai-categorize-senders";
import { defaultCategory, type SenderCategory } from "@/utils/categories";
import { isNewsletterSender } from "@/utils/ai/group/find-newsletters";
import { isReceiptSender } from "@/utils/ai/group/find-receipts";
import { aiCategorizeSender } from "@/utils/ai/categorize-sender/ai-categorize-single-sender";
import type { Category } from "@/generated/prisma/client";
import { getUserCategories } from "@/utils/category.server";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { createScopedLogger } from "@/utils/logger";
import { SafeError } from "@/utils/error";
import type { EmailProvider } from "@/utils/email/types";
import { upsertSenderRecord } from "@/utils/senders/record";

const logger = createScopedLogger("categorize/senders");

export async function categorizeSender(
  senderAddress: string,
  emailAccount: EmailAccountWithAI,
  provider: EmailProvider,
  userCategories?: Pick<Category, "id" | "name" | "description">[],
  senderName?: string | null,
) {
  const categories =
    userCategories ||
    (await getUserCategories({ emailAccountId: emailAccount.id }));
  if (categories.length === 0) return { categoryId: undefined };

  const previousEmails = await provider.getThreadsFromSenderWithSubject(
    senderAddress,
    3,
  );

  const aiResult = await aiCategorizeSender({
    emailAccount,
    sender: senderAddress,
    previousEmails,
    categories,
  });

  const fallbackCategory = categories.find(
    (category) => category.name === defaultCategory.OTHER.name,
  );
  const categoryName = aiResult?.category ?? fallbackCategory?.name;

  if (!categoryName) {
    logger.info("AI 分类在无法使用「其他」分类时选择弃权", {
      userEmail: emailAccount.email,
      senderAddress,
    });

    return { categoryId: undefined };
  }

  const { newsletter } = await updateSenderCategory({
    sender: senderAddress,
    senderName,
    categories,
    categoryName,
    emailAccountId: emailAccount.id,
  });

  if (!aiResult) {
    logger.info("AI categorization abstained; defaulting sender to Other", {
      userEmail: emailAccount.email,
      senderAddress,
    });
  }

  return { categoryId: newsletter.categoryId };
}

export async function updateSenderCategory({
  emailAccountId,
  sender,
  senderName,
  categories,
  categoryName,
}: {
  emailAccountId: string;
  sender: string;
  senderName?: string | null;
  categories: Pick<Category, "id" | "name">[];
  categoryName: string;
}) {
  let category = categories.find((c) => c.name === categoryName);
  let newCategory: Category | undefined;

  if (!category) {
    // 创建分类
    newCategory = await prisma.category.create({
      data: {
        name: categoryName,
        emailAccountId,
        // color: getRandomColor(),
      },
    });
    category = newCategory;
  }

  // 保存分类
  const newsletter = await upsertSenderRecord({
    emailAccountId,
    senderEmail: sender,
    changes: {
      categoryId: category.id,
      ...(senderName && { name: senderName }),
    },
  });

  return {
    newCategory,
    newsletter,
  };
}

export async function updateCategoryForSender({
  emailAccountId,
  sender,
  senderName,
  categoryId,
}: {
  emailAccountId: string;
  sender: string;
  senderName?: string | null;
  categoryId: string;
}) {
  await upsertSenderRecord({
    emailAccountId,
    senderEmail: sender,
    changes: {
      categoryId,
      ...(senderName && { name: senderName }),
    },
  });
}

// 如果可以，尽量在发送给 LLM 之前先用静态规则对发件人分类。
// 仅当用户拥有匹配的分类时才应用规则，以免凭空创建
// 用户已删除或重命名的分类。
function preCategorizeSendersWithStaticRules(
  senders: string[],
  categories: Pick<Category, "name">[],
): { sender: string; category: SenderCategory | undefined }[] {
  const categoryNames = new Set(categories.map((c) => c.name));

  return senders.map((sender) => {
    if (
      categoryNames.has(defaultCategory.NEWSLETTER.name) &&
      isNewsletterSender(sender)
    )
      return { sender, category: defaultCategory.NEWSLETTER.name };

    if (
      categoryNames.has(defaultCategory.RECEIPT.name) &&
      isReceiptSender(sender)
    )
      return { sender, category: defaultCategory.RECEIPT.name };

    return { sender, category: undefined };
  });
}

export async function getCategories({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const categories = await getUserCategories({ emailAccountId });
  if (categories.length === 0) throw new SafeError("未找到分类");
  return { categories };
}

export async function categorizeWithAi({
  emailAccount,
  sendersWithEmails,
  categories,
}: {
  emailAccount: EmailAccountWithAI;
  sendersWithEmails: Map<string, { subject: string; snippet: string }[]>;
  categories: Pick<Category, "name" | "description">[];
}) {
  const categorizedSenders = preCategorizeSendersWithStaticRules(
    Array.from(sendersWithEmails.keys()),
    categories,
  );

  const sendersToCategorizeWithAi = categorizedSenders
    .filter((sender) => !sender.category)
    .map((sender) => sender.sender);

  logger.info("找到可用 AI 分类的发件人", {
    userEmail: emailAccount.email,
    count: sendersToCategorizeWithAi.length,
  });

  const aiResults = await aiCategorizeSenders({
    emailAccount,
    senders: sendersToCategorizeWithAi.map((sender) => ({
      emailAddress: sender,
      emails: sendersWithEmails.get(sender) || [],
    })),
    categories,
  });

  const aiResultsBySender = new Map(
    aiResults.map((result) => [result.sender, result]),
  );

  return categorizedSenders.map((result) => {
    if (result.category) return result;
    return aiResultsBySender.get(result.sender) ?? result;
  });
}
