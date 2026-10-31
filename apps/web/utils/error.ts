import {
  captureException as sentryCaptureException,
  setUser,
} from "@sentry/nextjs";
import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import type { FlattenedValidationErrors } from "next-safe-action";
import {
  type EmailProviderRateLimitProvider,
  getProviderRateLimitApiErrorType,
  getProviderRateLimitMessageLabel,
  isProviderRateLimitModeError,
} from "@/utils/email/rate-limit-mode-error";
import { extractErrorInfo } from "@/utils/gmail/retry";
import { createScopedLogger, type Logger } from "@/utils/logger";

// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export type ErrorMessage = { error: string; data?: any };
export type ZodError = {
  error: { issues: { code: string; message: string }[] };
};
export type ApiErrorType = {
  type: string;
  message?: string;
  code: number;
};

const RATE_LIMIT_MESSAGE_TEMPLATE = "{provider} 暂时限制了请求。请稍后重试。";
export const EMAIL_PROVIDER_RATE_LIMIT_MESSAGE =
  "你的邮箱服务商暂时限制了请求。请稍后重试。";
export const UNEXPECTED_ACTION_ERROR_MESSAGE = "发生未知错误。";

export function getEmailProviderRateLimitMessage(
  provider: EmailProviderRateLimitProvider,
) {
  return RATE_LIMIT_MESSAGE_TEMPLATE.replace(
    "{provider}",
    getProviderRateLimitMessageLabel(provider),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export function isError(value: any): value is ErrorMessage | ZodError {
  return value?.error;
}

export function isGmailError(
  error: unknown,
): error is { code: number; errors: { message: string }[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
    Array.isArray((error as any).errors) &&
    // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
    (error as any).errors.length > 0
  );
}

export type CaptureExceptionContext = {
  // emailAccountId 会通过以下方式自动设置：
  // - 前端：SentryIdentify 组件
  // - API 路由：emailAccountMiddleware
  // - Server actions：actionClient
  // 仅在这些上下文之外（例如定时任务）才需要显式传入。
  emailAccountId?: string | null;
  userId?: string | null;
  userEmail?: string;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  extra?: Record<string, any>;
  tags?: Record<string, string>;
  sampleRate?: number;
};

export type LlmRepairMetadata = {
  attempted: true;
  successful: boolean;
  label: string;
  provider: string;
  model: string;
  inputLength: number;
  inputFingerprint: string;
  startsWithQuote: boolean;
  startsWithBrace: boolean;
  startsWithBracket: boolean;
  looksCodeFenced: boolean;
  candidateKindsTried: string[];
  successfulCandidateKind?: string;
};

const LLM_REPAIR_METADATA_KEY = "__llmRepairMetadata";

export function attachLlmRepairMetadata(
  error: unknown,
  metadata: LlmRepairMetadata | undefined,
) {
  if (!metadata || typeof error !== "object" || error === null) return;

  const target = error as Record<string, unknown>;

  // 诊断元数据绝不能让原始模型错误变成
  // webhook 处理失败，尤其是对于冻结或不可变错误。
  if (!Object.isExtensible(target)) return;

  try {
    target[LLM_REPAIR_METADATA_KEY] = metadata;
  } catch {
    return;
  }
}

export function captureException(
  error: unknown,
  context: CaptureExceptionContext = {},
) {
  if (isKnownApiError(error) || isHandledUserKeyError(error)) {
    const logger = createScopedLogger("captureException");
    logger.warn("已知的 API 错误", { error, context });
    return;
  }

  const { sampleRate, userEmail, emailAccountId, userId, extra } = context;
  if (
    Number.isFinite(sampleRate) &&
    process.env.NODE_ENV === "production" &&
    Math.random() >= (sampleRate as number)
  ) {
    return;
  }

  if (userEmail) setUser({ email: userEmail });

  const llmRepair = getLlmRepairMetadata(error);
  const sentryExtra = {
    ...extra,
    ...(llmRepair ? { llmRepair } : {}),
    ...(emailAccountId && { emailAccountId }),
    ...(userId && { userId }),
  };

  sentryCaptureException(error, {
    extra: Object.keys(sentryExtra).length > 0 ? sentryExtra : undefined,
    ...(context.tags && { tags: context.tags }),
  });
}

function getLlmRepairMetadata(error: unknown): LlmRepairMetadata | undefined {
  if (typeof error !== "object" || error === null) return;

  const metadata = (error as Record<string, unknown>)[LLM_REPAIR_METADATA_KEY];
  if (!metadata || typeof metadata !== "object") return;

  return metadata as LlmRepairMetadata;
}

export type ActionError<E extends object = Record<string, unknown>> = {
  error: string;
} & E;
export type ServerActionResponse<
  T,
  E extends object = Record<string, unknown>,
> = ActionError<E> | T;

// 该类用于抛出可以安全暴露给客户端的错误信息。
export class SafeError extends Error {
  safeMessage?: string;
  statusCode?: number;

  constructor(safeMessage?: string, statusCode?: number) {
    super(safeMessage);
    this.name = "SafeError";
    this.safeMessage = safeMessage;
    this.statusCode = statusCode;
  }
}

export class DraftNotFoundError extends SafeError {
  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "DraftNotFoundError";
  }
}

export class EmailProviderRateLimitError extends Error {
  constructor() {
    super(EMAIL_PROVIDER_RATE_LIMIT_MESSAGE);
    this.name = "EmailProviderRateLimitError";
  }
}

const INVALID_GRANT_ERROR_MARKERS = ["invalid_grant", "AADSTS50173"] as const;

export function isInvalidGrantError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) return false;

  return INVALID_GRANT_ERROR_MARKERS.some((marker) => message.includes(marker));
}

