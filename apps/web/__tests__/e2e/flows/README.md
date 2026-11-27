# E2E 流程测试

使用真实账号、webhook 和 AI 处理来验证完整邮件处理流程的端到端测试。

## 概览

这些流程测试验证多步骤场景：

- **完整回复周期**：Gmail → Outlook → 规则处理 → 草稿 → 发送 → 收到回复
- **自动打标签**：邮件分类和标签应用
- **出站跟踪**：已发送邮件处理与回复跟踪
- **草稿清理**：用户发送手动回复时删除 AI 草稿

## 设置

### 1. 测试账号

你需要两个连接到测试数据库的邮箱账号：

1. **Gmail 账号** - 通过 OAuth 连接，并具有有效的 refresh token
2. **Outlook 账号** - 通过 OAuth 连接，并具有有效的 refresh token

测试设置会自动验证高级版状态，并在缺失时创建默认规则。

### 2. 所需 secrets（GitHub Actions）

在仓库中配置这些 secrets：

**E2E 专用 secrets：**

| Secret | 描述 |
|--------|-------------|
| `E2E_GMAIL_EMAIL` | Gmail 测试账号邮箱 |
| `E2E_OUTLOOK_EMAIL` | Outlook 测试账号邮箱 |
| `E2E_NGROK_AUTH_TOKEN` | 用于隧道的 ngrok 认证令牌 |

**标准应用 secrets**（与生产环境相同 - 参见 [environment-variables.md](/docs/hosting/environment-variables.md)）：

- `DATABASE_URL`, `AUTH_SECRET`, `INTERNAL_API_KEY`
- `EMAIL_ENCRYPT_SECRET`, `EMAIL_ENCRYPT_SALT`
- `REDIS_HTTP_URL`、`REDIS_HTTP_TOKEN`（`UPSTASH_REDIS_URL` 和 `UPSTASH_REDIS_TOKEN` 仍可使用）
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GOOGLE_PUBSUB_TOPIC_NAME`, `GOOGLE_PUBSUB_VERIFICATION_TOKEN`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_WEBHOOK_CLIENT_STATE`
- `LLM_API_KEY`

同时设置仓库变量 `E2E_FLOWS_ENABLED=true` 以启用该工作流。

### 3. 本地开发

本地测试时，设置等效的环境变量并运行：

```bash
RUN_E2E_FLOW_TESTS=true pnpm test-e2e:flows
```

## 运行测试

```bash
# Run all flow tests
pnpm test-e2e:flows

# Run specific test file
pnpm test-e2e:flows full-reply-cycle

# Run with verbose logging
E2E_VERBOSE=true pnpm test-e2e:flows
```

## 测试结构

```text
flows/
├── config.ts              # Configuration and environment
├── setup.ts               # Global test setup (account verification, premium check)
├── teardown.ts            # Global test teardown
├── helpers/
│   ├── accounts.ts        # Test account loading
│   ├── polling.ts         # Wait for state changes
│   ├── email.ts           # Send/receive helpers
│   ├── webhook.ts         # Webhook subscription management
│   └── logging.ts         # Debug logging
├── full-reply-cycle.test.ts
├── auto-labeling.test.ts
├── outbound-tracking.test.ts
├── draft-cleanup.test.ts
├── message-preservation.test.ts
└── sent-reply-deletion.test.ts
```

## 测试场景

### 完整回复周期

1. Gmail 向 Outlook 发送邮件
2. Outlook 通过 webhook 接收
3. 规则匹配并创建草稿
4. 用户发送草稿
5. Gmail 收到回复
6. 出站处理完成清理

### 自动打标签

- 需要回复的邮件 → 打标签 + 创建草稿
- 仅供参考的邮件 → 打标签，不创建草稿
- 感谢邮件 → 适当处理

### 出站跟踪

- SENT 文件夹 webhook 触发
- 回复跟踪更新
- 规则不会重复执行

### 草稿清理

- 用户发送手动回复时删除草稿
- 正确记录 `DraftSendLog`
- 清理会话中的多个草稿

### 已发送回复保留（sent-reply-preservation.test.ts）

测试在后续消息到达时保留已发送的回复（来自 AI 草稿）：

1. 用户 A 向用户 B 发送邮件 → 创建 AI 草稿
2. 用户 B 不编辑直接发送 AI 草稿（直接点击发送）
3. 用户 A 再次回复该会话（第 3 条消息）
4. 验证：用户 B 的已发送回复仍保留在会话中

### 邮件保留

