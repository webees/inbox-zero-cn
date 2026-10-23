---
name: inbox-zero-api
description: 使用 Inbox Zero API CLI 检查实时 API schema、列出并管理自动化规则，并通过公开 API 读取收件箱分析数据。当任务涉及 Inbox Zero 规则、统计或 API 驱动的自动化，且可以通过 CLI 而非浏览器交互解决时使用。
homepage: https://www.getinboxzero.com/api-reference/cli
metadata: { "openclaw": { "skillKey": "inboxZeroApi", "requires": { "bins": ["inbox-zero-api"], "env": ["INBOX_ZERO_API_KEY"] }, "primaryEnv": "INBOX_ZERO_API_KEY", "install": [ { "id": "node", "kind": "node", "package": "@inbox-zero/api", "bins": ["inbox-zero-api"], "label": "安装 Inbox Zero API CLI（npm）" } ] } }
---

# Inbox Zero API CLI

当任务是通过公开 API 检查或修改 Inbox Zero 状态时，使用本技能。

## 工作流程

1. 优先使用 `--json`，让输出稳定且便于机器读取。
2. 对于需要认证的命令（`rules`、`stats` 等），把凭据保存在 `INBOX_ZERO_API_KEY` 或 OpenClaw 技能配置中。除非没有其他办法，避免把 API 密钥作为 CLI 标志传入。
3. 在创建或替换规则内容之前，用 `inbox-zero-api openapi --json` 获取实时 schema（无需 API 密钥）。
4. 在创建和更新流程中，把 JSON 写入工作区文件，或通过 stdin 管道传入。
5. 把 `rules update` 视为整体替换。如果你只想改动规则的一部分，请先读取当前规则。

## 快速开始

```bash
inbox-zero-api rules list --json
inbox-zero-api stats by-period --period week --json
inbox-zero-api openapi --json
```

如果尚未安装 CLI，可以用 OpenClaw 安装器安装，或运行 `npm install -g @inbox-zero/api`。

## Cursor

使用需要认证的命令（`rules`、`stats` 等）时设置 `INBOX_ZERO_API_KEY`；`openapi --json` 无需密钥即可使用。可通过 shell 配置文件、Cursor 环境变量或本地 env 文件设置——切勿提交密钥。安装：`npm install -g @inbox-zero/api` 或 `npx @inbox-zero/api`。

## OpenClaw 配置

在 `~/.openclaw/openclaw.json` 的 `skills.entries.inboxZeroApi.apiKey` 下设置 API 密钥，或在宿主机环境中导出 `INBOX_ZERO_API_KEY`。

仅在自托管或非标准部署时才使用 `INBOX_ZERO_BASE_URL` 或 `inbox-zero-api config set base-url <url>`。

## 参考

确切的命令模式与安全的变更流程请阅读 `references/cli-reference.md`。
