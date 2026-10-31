[![](apps/web/app/opengraph-image.jpg)](https://www.getinboxzero.com)

<p align="center">
  <a href="https://www.getinboxzero.com">
    <h1 align="center">Inbox Zero - 全天候在线的 AI 邮件助手和邮件应用</h1>
  </a>
  <p align="center">
    整理你的收件箱、预写回复、管理日历并整理附件。可通过 Slack 或 Telegram 与它聊天，随时随地管理收件箱。它是 Fyxer 的开源替代方案，但更可定制、更安全。我们还提供一款邮件应用，是 Superhuman 的开源替代方案。
    <br />
    <a href="https://www.getinboxzero.com">网站</a>
    ·
    <a href="https://www.getinboxzero.com/discord">Discord</a>
    ·
    <a href="https://github.com/elie222/inbox-zero/issues">问题反馈</a>
  </p>
</p>

<div align="center">

![星标数](https://img.shields.io/github/stars/elie222/inbox-zero?labelColor=black&style=for-the-badge&color=2563EB)
![复刻数](https://img.shields.io/github/forks/elie222/inbox-zero?labelColor=black&style=for-the-badge&color=2563EB)

<a href="https://trendshift.io/repositories/6400" target="_blank"><img src="https://trendshift.io/api/badge/repositories/6400" alt="elie222%2Finbox-zero | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![Vercel OSS Program](https://vercel.com/oss/program-badge.svg)](https://vercel.com/oss)

</div>

## 使命

帮助你减少在收件箱中花费的时间，从而专注于最重要的事。

## 功能

Inbox Zero 分为两部分：在 Gmail 或 Outlook 账号后台运行的 AI 邮件助手，以及邮件客户端。两者可各自独立使用。

### AI 邮件助手

- **AI 个人助手：**整理你的收件箱，并按你的语气和风格预写回复。
- **AI 邮件规则：**用通俗语言说明 AI 应如何处理你的收件箱。
- **Reply Zero：**跟踪需要回复的邮件和等待回复的邮件。
- **批量退订：**一键退订并归档你从不阅读的邮件。
- **批量归档：**通过批量归档旧邮件清理收件箱。
- **冷邮件拦截：**自动拦截冷邮件。
- **邮件分析：**跟踪你的活动与长期趋势。
- **会议简报：**在每次会议前获取个性化简报，从邮件和日历中提取背景信息。
- **智能归档：**自动将邮件附件保存到 Google Drive 或 OneDrive。
- **Slack 与 Telegram 集成：**在 Slack 或 Telegram 中与 AI 助手聊天，无需离开常用应用即可管理收件箱。

### 邮件客户端

适用于 Gmail 和 Outlook 的快速邮件客户端，提供拆分收件箱、集中管理所有账号以及团队评论功能。

- **Web 与桌面端：**开源。桌面应用基于 Electron，位于 [`apps/desktop`](apps/desktop)。
- **iOS：**原生 Swift 应用，尚未开源。如果你自托管，[App Store 应用](https://www.getinboxzero.com/app)可连接到你自己的服务器 URL。
- **Android：**较旧的 React Native [Android 应用](https://www.getinboxzero.com/android)。

在我们的[文档](https://docs.getinboxzero.com)中了解更多。

## 演示

[![Inbox Zero 演示](https://image.mux.com/YeTrweHxCIM5tcBMXlvRbmDuPqL028lJrmJ3F6ZgwnDY/thumbnail.jpg?time=4.4&width=1280)](https://player.mux.com/YeTrweHxCIM5tcBMXlvRbmDuPqL028lJrmJ3F6ZgwnDY)

## 技术栈

- [Next.js](https://nextjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Prisma](https://www.prisma.io/)
- [Upstash](https://upstash.com/)
- [Turborepo](https://turbo.build/)
- [Popsy 插画](https://popsy.co/)

## 星标历史

[![星标历史图表](https://api.star-history.com/svg?repos=elie222/inbox-zero&type=Date)](https://www.star-history.com/#elie222/inbox-zero&Date)

## 功能请求

如需请求新功能，请提交 [GitHub 议题](https://github.com/elie222/inbox-zero/issues)，或加入我们的 [Discord](https://www.getinboxzero.com/discord)。

## 快速开始

我们在 [getinboxzero.com](https://www.getinboxzero.com) 提供托管版 Inbox Zero。

### 自托管

自托管 Inbox Zero 最快的方式是使用 CLI：

> **前置要求**：[Docker](https://docs.docker.com/engine/install/) 和 [Node.js](https://nodejs.org/) v24+

```bash
npx @inbox-zero/cli setup      # 一次性设置向导
npx @inbox-zero/cli start      # 启动容器
```

打开 http://localhost:3000

完整的自托管说明、生产部署、OAuth 设置和配置选项请参阅我们的**[自托管文档](https://docs.getinboxzero.com/hosting/quick-start)**。

### 本地开发

> **前置要求**：macOS 或 Linux（Windows 上使用 WSL）、[Node.js](https://nodejs.org/) v24，以及 `package.json` 中固定版本的 pnpm。请安装带 Compose 的 [Docker Desktop](https://docs.docker.com/desktop/)，或安装原生 PostgreSQL 和 Redis。在 macOS 上，可使用 `brew install postgresql@16 redis` 安装原生服务。

```bash
git clone https://github.com/elie222/inbox-zero.git
cd inbox-zero
pnpm install
pnpm local:start
```

打开 http://localhost:3000/mail，以 `developer@example.com` 通过 Google 登录，或以 `developer@outlook.test` 通过 Microsoft 登录。Google 邮箱包含演示邮件。演示用户已完成引导流程，本地开发时会跳过高级版检查。

该命令会启动独立的数据库、Redis 及其 HTTP 端点、两个邮件服务商模拟器、计费和邮件投递模拟器、LLM 模拟器以及 Next.js。它会应用迁移并等待服务就绪。无需 OAuth 凭据或 AI API 密钥。AI 响应为预设内容；此模式用于验证应用流程，而非模型质量。

此启动器会保留现有 `.env` 文件不变，并忽略它们。生成的凭据、种子数据和当前服务地址存储在 `.context/local-dev/` 下。原生数据库数据保留在那里；Docker 数据库数据保留在该检出目录专用的卷中。重启会保留数据库数据和凭据。Redis 缓存和服务商/模拟器状态在每次运行时重新开始。

按 **Ctrl-C** 可停止应用和此命令启动的服务。再次使用同一命令即可启动。如果端口 3000 已被占用，请使用 `pnpm local:start --port 3001`。在可用时会选择原生 PostgreSQL 和 Redis；使用 `--backend docker` 或 `--backend native` 明确选择。检出目录专用的回环端口可防止并发启动；操作系统会在崩溃后释放该锁，过期的 PID 文件会自动替换。服务使用自动分配的端口，因此不会复用或停止现有数据库和 Redis 实例。

运行 `pnpm local:start --help` 查看选项。如果有无关进程占用了报告中的锁端口，请停止该进程或使用其他检出位置。PostgreSQL 数据必须由创建它的相同主版本打开。如果升级了原生 PostgreSQL 主版本，请在启动新集群前备份或移走 `.context/local-dev/postgres`。

如需针对真实服务商进行开发，请继续使用 `pnpm setup`、你自己的环境文件和 `pnpm dev`。配置和 devcontainer 设置请参阅**[贡献指南](https://docs.getinboxzero.com/contributing)**。

## 贡献

在 [GitHub Issues](https://github.com/elie222/inbox-zero/issues) 中查看待办任务，并加入我们的 [Discord](https://www.getinboxzero.com/discord) 讨论正在进行的工作。

Docker 镜像会在每次推送到 `main` 时自动构建，并使用提交 SHA 标记（例如 `elie222/inbox-zero:abc1234`）。`latest` 标签始终指向最新的 main 构建。正式版本会使用不带 `v` 前缀的版本号标记（例如 git 标签 `v2.30.0` → `ghcr.io/elie222/inbox-zero:2.30.0`），并附带一个次版本别名（例如 `2.30`）。