- 发件人的后续消息不会被删除
- 用户回复后保留会话中的所有消息
- 分别测试 Gmail 和 Outlook 作为接收方

## 调试

### 日志

测试会输出带运行 ID 的详细日志：

```text
[E2E-abc123] Step 1: Sending email from Gmail to Outlook
[E2E-abc123] Email sent { messageId: "...", threadId: "..." }
[E2E-abc123] Step 2: Waiting for Outlook to receive email
```

### 详细模式

```bash
E2E_VERBOSE=true pnpm test-e2e:flows
```

## 超时

| 操作 | 超时 |
|-----------|---------|
| 邮件投递 | 90s |
| Webhook 处理 | 60s |
| 完整测试周期 | 300s |
| 轮询间隔 | 3s |

## 本地设置指南

### 快速开始

```bash
# 1. Run setup with a named config (won't overwrite your existing .env)
npm run setup -- --name e2e

# 2. Run database migrations with the E2E env
cd apps/web
pnpm prisma:migrate:e2e

# 3. Start the dev server with E2E config
pnpm dev:e2e

# 4. OAuth your test accounts at http://localhost:3000
#    - Sign in with your Gmail test account
#    - Sign out and sign in with your Outlook test account

# 5. Add test account emails to apps/web/.env.e2e:
#    E2E_GMAIL_EMAIL="your-test@gmail.com"
#    E2E_OUTLOOK_EMAIL="your-test@outlook.com"

# 6. Run the tests (loads .env.e2e automatically)
pnpm test-e2e:flows
```

### 使用本地脚本（配合 ngrok）

如需在测试中支持 webhook，请使用便捷脚本。

#### 前提条件

