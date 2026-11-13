import type { NextResponse } from "next/server";

export interface CalendarTokens {
  accessToken: string;
  email: string;
  expiresAt: Date | null;
  refreshToken: string;
}

export interface CalendarOAuthProvider {
  /**
   * 用 OAuth code 交换令牌并获取用户邮箱
   */
  exchangeCodeForTokens(code: string): Promise<CalendarTokens>;
  name: "google" | "microsoft";

  /**
   * 同步该服务商的日历
   */
  syncCalendars(
    connectionId: string,
    accessToken: string,
    refreshToken: string,
    emailAccountId: string,
    expiresAt: Date | null,
  ): Promise<void>;
}

export interface OAuthCallbackValidation {
  calendarState: CalendarOAuthState;
  code: string;
  redirectUrl: URL;
  response: NextResponse;
}

export interface CalendarOAuthState {
  emailAccountId: string;
  nonce: string;
  type: "calendar";
}
