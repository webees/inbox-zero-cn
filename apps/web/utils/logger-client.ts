/** biome-ignore-all lint/suspicious/noConsole: we use console.log for development logs */
import { log } from "next-axiom";
import { env } from "@/env";

/**
 * 客户端安全的 logger，不会访问服务端环境变量。
 * 生产日志使用 next-axiom（如果设置了 NEXT_PUBLIC_AXIOM_TOKEN），
 * 否则回退到 console。
 */
export function createClientLogger(scope: string) {
  const hasAxiom = !!env.NEXT_PUBLIC_AXIOM_TOKEN;

  if (hasAxiom) {
    return {
      info: (message: string, args?: Record<string, unknown>) =>
        log.info(message, { scope, ...(args ?? {}) }),
      error: (message: string, args?: Record<string, unknown>) =>
        log.error(message, { scope, ...(args ?? {}) }),
      warn: (message: string, args?: Record<string, unknown>) =>
        log.warn(message, { scope, ...(args ?? {}) }),
      trace: (
        message: string,
        args?: Record<string, unknown> | (() => Record<string, unknown>),
      ) => {
        log.debug(message, {
          scope,
          ...(resolveTraceArgs(args) ?? {}),
        });
      },
      flush: () => log.flush(),
    };
  }

  return {
    info: (message: string, args?: Record<string, unknown>) =>
      console.log(`[${scope}]:`, message, args ?? ""),
    error: (message: string, args?: Record<string, unknown>) =>
      console.error(`[${scope}]:`, message, args ?? ""),
    warn: (message: string, args?: Record<string, unknown>) =>
      console.warn(`[${scope}]:`, message, args ?? ""),
    trace: (
      message: string,
      args?: Record<string, unknown> | (() => Record<string, unknown>),
    ) => console.debug(`[${scope}]:`, message, resolveTraceArgs(args) ?? ""),
    flush: () => Promise.resolve(),
  };
}

function resolveTraceArgs(
  args?: Record<string, unknown> | (() => Record<string, unknown>),
) {
  return typeof args === "function" ? args() : args;
}
