import * as Sentry from "@sentry/electron/main";
import type { Breadcrumb, ErrorEvent } from "@sentry/electron/main";
import { app } from "electron";

// 在构建时注入；开发和自托管构建会留空。
const DSN = process.env.INBOX_ZERO_SENTRY_DSN;
// 邮件引擎和更新程序会自行重试，否则一个持续存在的失败会在每次尝试时都上报。
const REPEAT_REPORT_INTERVAL_MS = 10 * 60 * 1000;
const lastReportedAt = new Map<string, number>();
const DIAGNOSTICS_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * 上报主进程错误、渲染进程/GPU 进程崩溃以及原生 minidump。
 * 托管的 Web 应用会单独上报它自己的渲染进程错误。
 */
export function initDesktopSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    release: `desktop@${app.getVersion()}`,
    environment: app.isPackaged ? "production" : "development",
    sendDefaultPii: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

export function captureDesktopError(
  error: unknown,
  tags: Record<string, string>,
  {
    extra,
    now = Date.now(),
  }: { extra?: Record<string, unknown>; now?: number } = {},
) {
  if (!DSN) return;
  const key = `${JSON.stringify(tags)}:${error instanceof Error ? error.message : String(error)}`;
  const last = lastReportedAt.get(key);
  if (last !== undefined && now - last < REPEAT_REPORT_INTERVAL_MS) return;
  if (lastReportedAt.size >= 200) lastReportedAt.clear();
  lastReportedAt.set(key, now);
  Sentry.captureException(error, { tags, extra });
}

export function isDesktopSentryEnabled() {
  return Boolean(DSN);
}

/** 解析为可向支持团队提供的 event id；如果未发送则为 null。 */
export async function sendDesktopDiagnostics(
  attachments: Array<{ filename: string; data: Uint8Array }>,
) {
  if (!DSN) return null;
  const eventId = Sentry.withScope((scope) => {
    scope.setTag("area", "diagnostics");
    for (const attachment of attachments) scope.addAttachment(attachment);
    return Sentry.captureMessage("用户诊断", "info");
  });
  const sent = await Sentry.flush(DIAGNOSTICS_UPLOAD_TIMEOUT_MS);
  return sent ? eventId : null;
}

// 原生渲染进程崩溃会带上崩溃页面的 URL，其中可能包含查询字符串，
// 而这些信息不在 breadcrumbs 里。
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const electron = event.contexts?.electron;
  if (electron && typeof electron.crashed_url === "string") {
    electron.crashed_url = withoutQuery(electron.crashed_url);
  }
  if (event.request?.url) event.request.url = withoutQuery(event.request.url);
  return event;
}

// Sentry 是第三方：为保留上下文而保留 URL 路径，但去掉查询字符串，
// 并跳过可能包含邮件内容的 console 输出。
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  if (!breadcrumb.data) return breadcrumb;
  const data = { ...breadcrumb.data };
  for (const key of ["url", "from", "to"]) {
    if (typeof data[key] === "string") data[key] = withoutQuery(data[key]);
  }
  return { ...breadcrumb, data };
}

function withoutQuery(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/)[0] ?? value;
  }
}
