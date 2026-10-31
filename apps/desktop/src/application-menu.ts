import {
  app,
  type BaseWindow,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

const PRODUCT_NAME = "Inbox Zero";

export function configureDesktopApplicationMenu({
  checkForUpdates,
  createWindow,
  openSettings,
  recordDiagnostics,
  updateReady = false,
  downloadPercent = null,
  platform = process.platform,
}: {
  checkForUpdates: () => void;
  createWindow: () => void;
  openSettings: () => void;
  recordDiagnostics: () => void;
  updateReady?: boolean;
  downloadPercent?: number | null;
  platform?: NodeJS.Platform;
}) {
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: app.getVersion(),
  });

  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: updateMenuLabel(updateReady, downloadPercent),
    click: checkForUpdates,
  };
  const settingsItem: MenuItemConstructorOptions = {
    label: "设置…",
    accelerator: "CommandOrControl+,",
    click: openSettings,
  };
  const recordDiagnosticsItem: MenuItemConstructorOptions = {
    label: "记录诊断信息…",
    click: recordDiagnostics,
  };
  const helpSubmenu: MenuItemConstructorOptions[] =
    platform === "darwin"
      ? [recordDiagnosticsItem]
      : [
          checkForUpdatesItem,
          recordDiagnosticsItem,
          { type: "separator" },
          {
            label: `关于 ${PRODUCT_NAME}`,
            click: () => app.showAboutPanel(),
          },
        ];
  const template: MenuItemConstructorOptions[] = [
    ...(platform === "darwin"
      ? [
          {
            label: PRODUCT_NAME,
            submenu: [
              { label: `关于 ${PRODUCT_NAME}`, role: "about" },
              { type: "separator" },
              checkForUpdatesItem,
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { label: `隐藏 ${PRODUCT_NAME}`, role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { label: `退出 ${PRODUCT_NAME}`, role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "文件",
      submenu: [
        {
          label: "新建窗口",
          accelerator: "CommandOrControl+N",
          click: createWindow,
        },
        { role: "close" },
        ...(platform === "darwin"
          ? []
          : [
              { type: "separator" as const },
              settingsItem,
              { type: "separator" as const },
              { role: "quit" as const },
            ]),
      ],
    },
    platform === "darwin" ? macEditMenu : { role: "editMenu" },
    {
      label: "视图",
      submenu: [
        {
          label: "后退",
          accelerator: "CommandOrControl+[",
          click: (_item, window) => navigationHistory(window)?.goBack(),
        },
        {
          label: "前进",
          accelerator: "CommandOrControl+]",
          click: (_item, window) => navigationHistory(window)?.goForward(),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: helpSubmenu },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Electron's macOS Edit menu, except Paste and Match Style: Electron binds it
// to ⌘⌥⇧V, but browsers use ⌘⇧V.
const macEditMenu: MenuItemConstructorOptions = {
  label: "编辑",
  submenu: [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "pasteAndMatchStyle", accelerator: "CommandOrControl+Shift+V" },
    { role: "delete" },
    { role: "selectAll" },
    { type: "separator" },
    {
      label: "替换",
      submenu: [
        { role: "showSubstitutions" },
        { type: "separator" },
        { role: "toggleSmartQuotes" },
        { role: "toggleSmartDashes" },
        { role: "toggleTextReplacement" },
      ],
    },
    {
      label: "语音",
      submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
    },
  ],
};

function updateMenuLabel(updateReady: boolean, downloadPercent: number | null) {
  if (updateReady) return "重启以更新";
  if (downloadPercent === null) return "检查更新…";
  return `正在下载更新… ${downloadPercent}%`;
}

function navigationHistory(window: BaseWindow | undefined) {
  return window instanceof BrowserWindow
    ? window.webContents.navigationHistory
    : null;
}
