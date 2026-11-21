# 桌面应用

面向托管版 Inbox Zero Web 应用的 Electron 外壳。

## 运行

针对生产环境：

```sh
pnpm --filter @inboxzero/desktop dev
```

针对本地 Web 应用：

```sh
INBOX_ZERO_APP_URL=http://localhost:3000 pnpm --filter @inboxzero/desktop dev
```

登录使用系统浏览器，并通过 `inboxzero://` 返回。Web 应用的 `DESKTOP_AUTH_ORIGIN` 默认使用此 scheme。

## 多窗口

文件 → 新建窗口（⌘N / Ctrl+N）会打开另一个邮箱窗口。在账号切换器中按住 ⌘ 或 Ctrl 点击某个账号，即可在独立窗口中打开该收件箱。每个窗口各自保留账号和尺寸，并在下次启动时恢复。

点击新邮件通知时，会聚焦已显示该账号的窗口；如果没有，则打开一个新窗口。

## 邮件角标与通知

macOS Dock 角标显示所有已连接账号的未读收件箱总数，大约每分钟以及窗口获得焦点时刷新。Linux 使用受支持的启动器角标；Windows 目前不显示数字角标。

应用在后台运行时，新的未读收件箱邮件会产生原生通知。点击通知会打开该账号的收件箱。提醒不含发件人或主题预览。应用启动之前或超过五分钟的邮件会被抑制，重复的同步结果不会重放提醒。通知遵循现有的邮箱同步计划（通常约一分钟），而不是服务端推送通道。

应用必须保持运行；支持隐藏 Mac 窗口，完全退出会停止更新。macOS 通知需要已签名的应用，并在系统设置中授予通知权限。可使用操作系统通知设置关闭提醒或声音。桌面版发布和托管 Web 变更都需要；较旧的桌面版会安全地忽略新集成。

## 记录诊断信息

帮助 → 记录诊断信息… 会在用户复现卡顿期间采集 30 秒的性能数据（点击进度通知可提前停止）。它会在下载目录写入一个 `Inbox-Zero-Diagnostics-<timestamp>` 文件夹并显示出来：

- `trace.json.gz`：主进程和渲染进程的 Chromium 跟踪（时间线、任务、IPC 和采样的 JS 堆栈类别）。可在 DevTools Performance 面板或 [Perfetto](https://ui.perfetto.dev) 中打开。绘制、图层和截图类别会被排除，URL 查询字符串会被剥离。
- `diagnostics.json`：应用、Electron 和操作系统版本，各进程的 CPU 与内存、系统内存、邮件数据库文件大小，以及本地邮件引擎的同步与队列计数。其中不含邮件、主题或地址。

配置 Sentry 后，应用会提供将这两个文件作为附件发送到 `User diagnostics` 事件（标签 `area: diagnostics`），并显示事件 ID，供用户向支持团队提供。

## 打包

```sh
pnpm --filter @inboxzero/desktop dist:mac
pnpm --filter @inboxzero/desktop dist:win
```

安装包位于 `apps/desktop/release/`。macOS 打包需要 Developer ID 证书和公证凭证。

## 发布

推送 `desktop-v*` 标签即可构建并发布版本，或手动运行 [桌面版发布工作流](../../.github/workflows/desktop-release.yml) 并选择是否发布。它会为 arm64 和 x64 打包 macOS（DMG/ZIP）和 Windows（NSIS）。

macOS 发布需要以下 GitHub secrets：

- `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` — 用于签名 Mac 构建的 Developer ID Application `.p12`（base64）
- `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_API_KEY_P8` / `APPLE_TEAM_ID` — 用于公证签名构建的 Apple 凭证

Windows 发布使用 Azure Artifact Signing 签名，若未发生签名会失败。它需要：

- `AZURE_SIGNING_TENANT_ID` / `AZURE_SIGNING_CLIENT_ID` secrets：在签名账号上具有 Certificate Profile Signer 角色的 Entra 应用注册。它没有客户端密钥；任务通过 GitHub OIDC 登录，因此应用需要为 `repo:elie222/inbox-zero:environment:desktop-release` 主体配置联合凭证
- `AZURE_SIGNING_PUBLISHER_NAME` / `AZURE_SIGNING_ENDPOINT` / `AZURE_SIGNING_ACCOUNT_NAME` / `AZURE_SIGNING_CERTIFICATE_PROFILE` 变量：证书主体 CN、账号的区域端点（例如 `https://eus.codesigning.azure.net/`）、签名账号名称以及证书配置文件名称

本地 `pnpm dist:win` 构建保持未签名。

主进程的错误上报（包括渲染进程、GPU 和原生崩溃）使用可选的 `DESKTOP_SENTRY_DSN` secret，并在构建时注入为 `INBOX_ZERO_SENTRY_DSN`。没有该配置的构建（包括本地开发）不会向 Sentry 上报。

自动更新元数据（`latest-mac.yml` / `latest.yml`）发布到 `desktop-updates` 版本；安装包仍留在 `desktop-v*` 版本中。
