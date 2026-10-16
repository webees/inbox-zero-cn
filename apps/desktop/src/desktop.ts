import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DESKTOP_PROTOCOL = "inboxzero";
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth-callback";
export const DEFAULT_APP_URL = "https://www.getinboxzero.com";
export const DESKTOP_AUTH_PROVIDERS = ["apple", "google", "microsoft"] as const;

export type DesktopAuthProvider = (typeof DESKTOP_AUTH_PROVIDERS)[number];

export type DesktopAuthCallback =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string };

export function getDesktopAppOrigin(
  appUrl = process.env.INBOX_ZERO_APP_URL ?? DEFAULT_APP_URL,
): string {
  const parsed = new URL(appUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("INBOX_ZERO_APP_URL 必须是 http(s) URL");
  }
  return parsed.origin;
}

export function getDesktopLoginUrl(appOrigin: string): string {
  return new URL("/login", appOrigin).toString();
}

export function getDesktopHomeUrl(appOrigin: string): string {
  return new URL("/welcome-redirect?mode=mail", appOrigin).toString();
}

export function getDesktopBrowserStartUrl(
  appOrigin: string,
  provider: DesktopAuthProvider,
  codeChallenge: string,
): string {
  const url = new URL("/api/mobile-auth/browser-start", appOrigin);
  url.searchParams.set("provider", provider);
  url.searchParams.set("codeChallenge", codeChallenge);
  return url.toString();
}

export function isDesktopAuthProvider(
  value: unknown,
): value is DesktopAuthProvider {
  return (
    typeof value === "string" &&
    (DESKTOP_AUTH_PROVIDERS as readonly string[]).includes(value)
  );
}

export function isDesktopProtocolUrl(url: string): boolean {
  try {
    return new URL(url).protocol === `${DESKTOP_PROTOCOL}:`;
  } catch {
    return false;
  }
}

export function parseDesktopAuthCallback(url: string): DesktopAuthCallback {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "无效的认证回调" };
  }

  if (parsed.protocol !== `${DESKTOP_PROTOCOL}:`) {
    return { ok: false, error: "无效的认证回调" };
  }

  const path = `${parsed.hostname}${parsed.pathname}`
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
  if (path !== "auth-callback") {
    return { ok: false, error: "无效的认证回调" };
  }

  const error = parsed.searchParams.get("error");
  if (error) {
    return {
      ok: false,
      error: parsed.searchParams.get("error_description") || error,
    };
  }

  const code = parsed.searchParams.get("code")?.trim() ?? "";
  const state = parsed.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return { ok: false, error: "认证未完成" };
  }

  return { ok: true, code, state };
}

export function isAllowedDesktopNavigation(
  url: string,
  appOrigin: string,
  localMailRendererFile?: string,
): boolean {
  if (url === "about:blank") return true;
  if (
    localMailRendererFile &&
    isDesktopLocalMailUrl(url, localMailRendererFile)
  ) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return parsed.origin === appOrigin;
}

export function getDesktopLocalMailUrl(
  rendererFile: string,
  accountIds: string[] = [],
): string {
  const url = pathToFileURL(path.resolve(rendererFile));
  for (const accountId of accountIds) {
    url.searchParams.append("accountId", accountId);
  }
  return url.href;
}

export function isDesktopLocalMailUrl(
  url: string,
  rendererFile: string,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    return path.resolve(fileURLToPath(parsed)) === path.resolve(rendererFile);
  } catch {
    return false;
  }
}

export function shouldUseLocalMailRenderer(
  env: NodeJS.Dict<string> = process.env,
): boolean {
  return env.INBOX_ZERO_LOCAL_MAIL === "1";
}

export function shouldSmokeLocalMail(
  env: NodeJS.Dict<string> = process.env,
): boolean {
  return env.INBOX_ZERO_LOCAL_MAIL_SMOKE === "1";
}

