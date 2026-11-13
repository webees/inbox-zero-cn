/** biome-ignore-all lint/suspicious/noConsole: we use console.log for development logs */
import get from "lodash/get";
import { log } from "next-axiom";
import { serializeError } from "serialize-error";
import { env } from "@/env";
import {
  CONTENT_FIELD_NAMES,
  normalizeRedactionFieldName,
  REDACTED_FIELD_NAMES,
  SENSITIVE_FIELD_NAMES,
} from "@/utils/redact-fields";

export type Logger = ReturnType<typeof createScopedLogger>;

type LogLevel = "info" | "error" | "warn" | "trace";

const NORMALIZED_REDACTED_FIELD_NAMES =
  normalizeFieldNames(REDACTED_FIELD_NAMES);
const NORMALIZED_CONTENT_FIELD_NAMES = normalizeFieldNames(CONTENT_FIELD_NAMES);
const NORMALIZED_SENSITIVE_FIELD_NAMES = normalizeFieldNames(
  SENSITIVE_FIELD_NAMES,
);

const colors = {
  info: "\x1b[0m", // 白色
  error: "\x1b[31m", // 红色
  warn: "\x1b[33m", // 黄色
  trace: "\x1b[36m", // 青色
  reset: "\x1b[0m",
} as const;

export function createScopedLogger(scope: string) {
  if (typeof window === "undefined" && env.AXIOM_TOKEN)
    return createAxiomLogger(scope);
  if (env.NEXT_PUBLIC_LOG_SCOPES && !env.NEXT_PUBLIC_LOG_SCOPES.includes(scope))
    return createNullLogger();

  const createLogger = (fields: Record<string, unknown> = {}) => {
    const formatMessage = (
      level: LogLevel,
      message: string,
      args: unknown[],
    ) => {
      const allArgs = [...args].map(hashSensitiveFields);
      if (Object.keys(fields).length > 0) {
        allArgs.push(hashSensitiveFields(fields));
      }

      const formattedArgs = allArgs
        .map((arg) => {
          if (arg instanceof Error) {
            return arg.message;
          }
          if (typeof arg === "object" && arg !== null) {
            // 处理可能包含 Error 实例的对象
            const processedArg = processErrorsInObject(arg);
            return JSON.stringify(processedArg, null, 2);
          }
          return String(arg);
        })
        .join(" ");

      const msg = `[${scope}]: ${message} ${formattedArgs}`;

      if (env.NODE_ENV === "development") {
        // 在开发日志中将字面量 \n 替换为实际换行
        const formattedMsg = msg.replace(/\\n/g, "\n");
        return `${colors[level]}${formattedMsg}${colors.reset}`;
      }
      return msg;
    };

    return {
      info: (message: string, ...args: unknown[]) =>
        console.log(formatMessage("info", message, args)),
      error: (message: string, ...args: unknown[]) =>
        console.error(formatMessage("error", message, args)),
      warn: (message: string, ...args: unknown[]) =>
        console.warn(formatMessage("warn", message, args)),
      trace: (
        message: string,
        ...args: Array<unknown> | [() => unknown] | [() => unknown[]]
      ) => {
        if (!env.ENABLE_DEBUG_LOGS) return;
        const first = args[0];
        const resolved = typeof first === "function" ? first() : args;
        const finalArgs = Array.isArray(resolved) ? resolved : [resolved];
        console.log(formatMessage("trace", message, finalArgs));
      },
      with: (newFields: Record<string, unknown>) =>
        createLogger({ ...fields, ...newFields }),
      flush: () => Promise.resolve(), // 控制台 logger 的空实现
    };
  };

  return createLogger();
}

function createAxiomLogger(scope: string) {
  const createLogger = (fields: Record<string, unknown> = {}) => ({
    info: (message: string, args?: Record<string, unknown>) =>
      log.info(
        message,
        hashSensitiveFields({ scope, ...fields, ...formatError(args) }),
      ),
    error: (message: string, args?: Record<string, unknown>) =>
      log.error(
        message,
        hashSensitiveFields({ scope, ...fields, ...formatError(args) }),
      ),
    warn: (message: string, args?: Record<string, unknown>) =>
      log.warn(
        message,
        hashSensitiveFields({ scope, ...fields, ...formatError(args) }),
      ),
    trace: (
      message: string,
      args?: Record<string, unknown> | (() => Record<string, unknown>),
    ) => {
      if (!env.ENABLE_DEBUG_LOGS) return;
      const resolved = typeof args === "function" ? args() : args;
      log.debug(
        message,
        hashSensitiveFields({ scope, ...fields, ...formatError(resolved) }),
      );
    },
    with: (newFields: Record<string, unknown>) =>
      createLogger({ ...fields, ...newFields }),
    flush: () => log.flush(),
  });

  return createLogger();
}

