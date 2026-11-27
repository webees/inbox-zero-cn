# Inbox Zero API CLI 参考

## 安装

使用以下方式之一：

- `npm install -g @inbox-zero/api`
- `npx @inbox-zero/api --help`

可执行文件名为 `inbox-zero-api`。

## 认证与配置

- 对于需要认证的命令（如 `rules` 和 `stats`），必须设置 `INBOX_ZERO_API_KEY`。
- 对于自托管或自定义部署，`INBOX_ZERO_BASE_URL` 是可选的。
- 配置优先级为：命令行标志、环境变量、`~/.inbox-zero-api/config.json`。

示例：

```bash
inbox-zero-api config list
inbox-zero-api config get base-url
inbox-zero-api config set base-url https://your-domain.com
```

## 读取操作

```bash
inbox-zero-api openapi --json
inbox-zero-api rules list --json
inbox-zero-api rules get rule_123 --json
inbox-zero-api stats by-period --period month --json
inbox-zero-api stats response-time --json
```

## 安全的规则修改流程

1. 检查在线 schema：

```bash
inbox-zero-api openapi --json
```

2. 编辑现有规则时，先读取当前规则：

```bash
inbox-zero-api rules get rule_123 --json > rule.json
```

3. 在工作区中编辑 `rule.json`。

4. 应用完整替换：

```bash
inbox-zero-api rules update rule_123 --file rule.json --json
```

从文件创建：

```bash
inbox-zero-api rules create --file rule.json --json
```

从标准输入创建或更新：

```bash
cat rule.json | inbox-zero-api rules create --file - --json
cat rule.json | inbox-zero-api rules update rule_123 --file - --json
```

删除规则：

```bash
inbox-zero-api rules delete rule_123
```

## 说明

- `rules update` 会替换整个规则正文，而不是对单个字段打补丁。
- 对于较大的载荷，优先使用临时工作区文件而不是内联 JSON。
- 统计命令始终限定在 API 密钥所关联的收件箱账号范围内。
