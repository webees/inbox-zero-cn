import { app, dialog, Notification } from "electron";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import { captureDesktopError } from "./sentry";
import { isTransientNetworkError } from "./network-errors";
import { getDesktopUpdateFeedUrl } from "./update-feed";

export const DESKTOP_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let downloadedVersion: string | null = null;
let updateEventsBound = false;
let reportDownloadProgress = false;
let downloadingVersion: string | null = null;
let lastReportedPercent: number | null = null;
let onUpdateReady: ((version: string) => void) | undefined;
let onDownloadProgress:
  | ((progress: DesktopDownloadProgress | null) => void)
  | undefined;

export type DesktopDownloadProgress = { version: string; percent: number };

export function logDesktopUpdateError(error: unknown) {
  console.error(error instanceof Error ? error.message : "桌面端更新检查失败");
  if (!isTransientNetworkError(error)) {
    captureDesktopError(error, { area: "auto-update" });
  }
}

export function resetDesktopAutoUpdateForTests() {
  downloadedVersion = null;
  updateEventsBound = false;
  reportDownloadProgress = false;
  downloadingVersion = null;
  lastReportedPercent = null;
  onUpdateReady = undefined;
  onDownloadProgress = undefined;
}

export function isDesktopUpdateReady() {
  return downloadedVersion !== null;
}

export async function startDesktopAutoUpdate(
  isPackaged = app.isPackaged,
  handlers?: {
    onUpdateReady?: (version: string) => void;
    onDownloadProgress?: (progress: DesktopDownloadProgress | null) => void;
  },
): Promise<boolean> {
  if (!isPackaged) return false;

  try {
    const autoUpdater = await getDesktopAutoUpdater(handlers);
    scheduleDesktopUpdateChecks(autoUpdater);
    observeDownload(await autoUpdater.checkForUpdates());
    return true;
  } catch (error) {
    logDesktopUpdateError(error);
    return false;
  }
}

export async function installDownloadedDesktopUpdate(
  prepareToQuit: () => void,
): Promise<boolean> {
  if (!downloadedVersion) return false;

  const autoUpdater = await getDesktopAutoUpdater();
  prepareToQuit();
  autoUpdater.quitAndInstall(true, true);
  return true;
}

export async function checkForDesktopUpdatesManually(
  prepareToQuit: () => void,
  {
    isPackaged = app.isPackaged,
    showsProgressInApp = () => false,
  }: { isPackaged?: boolean; showsProgressInApp?: () => boolean } = {},
): Promise<boolean> {
  if (!isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      message: "开发版本中无法使用更新",
      detail: "请安装 Inbox Zero 正式发行版以接收更新。",
    });
    return false;
  }

  try {
    const autoUpdater = await getDesktopAutoUpdater();
    if (downloadedVersion) {
      return promptToInstallDownloadedUpdate(prepareToQuit, autoUpdater);
    }

    reportDownloadProgress = true;
    const result = await autoUpdater.checkForUpdates();
    if (!result) throw new Error("桌面端更新程序不可用");
    observeDownload(result, stopReportingDownloadProgress);

    if (downloadedVersion) {
      stopReportingDownloadProgress();
      return promptToInstallDownloadedUpdate(prepareToQuit, autoUpdater);
    }

    if (!result.isUpdateAvailable) {
      stopReportingDownloadProgress();
      await dialog.showMessageBox({
        type: "info",
        message: "已是最新版本",
        detail: `Inbox Zero ${app.getVersion()} 是当前最新版本。`,
      });
      return true;
    }

    downloadingVersion = result.updateInfo.version;
    lastReportedPercent ??= 0;
    onDownloadProgress?.({
      version: downloadingVersion,
      percent: lastReportedPercent,
    });
    if (showsProgressInApp()) return true;

    await dialog.showMessageBox({
      type: "info",
      message: `正在下载 Inbox Zero ${result.updateInfo.version}`,
      detail:
        "您可以继续使用 Inbox Zero。更新准备好后，应用菜单中会出现“重启以更新”。",
    });
    return true;
  } catch (error) {
    stopReportingDownloadProgress();
    logDesktopUpdateError(error);
    await dialog.showMessageBox({
      type: "error",
      message: "无法检查更新",
      detail: "请稍后重试。",
    });
    return false;
  }
}

async function getDesktopAutoUpdater(handlers?: {
  onUpdateReady?: (version: string) => void;
  onDownloadProgress?: (progress: DesktopDownloadProgress | null) => void;
}): Promise<AppUpdater> {
  if (handlers?.onUpdateReady) onUpdateReady = handlers.onUpdateReady;
  if (handlers?.onDownloadProgress) {
    onDownloadProgress = handlers.onDownloadProgress;
  }

  const { autoUpdater } = await import("electron-updater");
  autoUpdater.setFeedURL({
    provider: "generic",
    url: getDesktopUpdateFeedUrl(),
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  bindUpdateDownloaded(autoUpdater);
  return autoUpdater;
}

function bindUpdateDownloaded(autoUpdater: AppUpdater) {
  if (updateEventsBound) return;
  updateEventsBound = true;
  autoUpdater.on("download-progress", (progress: { percent: number }) => {
    if (!reportDownloadProgress) return;
    reportProgress(Math.round(progress.percent));
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    if (downloadedVersion === info.version) return;
    downloadedVersion = info.version;
    notifyUpdateReady(info.version);
    onUpdateReady?.(info.version);
    stopReportingDownloadProgress();
  });
}

// Events that arrive before the check resolves have no version yet; the check
// reports the latest percent once it knows which version is downloading.
function reportProgress(percent: number) {
  if (percent === lastReportedPercent) return;
  lastReportedPercent = percent;
  if (!downloadingVersion) return;
  onDownloadProgress?.({ version: downloadingVersion, percent });
}

function stopReportingDownloadProgress() {
  if (!reportDownloadProgress && lastReportedPercent === null) return;
  reportDownloadProgress = false;
  downloadingVersion = null;
  lastReportedPercent = null;
  onDownloadProgress?.(null);
}

function notifyUpdateReady(version: string) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({
      title: "更新已准备好安装",
      body: `重启 Inbox Zero 以完成更新到 ${version}。`,
    }).show();
  } catch (error) {
    logDesktopUpdateError(error);
  }
}

async function promptToInstallDownloadedUpdate(
  prepareToQuit: () => void,
  autoUpdater: AppUpdater,
) {
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["重启以更新", "稍后"],
    defaultId: 0,
    cancelId: 1,
    message: "更新已准备好安装",
    detail: `Inbox Zero ${downloadedVersion} 已下载完成。立即重启以完成更新。`,
  });
  if (response === 0) {
    prepareToQuit();
    autoUpdater.quitAndInstall(true, true);
  }
  return true;
}

function scheduleDesktopUpdateChecks(autoUpdater: AppUpdater) {
  const timer = setInterval(() => {
    autoUpdater
      .checkForUpdates()
      .then((result) => observeDownload(result))
      .catch(logDesktopUpdateError);
  }, DESKTOP_UPDATE_INTERVAL_MS);
  timer.unref();
}

function observeDownload(
  result: { downloadPromise?: Promise<unknown> | null } | null | undefined,
  onFailure?: () => void,
) {
  result?.downloadPromise?.catch((error: unknown) => {
    onFailure?.();
    logDesktopUpdateError(error);
  });
}