- **ngrok**：使用 `brew install ngrok` 安装
- **ngrok 账号**：从 [ngrok dashboard](https://dashboard.ngrok.com) 获取认证令牌
- **静态域名**（推荐）：在 ngrok 中配置一个免费静态域名，以获得一致的 webhook URL

#### 配置文件设置

创建 `~/.config/inbox-zero/.env.e2e` 并写入你的 E2E 配置：

```bash
mkdir -p ~/.config/inbox-zero
# Add your config to ~/.config/inbox-zero/.env.e2e
```

**必需变量：**

| 变量 | 描述 |
|----------|-------------|
| `E2E_NGROK_AUTH_TOKEN` | ngrok 认证令牌 |
| `E2E_GMAIL_EMAIL` | 测试 Gmail 账号邮箱 |
| `E2E_OUTLOOK_EMAIL` | 测试 Outlook 账号邮箱 |

**可选变量：**

| 变量 | 描述 |
|----------|-------------|
| `E2E_NGROK_DOMAIN` | 静态 ngrok 域名（例如 `my-e2e.ngrok-free.app`） |
| `E2E_PORT` | 运行 Next.js 的端口（默认：3000） |
| `WEBHOOK_URL` | Microsoft webhook 的公网 URL（例如 `https://your-domain.ngrok-free.app`） |

**Webhook URL 配置：**

Microsoft webhook 需要可公开访问的 URL。将 `WEBHOOK_URL` 设为你的 ngrok 域名：

```bash
# Keep NEXT_PUBLIC_BASE_URL as localhost for easy browser access
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Set WEBHOOK_URL for Microsoft webhook registration
WEBHOOK_URL=https://your-domain.ngrok-free.app
```

应用使用 `WEBHOOK_URL`（回退到 `NEXT_PUBLIC_BASE_URL`）进行 webhook 注册。

**Google Pub/Sub 配置（Gmail 作为接收方的测试需要）：**

与使用 ngrok URL 动态注册的 Microsoft webhook 不同，Gmail webhook 使用 Google Pub/Sub，并需要**固定的推送订阅 URL**，在 Google Cloud Console 中配置。

要运行以 Gmail 作为接收方的测试：

1. 前往 [Google Cloud Pub/Sub Subscriptions](https://console.cloud.google.com/cloudpubsub/subscription/list)
2. 找到你的推送订阅（在初始设置期间创建）
3. 点击 **编辑**，将 **Endpoint URL** 更新为：
   ```
   https://your-ngrok-domain.ngrok-free.app/api/google/webhook?token=YOUR_VERIFICATION_TOKEN
   ```
4. 保存订阅

**提示：** 配合静态 ngrok 域名使用 `E2E_NGROK_DOMAIN`，这样只需配置一次 Pub/Sub URL。

**标准应用 secrets**（与生产环境相同）：

- `DATABASE_URL`, `AUTH_SECRET`, `INTERNAL_API_KEY`
- `EMAIL_ENCRYPT_SECRET`, `EMAIL_ENCRYPT_SALT`
- `REDIS_HTTP_URL`、`REDIS_HTTP_TOKEN`（`UPSTASH_REDIS_URL` 和 `UPSTASH_REDIS_TOKEN` 仍可使用）
- Google OAuth 与 PubSub 凭证
- Microsoft OAuth 凭证
- AI 服务商 API 密钥（OpenAI、Anthropic 等）

#### 使用脚本运行

```bash
# Run all flow tests
./scripts/run-e2e-local.sh

# Run specific test file
./scripts/run-e2e-local.sh draft-cleanup
./scripts/run-e2e-local.sh full-reply-cycle

# Run on a custom port (useful if port 3000 is in use)
E2E_PORT=3007 ./scripts/run-e2e-local.sh
```

#### 脚本的作用

1. 从 `~/.config/inbox-zero/.env.e2e` 加载环境变量
2. 启动 ngrok 隧道（如果设置了 `E2E_NGROK_DOMAIN` 则使用静态域名）
3. 将 `WEBHOOK_URL` 导出为 ngrok URL（用于 Microsoft webhook 注册）
4. 在 `apps/web/` 中创建符号链接，使 Next.js 和 vitest 能读取环境变量
5. 启动 Next.js 开发服务器
6. 运行 E2E 流程测试
7. 退出时清理进程（Ctrl+C 或完成后）

## 故障排查

### “No account found”

测试账号不在数据库中。运行 `pnpm dev:e2e`，访问 http://localhost:3000，并用每个账号登录。

### 令牌已过期

OAuth 令牌可能会过期。运行 `pnpm dev:e2e` 并再次访问 http://localhost:3000 登录。

### 未创建草稿

检查是否配置了 AI API 密钥。测试设置会自动创建规则。

### ngrok 隧道启动失败

- 查看 `/tmp/ngrok-e2e.log` 中的错误
- 确认认证令牌正确
- 确认端口未被占用
- **会话数限制错误（ERR_NGROK_108）**：免费 ngrok 账号只允许 1 个同时会话。终止现有的 ngrok 进程：
  ```bash
  pkill -9 ngrok
  ```

### 应用健康检查失败

- 查看 `/tmp/nextjs-e2e.log` 中的错误
- 确保所有必需的环境变量都已设置

### 未收到 webhook

- 如果没有静态域名，webhook URL 每次运行都会变化
- 使用 `E2E_NGROK_DOMAIN` 以获得一致的 webhook 注册

### Gmail webhook 未触发（以 Gmail 作为接收方的测试失败）

Gmail 使用 Google Pub/Sub，需要**手动配置**推送订阅 URL：

1. 检查是否设置了 `GOOGLE_PUBSUB_TOPIC_NAME` 和 `GOOGLE_PUBSUB_VERIFICATION_TOKEN`
2. 前往 [Google Cloud Pub/Sub Subscriptions](https://console.cloud.google.com/cloudpubsub/subscription/list)
3. 确认推送订阅 URL 指向你的 ngrok 域名：
   ```
   https://your-ngrok-domain.ngrok-free.app/api/google/webhook?token=YOUR_TOKEN
   ```
4. 如果使用动态 ngrok URL，每次 ngrok 重启后都必须更新订阅 URL

**注意：** Microsoft/Outlook webhook 配合 ngrok 可自动工作，因为订阅创建时会动态设置 URL。Gmail 需要手动配置 Pub/Sub。

### Microsoft webhook 订阅失败

**“NotificationUrl references a local address”**

Microsoft 需要可公开访问的 URL。将 `WEBHOOK_URL` 设为你的 ngrok 域名：

```bash
WEBHOOK_URL=https://your-domain.ngrok-free.app
```

**“Subscription validation request failed. HTTP status code is 'NotFound'”**

Microsoft 能访问你的 ngrok URL，但 webhook 端点返回 404。这通常意味着：
- ngrok 隧道已断开（检查是否有另一个会话接管）
- Next.js 应用崩溃（检查 `/tmp/nextjs-e2e.log`）
- `.next/dev/lock` 文件残留。删除它并重启：
  ```bash
  rm -rf apps/web/.next/dev/lock
  pkill -f "next dev"
  ```

### Next.js 开发服务器锁错误

如果看到 “Unable to acquire lock”，可能有另一个实例正在运行：

```bash
rm -rf apps/web/.next/dev/lock
pkill -f "next dev"
```