export function isGmailInsufficientPermissionsError(error: unknown): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  return (error as any)?.errors?.[0]?.reason === "insufficientPermissions";
}

export function isGmailRateLimitExceededError(error: unknown): boolean {
  const errorInfo = extractErrorInfo(error);
  return (
    errorInfo.reason === "rateLimitExceeded" ||
    errorInfo.reason === "userRateLimitExceeded" ||
    /user-rate limit exceeded/i.test(errorInfo.errorMessage)
  );
}

export function isGmailQuotaExceededError(error: unknown): boolean {
  return extractErrorInfo(error).reason === "quotaExceeded";
}

export function isIncorrectAPIKeyError(error: APICallError): boolean {
  return (
    error.message.includes("Incorrect API key provided") ||
    error.statusCode === 401
  );
}

export function isInvalidAIModelError(error: APICallError): boolean {
  const message = error.message.toLowerCase();

  // OpenAI：模型不存在，或你没有访问权限
  if (
    error.message.includes("does not exist or you do not have access to it")
  ) {
    return true;
  }
  // Anthropic：404 且带有 "not_found_error"
  if (error.statusCode === 404 && error.message.includes("not_found_error")) {
    return true;
  }
  // Bedrock：错误消息就是模型 ID（例如 "model: anthropic.claude-..."）
  if (/^model:\s*\S+$/.test(error.message.trim())) {
    return true;
  }
  // OpenRouter：模型已弃用或不可用
  if (
    message.includes("testing period") ||
    message.includes("is deprecated") ||
    message.includes("no endpoints found for") ||
    message.includes("is not a valid model id")
  ) {
    return true;
  }
  // Google：已停用的模型，例如 "This model models/xyz is no longer available"
  if (/\bmodel\b.*\bis no longer available\b/.test(message)) {
    return true;
  }
  // 通用的模型未找到模式
  if (
    error.message.includes("model is not available") ||
    error.message.includes("model not found")
  ) {
    return true;
  }
  return false;
}

export function isAPIKeyDeactivatedError(error: APICallError): boolean {
  return error.message.includes("this API key has been deactivated");
}

export function isAnthropicInsufficientBalanceError(
  error: APICallError,
): boolean {
  return error.message.includes(
    "Your credit balance is too low to access the Anthropic API",
  );
}

export function isInsufficientCreditsError(error: APICallError): boolean {
  // OpenAI 会用 429 及此错误类型来表示余额耗尽。
  return (
    error.statusCode === 402 ||
    getProviderErrorType(error) === "insufficient_quota"
  );
}

// 重试会包裹服务商的错误，其中携带状态码和响应体。
export function getAIApiCallError(error: unknown): APICallError | null {
  if (APICallError.isInstance(error)) return error;
  if (RetryError.isInstance(error) && APICallError.isInstance(error.lastError))
    return error.lastError;
  return null;
}

const HANDLED_USER_KEY_ERROR = "__handledUserKeyError";

export function markAsHandledUserKeyError(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  (error as Record<string, unknown>)[HANDLED_USER_KEY_ERROR] = true;
}

export function isHandledUserKeyError(error: unknown): boolean {
  return (error as Record<string, unknown>)?.[HANDLED_USER_KEY_ERROR] === true;
}

