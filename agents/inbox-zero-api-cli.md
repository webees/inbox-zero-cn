---
name: inbox-zero-api-cli
description: 通过公共 API CLI 查看或更新 Inbox Zero 规则与分析数据。适用于涉及规则、统计或 API 驱动自动化的任务。
---

# Inbox Zero API CLI

使用 `inbox-zero-api` 时加上 `--json` 可获得稳定输出。需要认证的命令要求设置 `INBOX_ZERO_API_KEY`。

1. 查看 schema：`inbox-zero-api openapi --json`
2. 替换前先读取：`inbox-zero-api rules get <id> --json`
3. 提交完整请求体：`inbox-zero-api rules update <id> --file rule.json --json`

安装：`npm install -g @inbox-zero/api`。完整的变更流程请参阅 **inbox-zero-api** skill（`skills/inbox-zero-api/references/cli-reference.md`）。
