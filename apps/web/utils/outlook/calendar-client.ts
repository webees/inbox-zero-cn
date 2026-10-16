import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import {
  getMicrosoftGraphClientOptions,
  getMicrosoftOauthAuthorizeUrl,
  requestMicrosoftToken,
} from "@/utils/outlook/oauth";
import { CALENDAR_SCOPES } from "@/utils/outlook/scopes";
import { isInvalidGrantError, SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import { saveCalendarTokens } from "@/utils/calendar/save-calendar-tokens";
import {
  Client,
  type AuthenticationProvider,
} from "@microsoft/microsoft-graph-client";

const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

class CalendarAuthProvider implements AuthenticationProvider {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }
}

export function getCalendarOAuth2Url(state: string): string {
  if (!env.MICROSOFT_CLIENT_ID) {
    throw new Error("Microsoft 登录未启用 - 缺少客户端 ID");
  }

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/calendar/callback`,
    scope: CALENDAR_SCOPES.join(" "),
    state,
  });

  return `${getMicrosoftOauthAuthorizeUrl()}?${params.toString()}`;
}

export const getCalendarClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  logger,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  logger: Logger;
}): Promise<Client> => {
  if (!refreshToken) throw new SafeError("No refresh token");

  // 检查令牌是否仍然有效
  if (
    expiresAt &&
    expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS &&
    accessToken
  ) {
    const authProvider = new CalendarAuthProvider(accessToken);
    return Client.initWithMiddleware({
      authProvider,
      ...getMicrosoftGraphClientOptions(accessToken),
    });
  }

  // 令牌已过期或缺失，需要刷新
  try {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
      throw new Error("Microsoft 登录未启用 - 缺少凭据");
    }

    const response = await requestMicrosoftToken({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: CALENDAR_SCOPES.join(" "),
    });

    const tokens = await response.json();

    if (!response.ok) {
      throw new Error(
        [tokens.error, tokens.error_description].filter(Boolean).join(": ") ||
          "刷新令牌失败",
      );
    }

    if (!tokens.expires_in) {
      throw new Error("令牌响应缺少 expires_in 字段");
    }

    // 找到要更新的日历连接
    const calendarConnection = await prisma.calendarConnection.findFirst({
      where: {
        emailAccountId,
        provider: "microsoft",
      },
      select: { id: true },
    });

    if (calendarConnection) {
      await saveCalendarTokens({
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000),
        },
        connectionId: calendarConnection.id,
        expectedExpiresAt: expiresAt,
        logger,
      });
    } else {
      logger.warn("未找到要更新令牌的日历连接", {
        emailAccountId,
      });
    }

    const authProvider = new CalendarAuthProvider(tokens.access_token);
    return Client.initWithMiddleware({
      authProvider,
      ...getMicrosoftGraphClientOptions(tokens.access_token),
    });
  } catch (error) {
    if (isInvalidGrantError(error)) {
      logger.warn("Microsoft 日历授权已过期");
      try {
        // 令牌静态加密，因此在防范并发的刷新或重新连接
        // 之前先比较解密后的值。
        const connections = await prisma.calendarConnection.findMany({
          where: { emailAccountId, provider: "microsoft", isConnected: true },
          select: {
            id: true,
            accessToken: true,
            refreshToken: true,
            updatedAt: true,
          },
        });
        for (const connection of connections) {
          if (
            connection.refreshToken !== refreshToken ||
            connection.accessToken !== (accessToken ?? null)
          )
            continue;

          await prisma.calendarConnection.updateMany({
            where: {
              id: connection.id,
              updatedAt: connection.updatedAt,
              isConnected: true,
            },
            data: { isConnected: false },
          });
        }
      } catch (disconnectError) {
        logger.error("将 Microsoft 日历标记为已断开连接失败", {
          error: disconnectError,
        });
      }
      throw new SafeError(
        "你的 Microsoft 日历授权已过期。请重新连接你的日历。",
      );
    }

    throw error;
  }
};

export async function fetchMicrosoftCalendars(
  calendarClient: Client,
  logger: Logger,
): Promise<
  Array<{
    id?: string;
    name?: string;
    description?: string;
    isDefaultCalendar?: boolean;
  }>
> {
  try {
    const response = await calendarClient
      .api("/me/calendars")
      .select("id,name,color,isDefaultCalendar,canEdit,owner")
      .get();

    return response.value || [];
  } catch (error) {
    logger.error("获取 Microsoft 日历时出错", { error });
    throw new SafeError("获取日历失败");
  }
}