// 处理 AI 配额/重试错误。这可能与用户自己的 API 配额或系统配额有关。
export function isAiQuotaExceededError(error: RetryError): boolean {
  if (
    APICallError.isInstance(error.lastError) &&
    isInsufficientCreditsError(error.lastError)
  ) {
    return true;
  }

  const message = [error.message, getErrorMessage(error.lastError)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const quotaErrorMessages = [
    "exceeded your current quota",
    "quota exceeded",
    "rate limit reached",
    "rate_limit_reached",
    "too many requests",
    "hit a rate limit",
  ];
  return quotaErrorMessages.some((substr) => message.includes(substr));
}

export function isOutlookThrottlingError(error: unknown): boolean {
  const err = error as Record<string, unknown>;
  const code = err?.code as string | undefined;
  const statusCode = err?.statusCode as number | undefined;
  const message = err?.message as string | undefined;
  return (
    statusCode === 429 ||
    code === "ApplicationThrottled" ||
    code === "TooManyRequests" ||
    (typeof message === "string" &&
      (/MailboxConcurrency/i.test(message) ||
        message.includes("Request limit")))
  );
}

export function isOutlookAccessDeniedError(error: unknown): boolean {
  const err = error as Record<string, unknown>;
  const code = err?.code as string | undefined;
  const message =
    typeof err?.message === "string" ? err.message : String(err ?? "");
  return (
    code === "ErrorAccessDenied" ||
    code === "AccessDenied" ||
    message.includes("Access is denied. Check credentials and try again")
  );
}

export function isOutlookItemNotFoundError(error: unknown): boolean {
  const err = error as Record<string, unknown>;
  const code = err?.code as string | undefined;
  const message =
    typeof err?.message === "string" ? err.message : String(err ?? "");
  return (
    code === "ErrorItemNotFound" ||
    code === "itemNotFound" ||
    message.includes("not found in the store") ||
    message.includes("ResourceNotFound") ||
    message.includes("isn't an ID of an item")
  );
}

export function isKnownOutlookError(error: unknown): boolean {
  return (
    isOutlookThrottlingError(error) ||
    isOutlookAccessDeniedError(error) ||
    isOutlookItemNotFoundError(error)
  );
}

// 服务商的内容审核拒绝生成结构化输出。重试同一个模型毫无意义；
// 备用模型可能会成功。此处处理 p-retry 的上下文包装器，
// 它们会通过 `error` 属性暴露真正的错误。
export function isContentFilterRefusal(error: unknown): boolean {
  const unwrapped = (error as { error?: unknown })?.error ?? error;
  return (
    NoObjectGeneratedError.isInstance(unwrapped) &&
    unwrapped.finishReason === "content-filter"
  );
}

// 我们不希望在 Sentry 中捕获这些错误
export function isKnownApiError(error: unknown): boolean {
  return (
    isProviderRateLimitModeError(error) ||
    isGmailInsufficientPermissionsError(error) ||
    isGmailRateLimitExceededError(error) ||
    isGmailQuotaExceededError(error) ||
    isKnownOutlookError(error) ||
    isContentFilterRefusal(error) ||
    (APICallError.isInstance(error) &&
      (isIncorrectAPIKeyError(error) ||
        isInvalidAIModelError(error) ||
        isAPIKeyDeactivatedError(error) ||
        isAnthropicInsufficientBalanceError(error))) ||
    (RetryError.isInstance(error) && isAiQuotaExceededError(error)) ||
    (error instanceof Error && isKnownAIErrorMessage(error.message))
  );
}

export function checkCommonErrors(
  error: unknown,
  url: string,
  logger: Logger,
): ApiErrorType | null {
  if (isProviderRateLimitModeError(error)) {
    const apiErrorType = getProviderRateLimitApiErrorType(error.provider);
    logger.warn("服务商限流模式已对 URL 生效", {
      url,
      provider: error.provider,
      retryAt: error.retryAt,
    });
    return {
      type: apiErrorType,
      message: getEmailProviderRateLimitMessage(error.provider),
      code: 429,
    };
  }

  if (isGmailInsufficientPermissionsError(error)) {
    logger.warn("Gmail 权限不足错误，URL", { url });
    return {
      type: "Gmail Insufficient Permissions",
      message:
        "你必须授予所有 Gmail 权限才能使用本应用。请退出登录后重新登录以授予权限。",
      code: 403,
    };
  }

  if (isGmailRateLimitExceededError(error)) {
    logger.warn("Gmail 超出速率限制，URL", { url });
    return {
      type: getProviderRateLimitApiErrorType("google"),
      message: getEmailProviderRateLimitMessage("google"),
      code: 429,
    };
  }

  if (isGmailQuotaExceededError(error)) {
    logger.warn("Gmail 超出配额，URL", { url });
    return {
      type: "Gmail Quota Exceeded",
      message: "你已超出 Gmail 配额。请稍后重试。",
      code: 429,
    };
  }

  if (isOutlookThrottlingError(error)) {
    logger.warn("Outlook 限流错误，URL", { url });
    return {
      type: getProviderRateLimitApiErrorType("microsoft"),
      message: getEmailProviderRateLimitMessage("microsoft"),
      code: 429,
    };
  }

  if (isOutlookAccessDeniedError(error)) {
    logger.warn("Outlook 访问被拒绝错误，URL", { url });
    return {
      type: "Outlook Access Denied",
      message: "对邮箱的访问被拒绝。可能需要重新连接该账号。",
      code: 403,
    };
  }

  if (isOutlookItemNotFoundError(error)) {
    logger.warn("Outlook 未找到项目，URL", { url });
    return {
      type: "Outlook Item Not Found",
      message: "未找到请求的邮件。它可能已被删除。",
      code: 404,
    };
  }

  if (RetryError.isInstance(error) && isAiQuotaExceededError(error)) {
    logger.warn("AI 超出配额，URL", { url });
    return {
      type: "AI Quota Exceeded",
      message: `AI 错误：${error.message}`,
      code: 429,
    };
  }

  return null;
}

export function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  const outer = asRecord(error);
  if (!outer) return;

  const directMessage = getStringProp(outer, "message");
  if (directMessage) return directMessage;

  const nested = asRecord(outer.error);
  if (!nested) return;

  return getStringProp(nested, "message");
}

