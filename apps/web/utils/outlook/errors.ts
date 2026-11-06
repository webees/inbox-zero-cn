// 用于检查 Microsoft Graph API 错误的辅助函数

/**
 * 检查错误是否表示资源已经存在
 * (e.g., filter, category, etc.)
 */
export function isAlreadyExistsError(error: unknown): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  const errorMessage = (error as any)?.message || "";
  return (
    errorMessage.includes("already exists") ||
    errorMessage.includes("duplicate") ||
    errorMessage.includes("conflict")
  );
}

/**
 * 检查 Microsoft Graph API 错误是否表示未找到资源。
 * SDK 的 GraphError 以 `statusCode: number` 作为规范的 HTTP 状态。
 * Microsoft Graph 还会将错误嵌套在 `error` 属性下，代码类似 "itemNotFound"。
 */
export function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object") {
    // 检查顶层 statusCode（GraphError）
    if ("statusCode" in error) {
      return (error as { statusCode: number }).statusCode === 404;
    }
    // 检查嵌套的 error.code（Microsoft Graph API 响应格式）
    if (
      "error" in error &&
      typeof (error as { error: unknown }).error === "object"
    ) {
      const nestedError = (error as { error: { code?: string } }).error;
      return nestedError?.code === "itemNotFound";
    }
  }
  return false;
}

export function isPreconditionFailedError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "statusCode" in error &&
    (error as { statusCode: unknown }).statusCode === 412
  );
}
