import { env } from "@/env";

export type CookieConsentChoice = "granted" | "denied";

export type CookieConsentState =
  | "not-required"
  | "pending"
  | CookieConsentChoice;

const STORAGE_KEY = "cookie-consent";
const CHANGE_EVENT = "cookie-consent-change";

// 当存储不可用时，在内存中保留本次页面的选择。
let memoryChoice: CookieConsentChoice | null = null;
let settingsReopened = false;

// 由受同意约束的跟踪器写入的 cookie 和存储，在访客撤回同意时移除。
const TRACKING_COOKIE_PREFIXES = [
  "ph_",
  "_ga",
  "_gcl",
  "_gid",
  "dub_",
  "utm_",
  "gclid",
  "gbraid",
  "wbraid",
  "gad_",
  "affiliate",
];
const TRACKING_STORAGE_PREFIXES = ["ph_", "__ph"];

// 位置信息从设备时区读取，因此无需发起请求，该检查在自托管部署上也能
// 正常工作。涵盖欧盟（包括其最外围地区）、欧洲经济区其余地区、英国和
// 瑞士，这些地区采用相同的 cookie 同意规则。
const CONSENT_TIME_ZONES = new Set([
  // 欧盟
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Bratislava",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Busingen",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Lisbon",
  "Europe/Ljubljana",
  "Europe/Luxembourg",
  "Europe/Madrid",
  "Europe/Malta",
  "Europe/Mariehamn",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Riga",
  "Europe/Rome",
  "Europe/Sofia",
  "Europe/Stockholm",
  "Europe/Tallinn",
  "Europe/Vienna",
  "Europe/Vilnius",
  "Europe/Warsaw",
  "Europe/Zagreb",
  "Africa/Ceuta",
  "America/Cayenne",
  "America/Guadeloupe",
  "America/Marigot",
  "America/Martinique",
  "Asia/Famagusta",
  "Asia/Nicosia",
  "Atlantic/Azores",
  "Atlantic/Canary",
  "Atlantic/Madeira",
  "Indian/Mayotte",
  "Indian/Reunion",
  // 欧洲经济区其余地区
  "Atlantic/Reykjavik",
  "Europe/Oslo",
  "Europe/Vaduz",
  // 英国和瑞士
  "Europe/London",
  "Europe/Zurich",
]);

export function isConsentTimeZone(timeZone: string | undefined): boolean {
  return Boolean(timeZone && CONSENT_TIME_ZONES.has(timeZone));
}

export function getCookieConsentState(): CookieConsentState {
  if (!env.NEXT_PUBLIC_COOKIE_CONSENT_ENABLED) return "not-required";
  if (!isConsentTimeZone(getDeviceTimeZone())) return "not-required";

  return getStoredChoice() ?? "pending";
}

export function canUseTrackingCookies(): boolean {
  const state = getCookieConsentState();
  return state === "not-required" || state === "granted";
}

export function isCookieBannerOpen(): boolean {
  const state = getCookieConsentState();
  return state === "pending" || (settingsReopened && state !== "not-required");
}

export function setCookieConsent(choice: CookieConsentChoice) {
  const previous = getStoredChoice();
  settingsReopened = false;
  const persisted = writeStoredChoice(choice);
  memoryChoice = persisted ? null : choice;

  if (choice === "denied" && previous === "granted") {
    clearTrackingStorage();

    // 若重新加载时存储中仍留有同意授权，跟踪就会恢复，
    // 因此仅在授权已被移除后才重新加载。否则本次页面的
    // 内存中拒绝状态将继续生效。
    if (persisted || removeStoredChoice()) {
      // 已加载的脚本会继续运行，直到页面重新加载。
      window.location.reload();
      return;
    }
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function reopenCookieConsent() {
  settingsReopened = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToCookieConsent(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;

    // 在其他标签页撤回同意也必须停止在此处加载的脚本。
    if (event.oldValue === "granted" && event.newValue !== "granted") {
      window.location.reload();
      return;
    }

    onChange();
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getDeviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
}

function getStoredChoice(): CookieConsentChoice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "granted" || value === "denied") return value;
  } catch {}

  return memoryChoice;
}

function writeStoredChoice(choice: CookieConsentChoice): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

function removeStoredChoice(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function clearTrackingStorage() {
  const cookieNames = document.cookie
    .split("; ")
    .map((cookie) => cookie.split("=")[0])
    .filter((name) =>
      TRACKING_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );

  // 分析 cookie 通常设置在父域名上，因此在它可能存在的每个
  // 域名层级上都将其置为过期。
  const hostParts = window.location.hostname.split(".");
  const domains = hostParts.map((_, index) => hostParts.slice(index).join("."));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
    }
  }

  try {
    for (const key of Object.keys(window.localStorage)) {
      if (TRACKING_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {}
}
