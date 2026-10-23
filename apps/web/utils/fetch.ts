import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";

/**
 * 对原生 fetch 函数的封装，在提供 emailAccountId 时
 * 自动加上 EMAIL_ACCOUNT_HEADER。
 */
export const fetchWithAccount = async ({
  url,
  emailAccountId,
  init,
}: {
  url: string | URL | Request;
  emailAccountId: string | null;
  init?: RequestInit;
}): Promise<Response> => {
  const headers = new Headers(init?.headers);

  if (emailAccountId) {
    headers.set(EMAIL_ACCOUNT_HEADER, emailAccountId);
  }

  const newInit = { ...init, headers };

  return fetch(url, newInit);
};