export function resolveDesktopStartUrl({
  requestedUrl,
  localMailUrl,
  homeUrl,
  rendererFile,
}: {
  requestedUrl?: string;
  localMailUrl: string | null;
  homeUrl: string;
  rendererFile: string;
}): string {
  if (!localMailUrl) return requestedUrl ?? homeUrl;
  if (requestedUrl && isDesktopLocalMailUrl(requestedUrl, rendererFile)) {
    return requestedUrl;
  }
  return localMailUrl;
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

export function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function normalizeDesktopCallbackPath(path: unknown): string | null {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    return null;
  }
  if (path.includes("\\")) return null;

  try {
    const url = new URL(path, "https://internal-path.example");
    if (url.origin !== "https://internal-path.example") return null;
    const pathname = url.pathname.replace(/^\/{2,}/u, "/");
    if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function getDesktopPostAuthUrl(
  appOrigin: string,
  callbackPath?: string | null,
): string {
  const normalizedCallbackPath = normalizeDesktopCallbackPath(callbackPath);
  return normalizedCallbackPath
    ? new URL(normalizedCallbackPath, appOrigin).toString()
    : getDesktopHomeUrl(appOrigin);
}

export function findDesktopProtocolUrl(argv: readonly string[]): string | null {
  return argv.find(isDesktopProtocolUrl) ?? null;
}

// 认证页面本来就是回退的起始 URL，而 API 路由不是页面。
const NON_RESTORABLE_PATH_PREFIXES = ["/login", "/api/"];

export function shouldPersistDesktopUrl(
  url: string,
  appOrigin: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.origin !== appOrigin) return false;

  return !NON_RESTORABLE_PATH_PREFIXES.some(
    (prefix) =>
      parsed.pathname === prefix.replace(/\/$/u, "") ||
      parsed.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

export function getDesktopSessionRestoreUrl(
  appOrigin: string,
  persistedUrl: unknown,
): string | null {
  if (typeof persistedUrl !== "string") return null;
  if (!shouldPersistDesktopUrl(persistedUrl, appOrigin)) return null;
  const parsed = new URL(persistedUrl);
  // 邮件是桌面端的主要模式。在完整重启后保留其选定的视图，
  // 但把工具类页面送回桌面端主页网关。
  if (!isDesktopMailPath(parsed.pathname)) return null;
  return parsed.toString();
}

const MAIL_ACCOUNT_PATH = /^\/([^/]+)\/mail\/?$/u;

function isDesktopMailPath(pathname: string): boolean {
  return pathname === "/mail" || MAIL_ACCOUNT_PATH.test(pathname);
}

export function getDesktopMailAccountId(
  url: string,
  appOrigin: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== appOrigin) return null;
  return MAIL_ACCOUNT_PATH.exec(parsed.pathname)?.[1] ?? null;
}

const DESKTOP_WINDOW_BACKGROUND = "#ffffff";

/** 在 52px 宽的左侧拖拽区域中让信号灯垂直居中。 */
export const DESKTOP_MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 18 } as const;
export const DESKTOP_MAC_TITLEBAR_HEIGHT = 52;
export const DESKTOP_MAC_TRAFFIC_LIGHTS_WIDTH = 78;
/** 标记此类的 Web chrome 会被 Mac 桌面样式表隐藏。 */
export const DESKTOP_MAC_HIDE_ATTRIBUTE = "data-hide-on-desktop-mac";
export const DESKTOP_MAC_TITLEBAR_SPACER_ATTRIBUTE =
  "data-desktop-mac-titlebar-spacer";
export const DESKTOP_MAC_END_ATTRIBUTE = "data-desktop-mac-end";

export function getDesktopWindowChrome(platform = process.platform): {
  autoHideMenuBar?: boolean;
  backgroundColor: string;
  titleBarStyle?: "default" | "hiddenInset";
  trafficLightPosition?: { x: number; y: number };
} {
  if (platform === "darwin") {
    return {
      backgroundColor: DESKTOP_WINDOW_BACKGROUND,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { ...DESKTOP_MAC_TRAFFIC_LIGHT_POSITION },
    };
  }

  if (platform === "win32") {
    return {
      autoHideMenuBar: false,
      backgroundColor: DESKTOP_WINDOW_BACKGROUND,
      titleBarStyle: "default",
    };
  }

  return {
    autoHideMenuBar: true,
    backgroundColor: DESKTOP_WINDOW_BACKGROUND,
  };
}

export const DESKTOP_WINDOW_DRAG_CSS = `
html::before,
html::after {
  content: "";
  position: fixed;
  top: 0;
  z-index: 2147483645;
  -webkit-app-region: drag;
  pointer-events: auto;
}

html::before {
  left: 0;
  width: ${DESKTOP_MAC_TRAFFIC_LIGHTS_WIDTH}px;
  height: ${DESKTOP_MAC_TITLEBAR_HEIGHT}px;
}

html::after {
  left: ${DESKTOP_MAC_TRAFFIC_LIGHTS_WIDTH}px;
  right: 0;
  height: 12px;
}

:root {
  --desktop-traffic-lights-width: ${DESKTOP_MAC_TRAFFIC_LIGHTS_WIDTH}px;
  --desktop-traffic-lights-height: ${DESKTOP_MAC_TITLEBAR_HEIGHT}px;
}

[${DESKTOP_MAC_HIDE_ATTRIBUTE}] {
  display: none !important;
}

[${DESKTOP_MAC_TITLEBAR_SPACER_ATTRIBUTE}] {
  padding-top: ${DESKTOP_MAC_TITLEBAR_HEIGHT}px;
}

[${DESKTOP_MAC_END_ATTRIBUTE}] {
  flex: none;
  margin-left: auto;
}
`.trim();

export function getDesktopWindowDragCss(
  platform = process.platform,
): string | null {
  // Windows 已经有原生覆盖式拖拽区域；Linux 保留原生标题栏。
  if (platform !== "darwin") return null;
  return DESKTOP_WINDOW_DRAG_CSS;
}
