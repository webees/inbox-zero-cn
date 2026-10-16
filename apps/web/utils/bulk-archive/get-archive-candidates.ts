import type { CategoryWithRules } from "@/utils/category.server";

export type EmailGroup = {
  address: string;
  name: string | null;
  category: CategoryWithRules | null;
};

export type ConfidenceLevel = "high" | "medium" | "low";

export type ArchiveCandidate = {
  address: string;
  category: CategoryWithRules | null;
  confidence: ConfidenceLevel;
  reason: string;
};

/**
 * 根据发件人的分类，将其归入不同的归档置信度级别。
 * - 高置信度：营销、促销、简报、销售
 * - 中置信度：通知、提醒、收据、更新
 * - 低置信度：其余全部
 */
export function getArchiveCandidates(
  emailGroups: EmailGroup[],
): ArchiveCandidate[] {
  return emailGroups.map((group) => {
    const categoryName = group.category?.name?.toLowerCase() || "";

    // 高置信度：营销、促销、简报
    if (
      categoryName.includes("marketing") ||
      categoryName.includes("promotion") ||
      categoryName.includes("newsletter") ||
      categoryName.includes("sale")
    ) {
      return {
        ...group,
        confidence: "high" as ConfidenceLevel,
        reason: "Marketing / Promotional",
      };
    }

    // 中置信度：通知、收据、自动化
    if (
      categoryName.includes("notification") ||
      categoryName.includes("alert") ||
      categoryName.includes("receipt") ||
      categoryName.includes("update")
    ) {
      return {
        ...group,
        confidence: "medium" as ConfidenceLevel,
        reason: "自动通知",
      };
    }

    // 低置信度：其余全部
    return {
      ...group,
      confidence: "low" as ConfidenceLevel,
      reason: "其他分类",
    };
  });
}
