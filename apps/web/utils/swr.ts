import type { SWRResponse } from "swr";
import useSWR from "swr";
import { EMAIL_ACCOUNT_ID_REQUIRED_ERROR } from "@/utils/config";
import { useAccount } from "@/providers/EmailAccountProvider";

// 确保在请求之前我们已有邮箱账号 id
// 否则后端会返回错误
// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export function useSWRWithEmailAccount<Data = any, Error = any>(url: string) {
  const { emailAccountId } = useAccount();
  return useSWR<Data, Error>(emailAccountId ? url : null);
}

// 按已认证邮箱账号隔离的路由需要将账号纳入缓存键，
// 否则切换账号时会提供另一个账号的数据。
export function getAccountScopedKey(
  path: string,
  emailAccountId?: string | null,
) {
  if (emailAccountId === undefined) return path;

  return emailAccountId ? ([path, emailAccountId] as const) : null;
}

export function shouldResetSwrCacheForAccountId(
  previousEmailAccountId: string | null,
  emailAccountId: string,
) {
  if (!emailAccountId) return false;
  if (previousEmailAccountId === null) return false;
  return previousEmailAccountId !== emailAccountId;
}

// 为空 → id 必须重新校验实时的作用域缓存，包括未被持久化的键
// （例如 /api/user/email-account 首次渲染时的 403）。
export function shouldRevalidateAllLiveSwrKeysForAccountId(
  previousEmailAccountId: string | null,
  emailAccountId: string,
) {
  return previousEmailAccountId === "" && Boolean(emailAccountId);
}

export function getDevSWRErrorRetryMs(
  error: { status?: number; message?: string },
  retryCount: number,
) {
  if (error.status === 404) return 500;
  // pnpm dev 会跳过其他 4xx 重试；生产环境仍会重试，因此缺失的
  // 账号请求头只会卡在模拟器/本地设置页面上。
  if (
    error.status === 403 &&
    error.message === EMAIL_ACCOUNT_ID_REQUIRED_ERROR
  ) {
    return retryCount >= 5 ? null : 500;
  }
  if (error.status && error.status >= 400 && error.status < 500) return null;
  return 5000 * 2 ** retryCount;
}

type NormalizedError = { error: string };

/**
 * 处理 SWR hook 的结果，规范化错误。
 * 假定 API 在失败时可能返回 { error: string } 这样的对象，而不是数据。
 *
 * @param swrResult The raw result from the useSWR hook.
 * @returns SWRResponse with data as TData | null and error as NormalizedError | undefined.
 */
export function processSWRResponse<
  TData,
  TApiError extends { error: string } = { error: string }, // 假定为 API 错误结构
  TSWRError = Error, // 假定为 SWR 错误类型
>(
  swrResult: SWRResponse<TData | TApiError, TSWRError>,
): SWRResponse<TData | null, NormalizedError> {
  const swrError = swrResult.error as TSWRError | undefined; // 为类型检查进行类型断言
  const data = swrResult.data as TData | TApiError | undefined; // 为类型检查进行类型断言

  // 处理 SWR hook 错误
  if (swrError instanceof Error) {
    return {
      ...swrResult,
      data: null,
      error: { error: swrError.message },
    } as SWRResponse<TData | null, NormalizedError>;
  }
  // 处理可能的非 Error 类型 SWR 错误（较少见）
  if (swrError) {
    return {
      ...swrResult,
      data: null,
      error: { error: String(swrError) }, // 将非 Error 转换为字符串
    } as SWRResponse<TData | null, NormalizedError>;
  }

  // 处理在数据中返回的 API 错误
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return {
      ...swrResult,
      data: null,
      error: { error: data.error },
    } as SWRResponse<TData | null, NormalizedError>;
  }

  // 未发现错误，返回数据（加载期间可能为 null/undefined）
  // 将数据转换为预期类型，排除 TApiError 的可能
  return {
    ...swrResult,
    data: data as TData | null, // SWR 在加载期间处理 undefined
    error: undefined,
  } as SWRResponse<TData | null, NormalizedError>;
}
