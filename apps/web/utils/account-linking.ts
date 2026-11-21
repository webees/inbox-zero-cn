import type { GetAuthLinkUrlResponse } from "@/app/api/google/linking/auth-url/route";
import type { GetOutlookAuthLinkUrlResponse } from "@/app/api/outlook/linking/auth-url/route";
import { isGoogleProvider } from "@/utils/email/provider-types";

/**
 * 启动 Google 或 Microsoft 的 OAuth 账号关联流程。
 * 返回用于重定向用户的 URL（OAuth 服务商，或会话失效时的 /logout）。
 *
 * 刷新已有邮箱时传入 `reconnectEmailAccountId`，这样会向
 * 服务商请求该身份，并在回调中拒绝其他身份。
 * 添加新账号时省略该参数。
 * @throws 当请求因不可恢复的原因失败时抛出 Error。该
 * 信息可以安全地展示给用户。
 */
export async function getAccountLinkingUrl(
  provider: "google" | "microsoft",
  options?: { reconnectEmailAccountId?: string },
): Promise<string> {
  const apiProvider = provider === "microsoft" ? "outlook" : "google";
  const query = options?.reconnectEmailAccountId
    ? `?emailAccountId=${encodeURIComponent(options.reconnectEmailAccountId)}`
    : "";

  const response = await fetch(`/api/${apiProvider}/linking/auth-url${query}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string;
      isKnownError?: boolean;
      redirectTo?: string;
    } | null;

    if (response.status === 401 && errorBody?.redirectTo) {
      return errorBody.redirectTo;
    }

    if (errorBody?.isKnownError && errorBody.error) {
      throw new Error(errorBody.error);
    }

    throw new Error(
      `无法发起 ${isGoogleProvider(provider) ? "Google" : "Microsoft"} 账号关联`,
    );
  }

  const data: GetAuthLinkUrlResponse | GetOutlookAuthLinkUrlResponse =
    await response.json();

  return data.url;
}
