# @inbox-zero/api

通过外部 API 管理 [Inbox Zero](https://www.getinboxzero.com) 的 CLI 工具。

此包与 `@inbox-zero/cli` 相互独立，后者专注于自托管与部署。

## 安装

### `npx`

需要 Node.js `18+`。

```bash
npx @inbox-zero/api --help
```

### 全局安装

```bash
npm install -g @inbox-zero/api
```

## 快速开始

```bash
inbox-zero-api rules list
inbox-zero-api stats by-period --period week
```

运行命令前，请在 shell 或密钥管理器中设置 `INBOX_ZERO_API_KEY`。避免将 API 密钥作为 CLI 参数传入，因为它们可能泄露到 shell 历史和进程列表中。

## 配置

配置按以下顺序加载：

1. 命令标志
2. 环境变量
3. `~/.inbox-zero-api/config.json`

支持的环境变量：

- `INBOX_ZERO_API_KEY`
- `INBOX_ZERO_BASE_URL`，用于自托管或自定义 API 部署

## 命令

### `inbox-zero-api config`

管理本地 API CLI 配置。

```bash
inbox-zero-api config list
inbox-zero-api config get base-url
```

`base-url` 是可选的。它默认为 `https://www.getinboxzero.com`，仅在自托管或非标准部署时需要设置。

### `inbox-zero-api openapi`

从已配置的 Inbox Zero 部署获取实时 OpenAPI 文档。

```bash
inbox-zero-api openapi --json
```

### `inbox-zero-api rules`

管理由 API 密钥限定范围的收件箱账号自动化规则。

```bash
inbox-zero-api rules list
inbox-zero-api rules get rule_123
inbox-zero-api rules delete rule_123
```

使用 JSON 文件或 stdin 创建或更新规则：

```bash
inbox-zero-api rules create --file rule.json
cat rule.json | inbox-zero-api rules update rule_123 --file -
```

请求正文必须符合公开 API schema。

### `inbox-zero-api stats`

从外部 API 读取分析数据。

```bash
inbox-zero-api stats by-period --period month
inbox-zero-api stats response-time --json
```

对于机器人工作流，优先使用 `--json`，以便 CLI 返回结构化输出，而不是面向人类的摘要。

## 许可证

参见仓库根目录的 [LICENSE](../../LICENSE)。
