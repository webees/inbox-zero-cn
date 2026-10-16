import type { NextResponse } from "next/server";
import type { Logger } from "@/utils/logger";
import { createAccountLinkingRedirect } from "@/utils/oauth/account-linking-redirect";
import {
  classifyMicrosoftOAuthError,
  getSafeMicrosoftOAuthErrorDescription,
} from "@/utils/oauth/microsoft-oauth";

interface ErrorHandlerParams {
  error: unknown;
  logger: Logger;
  provider?: "google" | "microsoft";
  stateCookieName: string;
}

export function handleOAuthCallbackError({
  error,
  stateCookieName,
  logger,
  provider,
}: ErrorHandlerParams): NextResponse {
  logger.error("OAuth 关联回调出错：", { error });
  const errorMessage = error instanceof Error ? error.message : "未知错误";

  if (provider === "microsoft") {
    const mappedError = classifyMicrosoftOAuthError(errorMessage);

    if (mappedError) {
      logger.warn("已映射 Microsoft OAuth 关联错误", {
        mappedError: mappedError.errorCode,
        aadstsCode: mappedError.aadstsCode,
      });
      return createAccountLinkingRedirect({
        query: {
          error: mappedError.errorCode,
          error_description: mappedError.userMessage,
        },
        stateCookieName,
      });
    }

    const safeErrorDescription =
      getSafeMicrosoftOAuthErrorDescription(errorMessage);
    return createAccountLinkingRedirect({
      query: {
        error: "link_failed",
        error_description: safeErrorDescription,
      },
      stateCookieName,
    });
  }

  return createAccountLinkingRedirect({
    query: {
      error: "link_failed",
      error_description: errorMessage,
    },
    stateCookieName,
  });
}
