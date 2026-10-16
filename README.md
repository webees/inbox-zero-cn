> [!IMPORTANT]
> **本仓库是 AI 自动化汉化项目。** 代码与原始内容全部来自上游仓库 [elie222/inbox-zero](https://github.com/elie222/inbox-zero)，本仓库只做简体中文本地化，不维护独立功能分支。
>
> 全部译文由 **DeepSeek V4.1 Flash** 自动生成，未经人工逐条校对，可能存在误译、术语不统一或上下文偏差；功能、接口与行为请以上游英文原文为准。
>
> 本仓库会持续同步上游更新，新增内容同样由 AI 自动翻译。

[![](apps/web/app/opengraph-image.jpg)](https://www.getinboxzero.com)

<p align="center">
  <a href="https://www.getinboxzero.com">
    <h1 align="center">Inbox Zero - your 24/7 AI email assistant and email app</h1>
  </a>
  <p align="center">
    Organizes your inbox, pre-drafts replies, manages your calendar, and organizes attachments. Chat with it from Slack or Telegram to manage your inbox on the go. Open source alternative to Fyxer, but more customizable and secure. We also offer an email app, an open source alternative to Superhuman.
    <br />
    <a href="https://www.getinboxzero.com">官网</a>
    ·
    <a href="https://www.getinboxzero.com/discord">Discord</a>
    ·
    <a href="https://github.com/elie222/inbox-zero/issues">Issues</a>
  </p>
</p>

<div align="center">

![星标](https://img.shields.io/github/stars/elie222/inbox-zero?labelColor=black&style=for-the-badge&color=2563EB)
![复刻](https://img.shields.io/github/forks/elie222/inbox-zero?labelColor=black&style=for-the-badge&color=2563EB)

<a href="https://trendshift.io/repositories/6400" target="_blank"><img src="https://trendshift.io/api/badge/repositories/6400" alt="elie222%2Finbox-zero | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![Vercel OSS Program](https://vercel.com/oss/program-badge.svg)](https://vercel.com/oss)

</div>

## 使命

帮助你减少在收件箱上花费的时间，让你能专注于最重要的事情。

## 功能

Inbox Zero has two parts: an AI email assistant that works in the background on your Gmail or Outlook account, and an email client. Each works on its own.

### AI email assistant

- **AI Personal Assistant:** Organizes your inbox and pre-drafts replies in your tone and style.
- **AI Rules for email:** Explain in plain English how your AI should handle your inbox.
- **Reply Zero:** Track emails to reply to and those awaiting responses.
- **Bulk Unsubscriber:** One-click unsubscribe and archive emails you never read.
- **Bulk Archiver:** Clean up your inbox by bulk archiving old emails.
- **Cold Email Blocker:** Auto‑block cold emails.
- **Email Analytics:** Track your activity and trends over time.
- **Meeting Briefs:** Get personalized briefings before every meeting, pulling context from your email and calendar.
- **Smart Filing:** Automatically save email attachments to Google Drive or OneDrive.
- **Slack & Telegram Integration:** Chat with your AI assistant from Slack or Telegram to manage your inbox without leaving the apps you already use.

### Email client

A fast email client for Gmail and Outlook, with a split inbox, all your accounts in one place, and team comments.

- **Web and desktop:** open source. The desktop app is Electron, in [`apps/desktop`](apps/desktop).
- **iOS:** a native Swift app, not open source yet. The [App Store app](https://www.getinboxzero.com/app) can connect to your own server URL if you self-host.
- **Android:** an older React Native [Android app](https://www.getinboxzero.com/android).

在我们的[文档](https://docs.getinboxzero.com)中了解更多。

## Demo

[![Inbox Zero demo](https://image.mux.com/YeTrweHxCIM5tcBMXlvRbmDuPqL028lJrmJ3F6ZgwnDY/thumbnail.jpg?time=4.4&width=1280)](https://player.mux.com/YeTrweHxCIM5tcBMXlvRbmDuPqL028lJrmJ3F6ZgwnDY)

## 技术栈

- [Next.js](https://nextjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Prisma](https://www.prisma.io/)
- [Upstash](https://upstash.com/)
- [Turborepo](https://turbo.build/)
- [Popsy Illustrations](https://popsy.co/)

## 星标历史

[![星标历史图表](https://api.star-history.com/svg?repos=elie222/inbox-zero&type=Date)](https://www.star-history.com/#elie222/inbox-zero&Date)

## 功能请求

如需请求新功能，请提交 [GitHub issue](https://github.com/elie222/inbox-zero/issues)，或加入我们的 [Discord](https://www.getinboxzero.com/discord)。

## 开始使用

我们在 [getinboxzero.com](https://www.getinboxzero.com) 提供 Inbox Zero 的托管版本。

### 自托管

自托管 Inbox Zero 最快的方式是使用 CLI：

> **前置要求**：[Docker](https://docs.docker.com/engine/install/) 和 [Node.js](https://nodejs.org/) v24+

```bash
npx @inbox-zero/cli setup      # 一次性设置向导
npx @inbox-zero/cli start      # 启动容器
```

打开 http://localhost:3000

完整的自托管说明、生产部署、OAuth 设置和配置选项，请参阅我们的**[自托管文档](https://docs.getinboxzero.com/hosting/quick-start)**。

### 本地开发

> **前置要求**：macOS 或 Linux（Windows 上使用 WSL）、[Node.js](https://nodejs.org/) v24，以及 `package.json` 中锁定的 pnpm 版本。安装带 Compose 的 [Docker Desktop](https://docs.docker.com/desktop/)，或本地原生 PostgreSQL 和 Redis。在 macOS 上，可用 `brew install postgresql@16 redis` 安装原生服务。

```bash
git clone https://github.com/elie222/inbox-zero.git
cd inbox-zero
pnpm install
pnpm local:start
```

打开 http://localhost:3000/mail，用 Google 以 `developer@example.com` 登录，或用 Microsoft 以 `developer@outlook.test` 登录。Google 邮箱中包含演示邮件。演示用户已完成引导流程，本地开发会跳过高级版校验。

该命令会启动一个隔离的数据库、Redis 及其 HTTP 端点、两个邮件服务商模拟器、计费与邮件投递模拟器、一个 LLM 模拟器以及 Next.js。它会应用数据库迁移并等待各服务就绪。无需 OAuth 凭据或 AI API 密钥。AI 响应是预设的；此模式用于演练应用流程，而非衡量模型质量。

现有的 `.env` 文件保持不变，且会被此启动器忽略。生成的凭据、种子数据以及当前服务地址存储在 `.context/local-dev/` 下。原生数据库数据保留在那里；Docker 数据库数据保存在该检出目录专属的卷中。重启会保留数据库数据和凭据。Redis 缓存以及服务商/模拟器状态每次运行都会重新开始。

按 **Ctrl-C** 可停止应用以及此命令启动的各项服务。用相同的命令再次启动即可。如果端口 3000 被占用，请使用 `pnpm local:start --port 3001`。原生 PostgreSQL 和 Redis 在可用时会被自动选用；使用 `--backend docker` 或 `--backend native` 可显式指定。检出目录专属的环回端口可防止并发启动器冲突；崩溃后操作系统会释放该锁，过期的 PID 文件会被自动替换。各服务使用自动分配的端口，因此不会复用或停止现有的数据库和 Redis 实例。

运行 `pnpm local:start --help` 查看可用选项。如果无关进程占用了报告的锁端口，请停止该进程，或改用其他检出位置。PostgreSQL 数据必须用创建它时的同一大版本打开。如果你升级了原生 PostgreSQL 的大版本，请在启动新集群前备份或移动 `.context/local-dev/postgres`。

若要针对真实服务商进行开发，请继续使用 `pnpm setup`、你自己的环境文件和 `pnpm dev`。配置与 devcontainer 设置请参阅**[贡献指南](https://docs.getinboxzero.com/contributing)**。

## 贡献

在 [GitHub Issues](https://github.com/elie222/inbox-zero/issues) 中查看待办任务，并加入我们的 [Discord](https://www.getinboxzero.com/discord) 讨论正在进行的工作。

每次推送到 `main` 都会自动构建 Docker 镜像，并以提交 SHA 打标签（例如 `elie222/inbox-zero:abc1234`）。`latest` 标签始终指向最新的 main 构建。正式发布使用版本标签（例如 `v2.26.0`）。
