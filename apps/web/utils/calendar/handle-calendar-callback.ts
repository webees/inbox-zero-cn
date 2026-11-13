import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import type { CalendarOAuthProvider } from "./oauth-types";
import {
  validateOAuthCallback,
  checkExistingConnection,
  createCalendarConnection,
} from "./oauth-callback-helpers";
import {
  RedirectError,
  redirectWithMessage,
  redirectWithError,
} from "@/utils/oauth/redirect";
import { verifyEmailAccountAccess } from "@/utils/oauth/verify";
import {
  acquireOAuthCodeLock,
  getOAuthCodeResult,
  setOAuthCodeResult,
  clearOAuthCode,
} from "@/utils/redis/oauth-code";
import { CALENDAR_STATE_COOKIE_NAME } from "./constants";

/**
 * 日历 OAuth 回调的统一处理器
 */
export async function handleCalendarCallback(
  request: NextRequest,
  provider: CalendarOAuthProvider,
  logger: Logger,
): Promise<NextResponse> {
  let redirectHeaders = new Headers();

  try {
    // 步骤 1：校验 OAuth 回调参数
    const {
      code,
      response,
      calendarState,
      redirectUrl: finalRedirectUrl,
    } = await validateOAuthCallback(request, logger);
    redirectHeaders = response.headers;

    // 步骤 1.5：检查重复的 OAuth code 处理
    const cachedResult = await getOAuthCodeResult(code);
    if (cachedResult) {
      logger.info("OAuth code 已处理过，返回缓存结果");
      const cachedRedirectUrl = new URL(finalRedirectUrl);
      for (const [key, value] of Object.entries(cachedResult.params)) {
        cachedRedirectUrl.searchParams.set(key, value);
      }
      response.cookies.delete(CALENDAR_STATE_COOKIE_NAME);
      return redirectWithMessage(
        cachedRedirectUrl,
        cachedResult.params.message || "calendar_connected",
        redirectHeaders,
      );
    }

    const acquiredLock = await acquireOAuthCodeLock(code);
    if (!acquiredLock) {
      logger.info("OAuth code 正由另一个请求处理中");
      const lockRedirectUrl = new URL(finalRedirectUrl);
      response.cookies.delete(CALENDAR_STATE_COOKIE_NAME);
      return redirectWithMessage(
        lockRedirectUrl,
        "processing",
        redirectHeaders,
      );
    }

    const { emailAccountId } = calendarState;

    // 步骤 4：验证用户拥有此邮箱账号
    await verifyEmailAccountAccess(
      emailAccountId,
      logger,
      finalRedirectUrl,
      response.headers,
    );

    // 步骤 5：用 code 交换令牌并获取邮箱
    const { accessToken, refreshToken, expiresAt, email } =
      await provider.exchangeCodeForTokens(code);

    // 步骤 6：检查连接是否已存在
    const existingConnection = await checkExistingConnection(
      emailAccountId,
      provider.name,
      email,
    );

    if (existingConnection) {
      await prisma.calendarConnection.update({
        where: { id: existingConnection.id },
        data: { accessToken, refreshToken, expiresAt, isConnected: true },
      });
      logger.info("Calendar connection tokens updated", {
        emailAccountId,
        email,
        provider: provider.name,
      });
      // Cache the result for duplicate requests
      await setOAuthCodeResult(code, { message: "calendar_connected" });
      return redirectWithMessage(
        finalRedirectUrl,
        "calendar_connected",
        redirectHeaders,
      );
    }

    // 步骤 7：创建日历连接
    const connection = await createCalendarConnection({
      provider: provider.name,
      email,
      emailAccountId,
      accessToken,
      refreshToken,
      expiresAt,
    });

    // 步骤 8：同步日历
    await provider.syncCalendars(
      connection.id,
      accessToken,
      refreshToken,
      emailAccountId,
      expiresAt,
    );

    logger.info("日历连接成功", {
      emailAccountId,
      email,
      provider: provider.name,
      connectionId: connection.id,
    });

    // 缓存成功结果
    await setOAuthCodeResult(code, { message: "calendar_connected" });

    return redirectWithMessage(
      finalRedirectUrl,
      "calendar_connected",
      redirectHeaders,
    );
  } catch (error) {
    // 出错时清除 OAuth code 锁
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    if (code) {
      await clearOAuthCode(code);
    }
    // 处理重定向错误
    if (error instanceof RedirectError) {
      if (error.redirectUrl.searchParams.get("error")) {
        return NextResponse.redirect(error.redirectUrl, {
          headers: error.responseHeaders,
        });
      }

      return redirectWithError(
        error.redirectUrl,
        "connection_failed",
        error.responseHeaders,
      );
    }

    // 处理所有其他错误
    logger.error("日历回调出错", { error });

    // 尝试构建重定向 URL，回退到 /calendars
    const errorRedirectUrl = new URL("/calendars", env.NEXT_PUBLIC_BASE_URL);
    return redirectWithError(
      errorRedirectUrl,
      "connection_failed",
      redirectHeaders,
    );
  }
}
