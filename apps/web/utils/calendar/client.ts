import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import { CALENDAR_SCOPES as GOOGLE_CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import { isInvalidGrantError, SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import {
  getGoogleApiRootUrl,
  getGoogleOauthClientOptions,
} from "@/utils/gmail/oauth";
import { saveCalendarTokens } from "@/utils/calendar/save-calendar-tokens";

type AuthOptions = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
};

const getAuth = ({ accessToken, refreshToken, expiresAt }: AuthOptions) => {
  const googleAuth = new auth.OAuth2(getGoogleOauthClientOptions());
  googleAuth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiresAt,
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
  });

  return googleAuth;
};

export function getCalendarOAuth2Client() {
  return new auth.OAuth2(
    getGoogleOauthClientOptions(
      `${env.NEXT_PUBLIC_BASE_URL}/api/google/calendar/callback`,
    ),
  );
}

export const getCalendarClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  connectionId,
  logger,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  connectionId?: string | null;
  logger: Logger;
}): Promise<calendar_v3.Calendar> => {
  if (!refreshToken) {
    logger.error("No refresh token", { emailAccountId });
    throw new SafeError("No refresh token");
  }

  // 检查令牌是否仍然有效
  if (expiresAt && expiresAt > Date.now()) {
    const auth = getAuth({ accessToken, refreshToken, expiresAt });
    return calendar({ version: "v3", auth, rootUrl: getGoogleApiRootUrl() });
  }

  // 令牌已过期或缺失，需要刷新
  const auth = getAuth({ accessToken, refreshToken });
  const cal = calendar({ version: "v3", auth, rootUrl: getGoogleApiRootUrl() });

  // 可能抛出 `invalid_grant` 错误
  try {
    const tokens = await auth.refreshAccessToken();
    const newAccessToken = tokens.credentials.access_token;
    const newExpiresAt = tokens.credentials.expiry_date ?? undefined;
    const newRefreshToken = tokens.credentials.refresh_token ?? undefined;

    let calendarConnectionId = connectionId ?? null;
    if (!calendarConnectionId) {
      const calendarConnection = await prisma.calendarConnection.findFirst({
        where: {
          emailAccountId,
          provider: "google",
          refreshToken,
        },
        select: { id: true },
      });
      calendarConnectionId = calendarConnection?.id ?? null;
    }

    if (calendarConnectionId) {
      await saveCalendarTokens({
        tokens: {
          accessToken: newAccessToken ?? undefined,
          refreshToken: newRefreshToken,
          expiresAt: newExpiresAt ? new Date(newExpiresAt) : null,
        },
        connectionId: calendarConnectionId,
        expectedExpiresAt: expiresAt,
        logger,
      });
    } else {
      logger.warn("未找到可更新令牌的日历连接", {
        emailAccountId,
      });
    }

    return cal;
  } catch (error) {
    if (isInvalidGrantError(error)) {
      logger.warn("刷新日历访问令牌出错", {
        emailAccountId,
        error: error instanceof Error ? error.message : String(error),
        errorDescription: (
          error as Error & {
            response?: { data?: { error_description?: string } };
          }
        ).response?.data?.error_description,
      });
    }

    throw error;
  }
};

export async function fetchGoogleCalendars(
  calendarClient: calendar_v3.Calendar,
  logger: Logger,
) {
  try {
    const response = await calendarClient.calendarList.list();
    return response.data.items || [];
  } catch (error) {
    logger.error("获取 Google 日历出错", { error });
    throw new SafeError("获取日历失败");
  }
}
