import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";

/**
 * 为邮件打标签，并在检测到并修复了过期的标签 ID 时自动更新数据库。
 *
 * 这处理了标签/分类被删除并以新 ID 重新创建的情况：
 * - 尝试使用提供的 ID 打标签
 * - 如果失败且提供了 labelName，则回退为按名称查找
 * - 如果实际使用的 ID 与存储的 ID 不同，则更新所有带有该过期 ID 的 Action
 */
export async function labelMessageAndSync({
  provider,
  messageId,
  labelId,
  labelName,
  emailAccountId,
  logger: log,
}: {
  provider: EmailProvider;
  messageId: string;
  labelId: string;
  labelName: string | null;
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  const logger = log.with({ labelId, labelName });

  const result = await provider.labelMessage({
    messageId,
    labelId,
    labelName,
  });

  // 如果不得不使用回退且得到的 ID 不同，则更新所有带有该过期 ID 的 Action
  if (
    result.usedFallback &&
    result.actualLabelId &&
    result.actualLabelId !== labelId
  ) {
    logger.info("检测到过期的标签 ID，正在更新数据库中的所有实例", {
      oldLabelId: labelId,
      newLabelId: result.actualLabelId,
    });

    try {
      const updateResult = await prisma.action.updateMany({
        where: {
          labelId,
          rule: { emailAccountId },
        },
        data: { labelId: result.actualLabelId },
      });

      logger.info("已更新所有操作中的过期标签 ID", {
        newLabelId: result.actualLabelId,
        updatedCount: updateResult.count,
      });
    } catch (error) {
      // 如果数据库更新失败，不要让整个操作失败
      logger.error("更新过期标签 ID 失败", {
        newLabelId: result.actualLabelId,
        error,
      });
    }
  }
}
