import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { extractUniqueEmailAddresses } from "@/utils/email";
import type { EmailProvider } from "@/utils/email/types";

const UNCATEGORIZED_CATEGORY_NAME = "Uncategorized";
const MAX_SENDERS_IN_OUTPUT = 100;

export async function archiveCategory({
  email,
  emailAccountId,
  emailProvider,
  logger,
  categoryId,
  categoryName,
}: {
  email: string;
  emailAccountId: string;
  emailProvider: EmailProvider;
  logger: Logger;
  categoryId?: string | null;
  categoryName?: string | null;
}) {
  const resolvedCategory = await resolveCategory({
    emailAccountId,
    categoryId,
    categoryName,
  });

  if (!resolvedCategory.success) {
    return resolvedCategory;
  }

  const senderEmails = await prisma.newsletter.findMany({
    where: {
      emailAccountId,
      categoryId: resolvedCategory.category.id,
    },
    select: {
      email: true,
    },
  });

  const normalizedSenderEmails = extractUniqueEmailAddresses(
    senderEmails.map((sender) => sender.email),
    { lowercase: true },
  );

  if (!normalizedSenderEmails.length) {
    logger.info("分类归档没有发件人", {
      categoryName: resolvedCategory.category.name,
    });

    return {
      success: true,
      action: "archive_category" as const,
      category: resolvedCategory.category,
      sendersCount: 0,
      senders: [],
      message: `当前没有发件人分配到“${resolvedCategory.category.name}”。`,
    };
  }

  await emailProvider.bulkArchiveFromSenders(
    normalizedSenderEmails,
    email,
    emailAccountId,
  );

  logger.info("已归档发件人分类", {
    categoryName: resolvedCategory.category.name,
    sendersCount: normalizedSenderEmails.length,
  });

  return {
    success: true,
    action: "archive_category" as const,
    category: resolvedCategory.category,
    sendersCount: normalizedSenderEmails.length,
    senders: normalizedSenderEmails.slice(0, MAX_SENDERS_IN_OUTPUT),
    message: `已归档“${resolvedCategory.category.name}”分类中 ${normalizedSenderEmails.length} 个发件人的邮件。`,
  };
}

async function resolveCategory({
  emailAccountId,
  categoryId,
  categoryName,
}: {
  emailAccountId: string;
  categoryId?: string | null;
  categoryName?: string | null;
}) {
  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        emailAccountId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!category) {
      return {
        success: false as const,
        action: "archive_category" as const,
        message: "该账号中未找到所请求的分类。",
      };
    }

    return {
      success: true as const,
      category,
    };
  }

  if (!categoryName) {
    return {
      success: false as const,
      action: "archive_category" as const,
      message: "categoryId 或 categoryName 为必填项。",
    };
  }

  if (
    categoryName.trim().toLowerCase() ===
    UNCATEGORIZED_CATEGORY_NAME.toLowerCase()
  ) {
    return {
      success: true as const,
      category: {
        id: null,
        name: UNCATEGORIZED_CATEGORY_NAME,
      },
    };
  }

  const category = await prisma.category.findFirst({
    where: {
      emailAccountId,
      name: {
        equals: categoryName.trim(),
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (category) {
    return {
      success: true as const,
      category,
    };
  }

  const availableCategories = await prisma.category.findMany({
    where: { emailAccountId },
    orderBy: { name: "asc" },
    select: { name: true },
  });

  return {
    success: false as const,
    action: "archive_category" as const,
    message: buildCategoryNotFoundMessage({
      categoryName,
      availableCategories: availableCategories.map(
        (available) => available.name,
      ),
    }),
  };
}

function buildCategoryNotFoundMessage({
  categoryName,
  availableCategories,
}: {
  categoryName: string;
  availableCategories: string[];
}) {
  const categoryList = [...availableCategories, UNCATEGORIZED_CATEGORY_NAME];

  return `Category "${categoryName}" was not found. Available categories: ${categoryList.join(", ")}.`;
}
