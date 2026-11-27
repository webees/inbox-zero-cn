import { isOutlookItemNotFoundError } from "@/utils/error";

/**
 * 服务商是否因为会话已不存在而拒绝了操作，以便
 * 调用方能够区分“已处理过”与真正的失败。
 */
export function isThreadNotFoundError(error: unknown): boolean {
  if (isOutlookItemNotFoundError(error)) return true;

  return (
    error instanceof Error &&
    error.message.includes("Requested entity was not found")
  );
}
