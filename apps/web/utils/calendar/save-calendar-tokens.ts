import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";

export async function saveCalendarTokens({
  tokens,
  connectionId,
  expectedExpiresAt,
  logger,
}: {
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date | null;
  };
  connectionId: string;
  expectedExpiresAt: number | null;
  logger: Logger;
}) {
  if (!tokens.accessToken) {
    logger.warn("没有可保存的日历连接访问令牌", {
      connectionId,
    });
    return;
  }

  try {
    const result = await prisma.calendarConnection.updateMany({
      where: {
        id: connectionId,
        expiresAt: getExpectedExpiresAtWhere(expectedExpiresAt),
      },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt ?? null,
      },
    });

    if (result.count === 0) {
      logger.info("已跳过过期的日历令牌更新", { connectionId });
      return { status: "conflict" as const };
    }

    logger.info("日历令牌保存成功", { connectionId });
    return { status: "saved" as const };
  } catch (error) {
    logger.error("保存日历令牌失败", { error, connectionId });
    throw error;
  }
}

function getExpectedExpiresAtWhere(expectedExpiresAt: number | null) {
  if (!expectedExpiresAt) return null;

  return {
    gte: new Date(expectedExpiresAt),
    lt: new Date(expectedExpiresAt + 1),
  };
}