function createNullLogger() {
  return {
    info: () => {},
    error: () => {},
    warn: () => {},
    trace: () => {},
    with: () => createNullLogger(),
    flush: () => Promise.resolve(),
  };
}

function formatError(args?: Record<string, unknown>) {
  if (env.NODE_ENV !== "production") return args;
  if (!args?.error) return args;

  const error = serializeError(args.error);
  const { error: _rawError, ...argsWithoutError } = args;

  return {
    ...argsWithoutError,
    error,
    errorMessage: getSimpleErrorMessage(error) ?? "未知错误",
  };
}

function processErrorsInObject(obj: unknown): unknown {
  if (obj instanceof Error) {
    return obj.message;
  }

  if (Array.isArray(obj)) {
    return obj.map(processErrorsInObject);
  }

  if (typeof obj === "object" && obj !== null) {
    const processed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      processed[key] = processErrorsInObject(value);
    }
    return processed;
  }

  return obj;
}

const NESTED_ERROR_MESSAGE_PATHS = [
  ["message"],
  ["error", "message"],
  ["cause", "message"],
  ["response", "data", "error", "message"],
  ["data", "error", "message"],
  ["lastError", "data", "error", "message"],
  ["error", "cause", "message"],
  ["error", "response", "data", "error", "message"],
  ["error", "data", "error", "message"],
  ["error", "lastError", "data", "error", "message"],
] as const;

function getSimpleErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  for (const path of NESTED_ERROR_MESSAGE_PATHS) {
    const value = get(error, path);
    if (typeof value === "string") return value;
  }

  return;
}

/**
 * 递归处理对象以保护敏感数据：
 * - REDACTED_FIELD_NAMES：替换为布尔值（绝不记录）
 * - CONTENT_FIELD_NAMES：在生产环境中替换为布尔值（除非启用了调试日志）
 * - SENSITIVE_FIELD_NAMES：在生产环境中哈希（开发/测试环境中保留原值）
 *
 * 仅在服务端生效 - 客户端日志无论如何在浏览器中都是可见的。
 */
function hashSensitiveFields<T>(obj: T, depth = 0): T {
  // 防止无限递归和过度处理
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) return obj;

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => hashSensitiveFields(item, depth + 1)) as T;
  }

  // 仅处理普通对象 - 跳过类实例、Error、Date 等
  if (isPlainObject(obj)) {
    const processed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = normalizeRedactionFieldName(key);

      // 始终对令牌脱敏 - 绝不记录它们
      if (NORMALIZED_REDACTED_FIELD_NAMES.has(normalizedKey)) {
        processed[key] = !!value;
      }
      // 在生产环境中对内容字段脱敏（除非启用了调试日志）
      else if (
        NORMALIZED_CONTENT_FIELD_NAMES.has(normalizedKey) &&
        env.NODE_ENV === "production" &&
        !env.ENABLE_DEBUG_LOGS
      ) {
        processed[key] = !!value;
      }
      // 仅在生产环境中对邮箱进行哈希（仅服务端）
      else if (
        NORMALIZED_SENSITIVE_FIELD_NAMES.has(normalizedKey) &&
        typeof value === "string" &&
        env.NODE_ENV === "production" &&
        typeof window === "undefined" // 服务端检查
      ) {
        // 动态导入以避免在客户端打包 crypto
        const { hash } = require("@/utils/hash");
        processed[key] = hash(value);
      }
      // 递归处理嵌套对象
      else if (typeof value === "object") {
        processed[key] = hashSensitiveFields(value, depth + 1);
      }
      // 其余内容原样传递
      else {
        processed[key] = value;
      }
    }
    return processed as T;
  }

  return obj;
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}

function normalizeFieldNames(fieldNames: Set<string>) {
  return new Set([...fieldNames].map(normalizeRedactionFieldName));
}