export function getUserFacingErrorMessage(
  error: unknown,
  fallback = "发生了意外错误。请重试。",
): string {
  const message = getErrorMessage(error);
  if (!message) return fallback;

  const parsed = parseJsonRecord(message);
  if (!parsed) return message;

  return getErrorMessage(parsed) || getStringProp(parsed, "error") || message;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function getStringProp(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function parseJsonRecord(message: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(message));
  } catch {
    return null;
  }
}

// --- Safe Action Error Handling ---

type FlattenedErrors = FlattenedValidationErrors<Record<string, string[]>>;

type SafeActionError = {
  serverError?: string;
  validationErrors?: FlattenedErrors;
  bindArgsValidationErrors?: readonly (FlattenedErrors | undefined)[];
};

type ActionErrorMessageOptions = {
  fallback?: string;
  prefix?: string;
};

/**
 * 从 safe-action 的错误结果中提取对用户友好的错误信息。
 * 期望展平的校验错误（defaultValidationErrorsShape: "flattened"）。
 *
 * @param error - 来自 safe-action 的错误对象
 * @param fallbackOrOptions - 回退字符串，或包含 fallback/prefix 的选项对象
 *
 * @example
 * // 简单用法
 * getActionErrorMessage(error.error)
 *
 * @example
 * // 带前缀（显示「保存失败。<error>」，如果没有错误则仅显示「保存失败」）
 * getActionErrorMessage(error.error, { prefix: "保存失败" })
 */
export function getActionErrorMessage(
  error: SafeActionError,
  fallbackOrOptions: string | ActionErrorMessageOptions = "发生未知错误",
): string {
  const { fallback, prefix } =
    typeof fallbackOrOptions === "string"
      ? { fallback: fallbackOrOptions, prefix: undefined }
      : {
          fallback: fallbackOrOptions.fallback ?? "发生未知错误",
          prefix: fallbackOrOptions.prefix,
        };

  const message = extractActionErrorMessage(error);

  if (prefix) {
    return message ? `${prefix}. ${message}` : prefix;
  }

  return message || fallback;
}

export function assertActionSucceeded(
  result: SafeActionError | undefined,
): void {
  if (!result) return;

  const message = extractActionErrorMessage(result);
  if (message === EMAIL_PROVIDER_RATE_LIMIT_MESSAGE) {
    throw new EmailProviderRateLimitError();
  }
  if (message) throw new Error(message);
}

function extractActionErrorMessage(error: SafeActionError): string | null {
  if (error.serverError) {
    return error.serverError;
  }

  const messages = getValidationMessages(error.validationErrors);
  if (messages) return messages;

  if (error.bindArgsValidationErrors) {
    for (const ve of error.bindArgsValidationErrors) {
      const msg = getValidationMessages(ve);
      if (msg) return msg;
    }
  }

  return null;
}

function getValidationMessages(
  errors: FlattenedErrors | undefined,
): string | null {
  if (!errors) return null;

  const { formErrors, fieldErrors } = errors;
  const all = [...formErrors, ...Object.values(fieldErrors).flat()];

  return all.length > 0 ? all.join(". ") : null;
}

// 针对可能丢失 APICallError 类型的 AI 错误的基于消息的回退
// （例如被 PostHog AI 之类的中间件包装时）
function isKnownAIErrorMessage(message: string): boolean {
  const patterns = [
    "Incorrect API key provided",
    "does not exist or you do not have access to it",
    "this API key has been deactivated",
    "credit balance is too low",
    "testing period",
    "model is not available",
    "model not found",
  ];
  return patterns.some((p) => message.includes(p));
}

function getProviderErrorType(error: APICallError): string | undefined {
  const data = error.data as { error?: { type?: unknown } } | undefined;
  if (typeof data?.error?.type === "string") return data.error.type;
  if (!error.responseBody) return;
  try {
    const body = JSON.parse(error.responseBody) as {
      error?: { type?: unknown };
    };
    return typeof body?.error?.type === "string" ? body.error.type : undefined;
  } catch {
    return;
  }
}
