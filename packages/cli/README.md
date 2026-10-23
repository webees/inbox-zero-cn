# @inbox-zero/cli

CLI tool for running [Inbox Zero](https://www.getinboxzero.com) - an open-source AI email assistant.

## Installation

### Homebrew (macOS/Linux)

```bash
brew install inbox-zero/inbox-zero/inbox-zero
```

### Manual Installation

Download the binary for your platform from [releases](https://github.com/elie222/inbox-zero/releases) and add to your PATH.

## Quick Start

```bash
# Configure Inbox Zero (interactive)
inbox-zero setup

# Start Inbox Zero
inbox-zero start

# Open http://localhost:3000
```

## Commands

### `inbox-zero setup`

Interactive setup wizard that:
- Configures OAuth providers (Google/Microsoft)
- Sets up your LLM provider and API key
- Configures ports (to avoid conflicts)
- Generates all required secrets

Configuration is stored in `~/.inbox-zero/`

### `inbox-zero setup-terraform`

Generates Terraform files for AWS deployment (ECS Fargate, RDS, optional Redis).

```bash
# Generate Terraform files in ./terraform (interactive)
inbox-zero setup-terraform

# Non-interactive mode (values read from flags/env vars)
inbox-zero setup-terraform --yes --region us-east-1
```

The generated Terraform uses AWS SSM Parameter Store for secrets and outputs the
service URL after `terraform apply`.

### `inbox-zero setup-vercel`

Links a Vercel project for `apps/web`, provisions Neon and Upstash Redis using
Vercel Marketplace integrations, and seeds the required environment variables.

```bash
# Interactive Vercel setup
inbox-zero setup-vercel

# Skip provisioning an integration you already have
inbox-zero setup-vercel --skip-neon

# Non-interactive setup with defaults and placeholder provider credentials
inbox-zero setup-vercel --yes
```

如果希望 CLI 在设置完成后触发 `vercel deploy --prod`，请使用 `--deploy`。

### `inbox-zero start`

拉取最新的 Docker 镜像并启动所有容器：
- PostgreSQL 数据库
- Redis 缓存
- Inbox Zero Web 应用
- 用于邮件同步的定时任务

```bash
inbox-zero start           # Start in background
inbox-zero start --no-detach  # Start in foreground
```

### `inbox-zero stop`

停止所有正在运行的容器。

```bash
inbox-zero stop
```

### `inbox-zero logs`

查看容器日志。

```bash
inbox-zero logs            # Show last 100 lines
inbox-zero logs -f         # Follow logs
inbox-zero logs -n 500     # Show last 500 lines
```

### `inbox-zero status`

显示正在运行的容器状态。

### `inbox-zero update`

拉取最新的 Inbox Zero 镜像并可选择重启。

```bash
inbox-zero update
```

## 环境要求

- 已安装并正在运行 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- 来自 Google 和/或 Microsoft 的 OAuth 凭据
- 一个 LLM API 密钥（Anthropic、OpenAI、Google 等）

## 配置

所有配置都存储在 `~/.inbox-zero/`：
- `.env` - 环境变量
- `docker-compose.yml` - Docker Compose 配置

如需重新配置，请再次运行 `inbox-zero setup`。

## 许可证

请参阅仓库根目录下的 [LICENSE](../../LICENSE)。
