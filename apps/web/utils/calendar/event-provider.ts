import { SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import type { CalendarEventProvider } from "@/utils/calendar/event-types";
import { GoogleCalendarEventProvider } from "@/utils/calendar/providers/google-events";
import { MicrosoftCalendarEventProvider } from "@/utils/calendar/providers/microsoft-events";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";

/**
 * 为所有已连接日历创建日历事件服务商。
 * 只获取一次日历连接，并创建可复用的服务商。
 */
export async function createCalendarEventProviders(
  emailAccountId: string,
  logger: Logger,
): Promise<CalendarEventProvider[]> {
  const connections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
    },
    select: {
      id: true,
      provider: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });

  if (connections.length === 0) {
    logger.info("未找到日历连接", { emailAccountId });
    return [];
  }

  const providers: CalendarEventProvider[] = [];

  for (const connection of connections) {
    if (!isUsableCalendarConnection(connection)) continue;

    try {
      providers.push(
        createCalendarEventProvider({ connection, emailAccountId, logger }),
      );
    } catch (error) {
      logger.error("创建日历事件提供程序失败", {
        provider: connection.provider,
        error,
      });
    }
  }

  return providers;
}

// createCalendarEventProviders 可使用的相同连接。缺少刷新
// 令牌或服务商未知时不会构建服务商，因此聊天工具会失败。
export async function hasUsableCalendarConnection(emailAccountId: string) {
  const connections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
    },
    select: {
      provider: true,
      refreshToken: true,
    },
  });

  return connections.some(isUsableCalendarConnection);
}

export function createCalendarEventProvider({
  connection,
  emailAccountId,
  logger,
}: {
  connection: {
    accessToken: string | null;
    expiresAt: Date | null;
    id: string;
    provider: string;
    refreshToken: string | null;
  };
  emailAccountId: string;
  logger: Logger;
}) {
  const providerParams = {
    accessToken: connection.accessToken,
    connectionId: connection.id,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt?.getTime() ?? null,
    emailAccountId,
  };

  if (isGoogleProvider(connection.provider)) {
    return new GoogleCalendarEventProvider(providerParams, logger);
  }

  if (isMicrosoftProvider(connection.provider)) {
    return new MicrosoftCalendarEventProvider(providerParams, logger);
  }

  throw new SafeError("不支持的日历服务商");
}

function isUsableCalendarConnection(connection: {
  provider: string;
  refreshToken: string | null;
}) {
  if (!connection.refreshToken) return false;

  return (
    isGoogleProvider(connection.provider) ||
    isMicrosoftProvider(connection.provider)
  );
}
