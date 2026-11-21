export const ASSISTANT_ONBOARDING_COOKIE = "viewed_assistant_onboarding";
export const LAST_EMAIL_ACCOUNT_COOKIE = "last_email_account_id";

export type LastEmailAccountCookieValue = {
  userId: string;
  emailAccountId: string;
};

export function markOnboardingAsCompleted(cookie: string) {
  document.cookie = `${cookie}=true; path=/; max-age=${Number.MAX_SAFE_INTEGER}; SameSite=Lax; Secure`;
}

export function parseLastEmailAccountCookieValue({
  userId,
  cookieValue,
}: {
  userId: string;
  cookieValue: string | undefined;
}): string | null {
  if (!cookieValue) return null;

  // 处理向后兼容：旧 cookie 仅以纯字符串形式存储 emailAccountId
  // 新 cookie 存储包含 { userId, emailAccountId } 的 JSON
  try {
    const parsed = JSON.parse(cookieValue) as LastEmailAccountCookieValue;
    if (parsed.userId !== userId) return null;
    return parsed.emailAccountId;
  } catch {
    return cookieValue;
  }
}

export function ownedLastEmailAccountId(
  lastEmailAccountId: string | null,
  accountIds: readonly string[],
) {
  if (!lastEmailAccountId) return null;
  return accountIds.includes(lastEmailAccountId) ? lastEmailAccountId : null;
}
