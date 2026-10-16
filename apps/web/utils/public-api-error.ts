import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { env } from "@/env";
import { SafeError } from "@/utils/error";

export const PUBLIC_API_DOCS_URL =
  "https://docs.getinboxzero.com/api-reference/introduction";
export const PUBLIC_API_OPENAPI_PATH = "/openapi.json";

export type PublicApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type PublicApiErrorBody = {
  error: {
    code: PublicApiErrorCode;
    message: string;
    hint: string;
  };
};

const DEFAULT_HINTS: Record<PublicApiErrorCode, string> = {
  BAD_REQUEST: `对照 ${PUBLIC_API_OPENAPI_PATH} 或 ${PUBLIC_API_DOCS_URL} 检查请求。`,
  UNAUTHORIZED: `请包含有效的 API-Key 请求头。参见 ${PUBLIC_API_DOCS_URL}。`,
  FORBIDDEN: `请使用具有所需权限范围的账号级 API 密钥。参见 ${PUBLIC_API_DOCS_URL}。`,
  NOT_FOUND: `请对照 ${PUBLIC_API_OPENAPI_PATH} 或 ${PUBLIC_API_DOCS_URL} 确认路径和资源 id。`,
  METHOD_NOT_ALLOWED: `请使用 ${PUBLIC_API_OPENAPI_PATH} 中为该路径声明的方法。`,
  RATE_LIMITED: "请稍候并以退避方式重试。如果限制持续存在，请降低请求速率。",
  INTERNAL_ERROR: `请重试该请求。如果持续失败，参见 ${PUBLIC_API_DOCS_URL}。`,
};

export function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

export function publicApiErrorCodeFromStatus(
  status: number,
): PublicApiErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "BAD_REQUEST";
}

export function createPublicApiErrorBody({
  code,
  message,
  hint,
}: {
  code: PublicApiErrorCode;
  message: string;
  hint?: string;
}): PublicApiErrorBody {
  return {
    error: {
      code,
      message,
      hint: hint ?? DEFAULT_HINTS[code],
    },
  };
}

export function publicApiErrorResponse({
  status,
  code,
  message,
  hint,
  headers,
}: {
  status: number;
  code?: PublicApiErrorCode;
  message: string;
  hint?: string;
  headers?: HeadersInit;
}): NextResponse {
  const resolvedCode = code ?? publicApiErrorCodeFromStatus(status);

  return NextResponse.json(
    createPublicApiErrorBody({ code: resolvedCode, message, hint }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...Object.fromEntries(new Headers(headers)),
      },
    },
  );
}

export async function readPublicApiJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SafeError("请求体必须是有效的 JSON", 400);
  }
}

export function createPublicApiMethodNotAllowedHandler(
  allowedMethods: string[],
) {
  return function methodNotAllowed() {
    if (!env.NEXT_PUBLIC_EXTERNAL_API_ENABLED) {
      return publicApiErrorResponse({
        status: 404,
        code: "NOT_FOUND",
        message: "外部 API 未启用",
      });
    }

    return publicApiErrorResponse({
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "方法不允许",
      hint: `请使用以下受支持的方法之一：${allowedMethods.join(", ")}。`,
      headers: { Allow: allowedMethods.join(", ") },
    });
  };
}

export function publicApiRouteNotFound() {
  return publicApiErrorResponse({
    status: 404,
    code: "NOT_FOUND",
    message: "未找到 API 路由",
  });
}

export function publicApiErrorFromUnknown(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const issuePath = firstIssue?.path?.length
      ? ` (${firstIssue.path.join(".")})`
      : "";
    const issueMessage = firstIssue?.message
      ? `${firstIssue.message}${issuePath}`
      : "请求无效";

    return publicApiErrorResponse({
      status: 400,
      code: "BAD_REQUEST",
      message: issueMessage,
    });
  }

  if (error instanceof SafeError) {
    const status =
      typeof error.statusCode === "number" &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
        ? error.statusCode
        : 400;

    return publicApiErrorResponse({
      status,
      message: error.safeMessage || error.message || "请求失败",
    });
  }

  return publicApiErrorResponse({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "发生了意外错误",
  });
}
