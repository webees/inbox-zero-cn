import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { isOnHigherTier } from "@/utils/premium";

/**
 * Prepare premium mutations to execute atomically with the account merge
 */
export async function getPremiumTransferOperations({
  sourceUserId,
  targetUserId,
  logger,
}: {
  sourceUserId: string;
  targetUserId: string;
  logger: Logger;
}) {
  logger.info("Preparing premium transfer during user merge", {
    sourceUserId,
    targetUserId,
  });

  try {
    const sourceUser = await prisma.user.findUnique({
      where: { id: sourceUserId },
      select: {
        id: true,
        email: true,
        premiumId: true,
        premiumAdminId: true,
        premium: { select: { tier: true } },
      },
    });

    if (!sourceUser) {
      logger.warn("未找到源用户", { sourceUserId });
      return [];
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        premiumId: true,
        premiumAdminId: true,
        premium: { select: { tier: true } },
      },
    });

    if (!targetUser) {
      logger.error("未找到目标用户", { targetUserId });
      throw new Error(`未找到目标用户 ${targetUserId}`);
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    let resultingPremiumId = targetUser.premiumId;

    // 处理高级版订阅的各种情况
    if (sourceUser.premiumId && targetUser.premiumId) {
      // 两个用户都有高级版——选择更高的套餐层级
      const sourceTier = sourceUser.premium?.tier;
      const targetTier = targetUser.premium?.tier;

      logger.warn("两个用户都有高级版订阅——选择更高的套餐层级", {
        sourcePremiumId: sourceUser.premiumId,
        targetPremiumId: targetUser.premiumId,
        sourceTier,
        targetTier,
        sourceUserId,
        targetUserId,
      });

      // 如果高级版相同或源用户层级更高，则使用源用户的高级版
      // 如果目标用户层级更高，则保留目标用户的高级版
      const shouldUseSourcePremium =
        sourceUser.premiumId === targetUser.premiumId ||
        !isOnHigherTier(targetTier, sourceTier);

      if (
        shouldUseSourcePremium &&
        sourceUser.premiumId !== targetUser.premiumId
      ) {
        resultingPremiumId = sourceUser.premiumId;
        logger.info(
          "Target user's premium subscription replaced with source user's higher tier premium",
          { chosenTier: sourceTier },
        );
      } else {
        logger.info(
          "Target user keeps their premium subscription (higher or equal tier)",
          { chosenTier: targetTier },
        );
      }
    } else if (sourceUser.premiumId) {
      // Only source user has premium - transfer to target
      logger.info("Transferring premium subscription from source to target", {
        premiumId: sourceUser.premiumId,
        sourceUserId,
        targetUserId,
      });
      resultingPremiumId = sourceUser.premiumId;
    } else if (targetUser.premiumId) {
      // Only target user has premium - no action needed, they keep their premium
      logger.info("Target user already has premium, no transfer needed", {
        targetPremiumId: targetUser.premiumId,
        targetUserId,
      });
    } else {
      // Neither user has premium
      logger.info("Neither user has premium subscription", {
        sourceUserId,
        targetUserId,
      });
    }

    // A user administers at most one premium. Prefer admin rights over the
    // premium the merged user ends up on, so they can still manage billing.
    const resultingPremiumAdminId =
      [targetUser.premiumAdminId, sourceUser.premiumAdminId].find(
        (premiumAdminId) =>
          premiumAdminId && premiumAdminId === resultingPremiumId,
      ) ??
      targetUser.premiumAdminId ??
      sourceUser.premiumAdminId;

    if (
      sourceUser.premiumAdminId &&
      sourceUser.premiumAdminId !== resultingPremiumAdminId
    ) {
      logger.warn("Source user's premium admin rights not transferred", {
        sourcePremiumAdminId: sourceUser.premiumAdminId,
        resultingPremiumAdminId,
      });
    }

    if (
      resultingPremiumId !== targetUser.premiumId ||
      resultingPremiumAdminId !== targetUser.premiumAdminId
    ) {
      operations.push(
        prisma.user.update({
          where: { id: targetUserId },
          data: {
            premiumId: resultingPremiumId,
            premiumAdminId: resultingPremiumAdminId,
          },
        }),
      );
    }

    return operations;
  } catch (error) {
    logger.error("Failed to prepare premium transfer during user merge", {
      sourceUserId,
      targetUserId,
      error,
    });
    // Keep the existing best-effort behavior for unavailable premium metadata.
    return [];
  }
}
