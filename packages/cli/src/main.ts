#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { program } from "commander";
import * as p from "@clack/prompts";
import {
  generateSecret,
  generateEncryptionSecrets,
  generateEnvFile,
  isSensitiveKey,
  parseEnvFile,
  parsePortConflict,
  syncManagedComposeEnv,
  fixComposeEnvPaths,
  getComposeCommand,
  updateEnvValue,
  redactValue,
  getEnvFileName,
  type EnvConfig,
} from "./utils";
import { LLM_PROVIDER_OPTIONS, promptLlmCredentials } from "./llm";
import { runGoogleSetup } from "./setup-google";
import { runAwsSetup } from "./setup-aws";
import { runTerraformSetup } from "./setup-terraform";
import { runVercelSetup } from "./setup-vercel";
import { formatPortConfigNote, resolveSetupPorts } from "./setup-ports";
import packageJson from "../package.json" with { type: "json" };

// Detect if we're running from within the repo
function findRepoRoot(): string | null {
  const cwd = process.cwd();

  // Check if we're in project root (has apps/web directory)
  if (existsSync(resolve(cwd, "apps/web"))) {
    return cwd;
  }

  // Check if we're in apps/web
  if (existsSync(resolve(cwd, "../../apps/web"))) {
    return resolve(cwd, "../..");
  }

  return null;
}

const REPO_ROOT = findRepoRoot();

// Standalone config paths (used for production Docker mode)
const STANDALONE_CONFIG_DIR = resolve(homedir(), ".inbox-zero");
const STANDALONE_ENV_FILE = resolve(STANDALONE_CONFIG_DIR, ".env");
const STANDALONE_COMPOSE_FILE = resolve(
  STANDALONE_CONFIG_DIR,
  "docker-compose.yml",
);

// Ensure config directory exists
function ensureConfigDir(configDir: string) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// Check if Docker is available
function checkDocker(): boolean {
  const result = spawnSync("docker", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

// Check if Docker Compose is available (plugin or standalone)
function checkDockerCompose(): boolean {
  // First try the Docker CLI plugin (docker compose)
  const pluginResult = spawnSync("docker", ["compose", "version"], {
    stdio: "pipe",
  });
  if (pluginResult.status === 0) return true;

  // Fallback to standalone docker-compose binary
  const standaloneResult = spawnSync("docker-compose", ["version"], {
    stdio: "pipe",
  });
  return standaloneResult.status === 0;
}

function requireDocker() {
  if (!checkDocker()) {
    const platform = process.platform;
    let installMsg =
      "Please install Docker Desktop: https://www.docker.com/products/docker-desktop/";
    if (platform === "win32") {
      installMsg =
        "Please install Docker Desktop for Windows:\nhttps://docs.docker.com/desktop/setup/install/windows-install/";
    } else if (platform === "darwin") {
      installMsg =
        "Please install Docker Desktop for Mac:\nhttps://docs.docker.com/desktop/setup/install/mac-install/";
    } else if (platform === "linux") {
      installMsg =
        "Please install Docker Engine:\nhttps://docs.docker.com/engine/install/";
    }
    p.log.error(`Docker is not installed or not running.\n${installMsg}`);
    process.exit(1);
  }

  if (!checkDockerCompose()) {
    p.log.error(
      "Docker Compose is not available.\n" +
        "Please update Docker Desktop or install Docker Compose:\n" +
        "https://docs.docker.com/compose/install/",
    );
    process.exit(1);
  }
}

function findEnvFile(name?: string): string | null {
  const envFileName = getEnvFileName(name);

  if (REPO_ROOT) {
    const repoEnv = resolve(REPO_ROOT, "apps/web", envFileName);
    if (existsSync(repoEnv)) return repoEnv;
  }

  const standaloneEnv = resolve(STANDALONE_CONFIG_DIR, envFileName);
  if (existsSync(standaloneEnv)) return standaloneEnv;

  return null;
}

async function main() {
  stripSetupAwsDoubleDash(process.argv);

  program
    .name("inbox-zero")
    .description(
      "CLI tool for self-hosting Inbox Zero — AI email assistant.\n\n" +
        "Quick start:\n" +
        "  inbox-zero setup      Configure OAuth providers, AI provider, and Docker\n" +
        "  inbox-zero start      Start Inbox Zero\n" +
        "  inbox-zero config     View and update settings\n\n" +
        "Docs: https://docs.getinboxzero.com/self-hosting",
    )
    .version(packageJson.version, "-v, --version");

  program
    .command("setup")
    .description("Interactive setup wizard")
    .option("-n, --name <name>", "Configuration name (creates .env.<name>)")
    .action(runSetup);

  program
    .command("start")
    .description("Start Inbox Zero")
    .option("--no-detach", "Run in foreground (default: background)")
    .action(runStart);

  program.command("stop").description("Stop Inbox Zero").action(runStop);

  program
    .command("logs")
    .description("View container logs")
    .option("-f, --follow", "Follow log output", false)
    .option("-n, --tail <lines>", "Number of lines to show", "100")
    .action(runLogs);

  program
    .command("status")
    .description("Show container status")
    .action(runStatus);

  program
    .command("update")
    .description("Update to the latest version")
    .action(runUpdate);

  const configCmd = program
    .command("config")
    .description("View and update configuration")
    .option("-n, --name <name>", "Configuration name (e.g., staging)");

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const name = configCmd.opts().name;
      return runConfigSet(key, value, name);
    });

  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action((key: string) => {
      const name = configCmd.opts().name;
      return runConfigGet(key, name);
    });

  configCmd.action(() => {
    const name = configCmd.opts().name;
    return runConfigInteractive(name);
  });

  program
    .command("setup-google")
    .description(
      "Set up Google Cloud APIs, OAuth, and Pub/Sub using gcloud CLI",
    )
    .option("--project-id <id>", "Google Cloud project ID")
    .option("--domain <domain>", "Your app domain (e.g., app.example.com)")
    .option("--skip-oauth", "Skip OAuth credential setup guidance")
    .option("--skip-pubsub", "Skip Pub/Sub setup")
    .action(runGoogleSetup);

  program
    .command("setup-aws")
    .description("Deploy Inbox Zero to AWS using Copilot (ECS/Fargate)")
    .option("--profile <profile>", "AWS CLI profile to use")
    .option("--region <region>", "AWS region")
    .option("--environment <env>", "Environment name (e.g., production)")
    .option("-y, --yes", "Non-interactive mode with defaults")
    .action(runAwsSetup);

  program
    .command("setup-terraform")
    .description("Generate Terraform files for AWS deployment")
    .option("--output-dir <dir>", "Output directory for Terraform files")
    .option("--environment <env>", "Environment name (e.g., production)")
    .option("--region <region>", "AWS region")
    .option(
      "--base-url <url>",
      "Public base URL (e.g., https://app.example.com)",
    )
    .option("--domain-name <domain>", "Domain name for DNS/HTTPS")
    .option("--acm-certificate-arn <arn>", "ACM certificate ARN for HTTPS")
    .option("--route53-zone-id <id>", "Route53 hosted zone ID for DNS")
    .option("--rds-instance-class <class>", "RDS instance class")
    .option("--enable-redis", "Provision ElastiCache Redis")
    .option("--redis-instance-class <class>", "Redis instance class")
    .option("--llm-provider <provider>", "Default LLM provider")
    .option("--llm-model <model>", "Default LLM model")
    .option("--llm-api-key <key>", "Shared LLM API key")
    .option("--google-client-id <id>", "Google OAuth client ID")
    .option("--google-client-secret <secret>", "Google OAuth client secret")
    .option("--google-pubsub-topic-name <name>", "Google Pub/Sub topic name")
    .option("--bedrock-access-key <key>", "AWS access key for Bedrock")
    .option("--bedrock-secret-key <key>", "AWS secret key for Bedrock")
    .option("--bedrock-region <region>", "AWS region for Bedrock")
    .option("--ollama-base-url <url>", "Ollama base URL")
    .option("--ollama-model <model>", "Ollama model name")
    .option(
      "--openai-compatible-base-url <url>",
      "OpenAI-compatible server base URL",
    )
    .option(
      "--openai-compatible-model <model>",
      "OpenAI-compatible server model name",
    )
    .option("--microsoft-client-id <id>", "Microsoft OAuth client ID")
    .option(
      "--microsoft-client-secret <secret>",
      "Microsoft OAuth client secret",
    )
    .option("-y, --yes", "Non-interactive mode with defaults")
    .action(runTerraformSetup);

  program
    .command("setup-vercel")
    .description(
      "Link a Vercel project, provision Neon + Upstash, and seed required env vars",
    )
    .option("--project <name>", "Vercel project name")
    .option("--scope <scope>", "Vercel team or personal scope")
    .option("--region <region>", "Shared Neon/Upstash region (e.g. iad1)")
    .option(
      "--base-url <url>",
      "Production URL to store in NEXT_PUBLIC_BASE_URL",
    )
    .option("--skip-neon", "Skip provisioning Neon")
    .option("--skip-upstash", "Skip provisioning Upstash Redis")
    .option("--deploy", "Deploy to production after setup")
    .option("-y, --yes", "Non-interactive mode with defaults/placeholders")
    .action((options) =>
      runVercelSetup({
        ...options,
        projectDir: REPO_ROOT ? resolve(REPO_ROOT, "apps/web") : process.cwd(),
      }),
    );

  // Default to help if no command
  if (process.argv.length === 2) {
    program.help();
  }

  await program.parseAsync();
}

function stripSetupAwsDoubleDash(argv: string[]) {
  const commandIndex = argv.indexOf("setup-aws");
  if (commandIndex === -1) return;
  const dashIndex = argv.indexOf("--", commandIndex + 1);
  if (dashIndex !== -1) {
    argv.splice(dashIndex, 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 设置命令
// ═══════════════════════════════════════════════════════════════════════════

async function runSetup(options: { name?: string }) {
  p.intro("Inbox Zero 设置");
  if (process.platform === "win32") {
    p.log.info("在 PowerShell 中运行 setup 打印出的 Docker 命令。");
  }
  p.note(
    "快速设置使用生产环境默认配置，搭配 Docker Compose 基础设施\n" +
      "（Postgres + Redis），并在 Docker 中运行 Web 应用。",
    "快速设置包含内容",
  );

  const mode = await p.select({
    message: "你想如何设置？",
    options: [
      {
        value: "quick",
        label: "快速设置",
        hint: "使用 Docker Postgres + Redis 的生产环境默认配置",
      },
      {
        value: "custom",
        label: "自定义设置",
        hint: "配置基础设施、服务提供商等",
      },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel("设置已取消。");
    process.exit(0);
  }

  if (mode === "custom") {
    return runSetupAdvanced(options);
  }
  return runSetupQuick(options);
}

// ═══════════════════════════════════════════════════════════════════════════
// 快速设置（最少问题）
// ═══════════════════════════════════════════════════════════════════════════

async function runSetupQuick(options: { name?: string }) {
  const configName = options.name;

  requireDocker();
  const { webPort, postgresPort, redisPort, redisHttpPort, changedPorts } =
    await resolveSetupPorts({ useDockerInfra: true });
  const portConfigNote = formatPortConfigNote(changedPorts);
  if (portConfigNote) {
    p.note(portConfigNote, "端口配置");
  }

  p.note(
    "选择你现在要启用的邮件服务商。\n" +
      "之后可以用 inbox-zero config 添加或更改服务商",
    "第 1 步：OAuth 服务商",
  );

  const oauthProviders = await p.multiselect({
    message: "你想配置哪些 OAuth 服务商？",
    options: [
      { value: "google", label: "Google (Gmail)" },
      { value: "microsoft", label: "Microsoft (Outlook)" },
    ],
    required: true,
  });

  if (p.isCancel(oauthProviders)) {
    p.cancel("设置已取消。");
    process.exit(0);
  }

  const wantsGoogle = oauthProviders.includes("google");
  const wantsMicrosoft = oauthProviders.includes("microsoft");

  let googleClientId = "";
  let googleClientSecret = "";
  if (wantsGoogle) {
    const callbackUrl = `http://localhost:${webPort}/api/auth/callback/google`;
    const linkingCallbackUrl = `http://localhost:${webPort}/api/google/linking/callback`;

    p.note(
      "连接 Gmail 需要一个 Google OAuth 应用。\n\n" +
        "首先启用所需的 API（否则登录会失败）：\n" +
        "1. 打开：https://console.cloud.google.com/apis/library\n" +
        "2. 为你的项目启用以下每一项：\n" +
        "   - Gmail API (gmail.googleapis.com)\n" +
        "   - People API (people.googleapis.com)\n" +
        "   - Google Calendar API（可选）\n" +
        "   - Google Drive API（可选）\n\n" +
        "然后设置 OAuth 同意屏幕：\n" +
        "3. 打开：https://console.cloud.google.com/apis/credentials/consent\n" +
        '4. 点击 "Get Started"（如果显示）\n' +
        "5. 用户类型：\n" +
        '   - "Internal" — 仅限 Google Workspace，所有组织成员都可以登录\n' +
        '   - "External" — 适用于任何 Google 账号（包括个人 Gmail）\n' +
        "     你需要把自己添加为测试用户（第 8 步）\n" +
        "6. 填写应用名称和你的邮箱\n" +
        '7. 在范围（scopes）部分依次点击 "Save and Continue"\n' +
        "8. 如果是 External：把你的邮箱添加为测试用户\n" +
        "9. 完成向导\n\n" +
        "然后创建 OAuth 凭据：\n" +
        "10. 打开：https://console.cloud.google.com/apis/credentials\n" +
        `11. 点击 "Create Credentials" → "OAuth client ID"\n` +
        `12. 选择 "Web application"\n` +
        `13. 在 "Authorized redirect URIs" 下添加：\n` +
        `    ${callbackUrl}\n` +
        `    ${linkingCallbackUrl}\n` +
        "14. 复制客户端 ID 和客户端密钥\n\n" +
        '如果是 External：登录时会看到 "This app isn\'t verified" 警告。\n' +
        '点击 "Advanced"，然后点击 "Go to [app name]" 继续。\n\n' +
        "提示：如果你安装了 gcloud CLI，可以运行 'inbox-zero setup-google'\n" +
        "来自动启用 API 并设置 Pub/Sub。\n\n" +
        "完整指南：https://docs.getinboxzero.com/hosting/setup-guides",
      "Google OAuth",
    );

    const googleClientIdResult = await p.text({
      message: "Google 客户端 ID",
      placeholder: "paste your Client ID here",
    });
    if (p.isCancel(googleClientIdResult)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    googleClientId = googleClientIdResult;

    const googleClientSecretResult = await p.text({
      message: "Google 客户端密钥",
      placeholder: "paste your Client Secret here",
    });
    if (p.isCancel(googleClientSecretResult)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    googleClientSecret = googleClientSecretResult;
  }

  let microsoftClientId = "";
  let microsoftClientSecret = "";
  let microsoftTenantId = "common";
  if (wantsMicrosoft) {
    const microsoftCallbackUrl = `http://localhost:${webPort}/api/auth/callback/microsoft`;
    const microsoftLinkingCallbackUrl = `http://localhost:${webPort}/api/outlook/linking/callback`;
    const microsoftCalendarCallbackUrl = `http://localhost:${webPort}/api/outlook/calendar/callback`;

    p.note(
      "You need a Microsoft app registration to connect Outlook.\n\n" +
        "1. Open: https://portal.azure.com/\n" +
        "2. Go to App registrations → New registration\n" +
        '3. Set account type to "Accounts in any organizational directory and personal Microsoft accounts"\n' +
        "4. Add redirect URIs:\n" +
        `   ${microsoftCallbackUrl}\n` +
        `   ${microsoftLinkingCallbackUrl}\n` +
        `   ${microsoftCalendarCallbackUrl}\n` +
        "5. Go to Certificates & secrets → New client secret\n" +
        "6. Copy Application (client) ID and secret value\n\n" +
        'Tenant ID tip: use "common" for most setups.\n' +
        "Use a specific tenant ID only if your organization requires\n" +
        "single-tenant sign-in.\n\n" +
        "Full guide: https://docs.getinboxzero.com/hosting/setup-guides#microsoft-oauth-setup",
      "Microsoft OAuth",
    );

    const microsoftOAuth = await p.group(
      {
        clientId: () =>
          p.text({
            message: "Microsoft 客户端 ID",
            placeholder: "paste your Client ID here",
          }),
        clientSecret: () =>
          p.text({
            message: "Microsoft 客户端密钥",
            placeholder: "paste your Client Secret here",
          }),
        tenantId: () =>
          p.text({
            message:
              'Microsoft Tenant ID (default: "common"; use specific tenant for single-tenant orgs)',
            placeholder: "common",
            initialValue: "common",
          }),
      },
      {
        onCancel: () => {
          p.cancel("Setup cancelled.");
          process.exit(0);
        },
      },
    );

    microsoftClientId = microsoftOAuth.clientId || "";
    microsoftClientSecret = microsoftOAuth.clientSecret || "";
    microsoftTenantId = microsoftOAuth.tenantId || "common";
  }

  // ── AI Provider ──

  p.note("Choose which AI service will process your emails.", "AI Provider");

  const llmProvider = await p.select({
    message: "AI Provider",
    options: [...LLM_PROVIDER_OPTIONS],
  });
  if (p.isCancel(llmProvider)) cancelSetup();
  const selectedLlmProvider = String(llmProvider);

  // Gather LLM credentials before generating config
  const llmEnv: EnvConfig = {};
  await promptLlmCredentials(selectedLlmProvider, llmEnv);

  // Generate token early so we can show it in the instructions
  const pubsubVerificationToken = generateSecret(32);
  let pubsubTopic = "";

  if (wantsGoogle) {
    p.note(
      "Google Pub/Sub enables real-time email notifications.\n\n" +
        "1. Go to: https://console.cloud.google.com/cloudpubsub/topic/list\n" +
        '2. Create a topic (e.g., "inbox-zero-emails")\n' +
        "3. Grant Gmail publish access to your topic:\n" +
        "   - Add principal: gmail-api-push@system.gserviceaccount.com\n" +
        '   - Role: "Pub/Sub Publisher"\n' +
        "4. Create a push subscription using this endpoint:\n" +
        `   https://yourdomain.com/api/google/webhook?token=${pubsubVerificationToken}\n` +
        "5. Paste the topic name below (or press Enter to skip for now)\n\n" +
        "Full guide: https://docs.getinboxzero.com/hosting/setup-guides#google-pubsub-setup",
      "Google Pub/Sub (optional)",
    );

    const pubsubTopicResult = await p.text({
      message: "Google Pub/Sub Topic Name",
      placeholder: "projects/your-project-id/topics/inbox-zero-emails",
      validate: (v) => {
        if (!v) return;
        if (!v.startsWith("projects/") || !v.includes("/topics/")) {
          return "Topic name must be in format: projects/PROJECT_ID/topics/TOPIC_NAME";
        }
        return;
      },
    });

    if (p.isCancel(pubsubTopicResult)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    pubsubTopic = pubsubTopicResult;
  }

  // ── Generate config ──

  // Determine file paths first so we can read existing config
  const configDir = REPO_ROOT ?? STANDALONE_CONFIG_DIR;
  const envFileName = getEnvFileName(configName);
  const envFile = REPO_ROOT
    ? resolve(REPO_ROOT, "apps/web", envFileName)
    : resolve(STANDALONE_CONFIG_DIR, envFileName);
  const composeFile = REPO_ROOT
    ? resolve(REPO_ROOT, "docker-compose.yml")
    : STANDALONE_COMPOSE_FILE;

  const composeCmd = getComposeCommand(envFile, composeFile);

  ensureConfigDir(configDir);

  // Check if already configured
  if (existsSync(envFile)) {
    const overwrite = await p.confirm({
      message: "Existing configuration found. Overwrite it?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled. Existing configuration preserved.");
      process.exit(0);
    }
  }

  const spinner = p.spinner();
  spinner.start("Generating configuration...");

  // Reuse existing database password to avoid mismatch with Docker volume
  const existingEnv = readExistingEnv(envFile);

  const redisToken = generateSecret(32);
  const dbPassword = existingEnv.POSTGRES_PASSWORD || generateSecret(16);
  const env: EnvConfig = {
    NODE_ENV: "production",
    // Database (Docker internal networking)
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: dbPassword,
    POSTGRES_DB: "inboxzero",
    POSTGRES_PORT: postgresPort,
    REDIS_PORT: redisPort,
    REDIS_HTTP_PORT: redisHttpPort,
    WEB_PORT: webPort,
    DATABASE_URL: `postgresql://postgres:${encodeURIComponent(dbPassword)}@db:5432/inboxzero`,
    REDIS_HTTP_TOKEN: redisToken,
    REDIS_HTTP_URL: "http://serverless-redis-http:80",
    QUEUE_BACKEND: "internal",
    INTERNAL_API_URL: "http://web:3000",
    // Secrets
    AUTH_SECRET: generateSecret(32),
    ...generateEncryptionSecrets(existingEnv),
    INTERNAL_API_KEY: generateSecret(32),
    API_KEY_SALT: generateSecret(32),
    CRON_SECRET: generateSecret(32),
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: pubsubVerificationToken,
    // Google OAuth
    GOOGLE_CLIENT_ID: wantsGoogle
      ? googleClientId || "your-google-client-id"
      : "skipped",
    GOOGLE_CLIENT_SECRET: wantsGoogle
      ? googleClientSecret || "your-google-client-secret"
      : "skipped",
    GOOGLE_PUBSUB_TOPIC_NAME:
      pubsubTopic || "projects/your-project-id/topics/inbox-zero-emails",
    // Microsoft OAuth
    MICROSOFT_CLIENT_ID: wantsMicrosoft
      ? microsoftClientId || "your-microsoft-client-id"
      : undefined,
    MICROSOFT_CLIENT_SECRET: wantsMicrosoft
      ? microsoftClientSecret || "your-microsoft-client-secret"
      : undefined,
    MICROSOFT_TENANT_ID: wantsMicrosoft ? microsoftTenantId : undefined,
    MICROSOFT_WEBHOOK_CLIENT_STATE: wantsMicrosoft
      ? generateSecret(32)
      : undefined,
    // LLM
    ...llmEnv,
    // App
    NEXT_PUBLIC_BASE_URL: `http://localhost:${webPort}`,
    NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS: "true",
  };

  env.DIRECT_URL = env.DATABASE_URL;

  // Fetch docker-compose.yml if not in the repo
  if (!REPO_ROOT) {
    try {
      let composeContent = await fetchDockerCompose();
      composeContent = fixComposeEnvPaths(composeContent);
      writeFileSync(composeFile, composeContent);
    } catch {
      spinner.stop("Failed to download Docker setup");
      p.log.error(
        "Could not fetch docker-compose.yml from GitHub.\n" +
          "Please check your internet connection and try again.",
      );
      process.exit(1);
    }
  }

  // Write .env from template
  let template: string;
  try {
    template = await getEnvTemplate();
  } catch {
    spinner.stop("Failed to fetch configuration template");
    p.log.error("Could not fetch .env.example template.");
    process.exit(1);
  }

  const envContent = generateEnvFile({
    env,
    useDockerInfra: true,
    llmProvider: selectedLlmProvider,
    template,
    composeEnvFile: REPO_ROOT
      ? `./apps/web/${envFileName}`
      : `./${envFileName}`,
  });
  saveEnvFile(envFile, envContent);

  spinner.stop("Configuration ready");

  // ── Step 3: Start ──

  p.note(
    `Environment file: ${envFile}\nDocker Compose: ${composeFile}`,
    "Files created",
  );

  const shouldStart = await p.confirm({
    message: "现在启动 Inbox Zero 吗？",
    initialValue: true,
  });

  if (p.isCancel(shouldStart) || !shouldStart) {
    p.note(
      `Start later with:\n  ${composeCmd} --profile all up -d\n\n` +
        `Update settings with:\n  inbox-zero config${configName ? ` --name ${configName}` : ""}`,
      "Next steps",
    );
    p.outro("Setup complete!");
    return;
  }

  // Explicit files keep CLI setup independent of the caller's working directory.
  const composeArgs = ["compose", "--env-file", envFile, "-f", composeFile];

  if (checkContainersRunning(composeArgs)) {
    const restart = await p.confirm({
      message: "Inbox Zero 已在运行，要重启吗？",
      initialValue: true,
    });
    if (p.isCancel(restart) || !restart) {
      p.note(
        `Inbox Zero is still running at http://localhost:${webPort}`,
        "Already running",
      );
      p.outro("Setup complete!");
      return;
    }
    const stopSpinner = p.spinner();
    stopSpinner.start("Stopping existing containers...");
    await runDockerCommand([...composeArgs, "down"]);
    stopSpinner.stop("Stopped");
  }

  // Pull and start
  const pullSpinner = p.spinner();
  pullSpinner.start("Pulling Docker images (this may take a minute)...");

  const pullResult = await runDockerCommand([...composeArgs, "pull"]);

  if (pullResult.status !== 0) {
    pullSpinner.stop("Failed to pull images");
    p.log.error(pullResult.stderr || "Unknown error");
    p.log.info(
      `You can try again later with: ${composeCmd} --profile all up -d`,
    );
    process.exit(1);
  }

  pullSpinner.stop("Images pulled");

  const startSpinner = p.spinner();
  startSpinner.start("Starting Inbox Zero...");

  const upResult = await runDockerCommand([
    ...composeArgs,
    "--profile",
    "all",
    "up",
    "-d",
  ]);

  if (upResult.status !== 0) {
    const portError = parsePortConflict(upResult.stderr);
    startSpinner.stop("Failed to start");
    if (portError) {
      p.log.error(portError);
      p.log.info(
        "Stop the conflicting process or update the port mapping\n" +
          "in your .env file and docker-compose.yml, then retry.",
      );
    } else {
      p.log.error(upResult.stderr || "Unknown error");
    }
    p.log.info(`You can try again with: ${composeCmd} --profile all up -d`);
    process.exit(1);
  }

  startSpinner.stop("Inbox Zero is running!");

  p.note(
    `Open http://localhost:${webPort} to get started.\n\n` +
      "Useful commands:\n" +
      "  inbox-zero config    — update settings (e.g. add Pub/Sub token)\n" +
      "  inbox-zero logs -f   — view live logs\n" +
      "  inbox-zero stop      — stop the app\n" +
      "  inbox-zero update    — update to latest version",
    "You're all set!",
  );

  p.outro("Inbox Zero is ready!");
}

// ═══════════════════════════════════════════════════════════════════════════
// Advanced Setup (full options)
// ═══════════════════════════════════════════════════════════════════════════

async function runSetupAdvanced(options: { name?: string }) {
  const configName = options.name;
  p.intro(`🚀 Inbox Zero Setup${configName ? ` (${configName})` : ""}`);

  // Ask about environment mode
  const envMode = await p.select({
    message: "What environment are you setting up?",
    options: [
      {
        value: "production",
        label: "Production",
        hint: "deployed or self-hosted (recommended)",
      },
      {
        value: "development",
        label: "Development",
        hint: "local dev with pnpm dev",
      },
    ],
  });

  if (p.isCancel(envMode)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const isDevMode = envMode === "development";

  // Ask about infrastructure
  p.note(
    "Recommended for first-time self-hosting: use Docker Compose for Postgres/Redis.\n" +
      "Then run everything in Docker unless you plan to run the web app from this repo with pnpm.",
    "Infrastructure Recommendation",
  );

  const infraChoice = await p.select({
    message: "How do you want to run PostgreSQL and Redis?",
    options: [
      {
        value: "docker",
        label: "Docker Compose",
        hint: "recommended for most self-hosted setups",
      },
      {
        value: "external",
        label: "External / Bring your own",
        hint: "use existing managed Postgres + Redis",
      },
    ],
  });

  if (p.isCancel(infraChoice)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const useDockerInfra = infraChoice === "docker";

  // Ask if running full stack in Docker (only relevant for Docker infra)
  let runWebInDocker = false;
  if (useDockerInfra) {
    if (!REPO_ROOT) {
      runWebInDocker = true;
      p.note(
        "You're running setup outside the source repo, so the web app will run in Docker.\n" +
          "If you want to run Next.js with pnpm, clone the repo and run setup there.",
        "Web Runtime",
      );
    } else {
      const fullStackDocker = await p.select({
        message: "Do you want to run the full stack in Docker?",
        options: [
          {
            value: "yes",
            label: "Yes, everything in Docker",
            hint: "recommended for production: docker compose --profile all",
          },
          {
            value: "no",
            label: "No, just database & Redis",
            hint: "run Next.js separately with pnpm (repo mode only)",
          },
        ],
      });

      if (p.isCancel(fullStackDocker)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      runWebInDocker = fullStackDocker === "yes";
    }
  }

  if (useDockerInfra) {
    requireDocker();
  }

  // Determine paths - if in repo, write to apps/web/.env, otherwise use standalone
  const configDir = REPO_ROOT ?? STANDALONE_CONFIG_DIR;
  const envFileName = getEnvFileName(configName);
  const envFile = REPO_ROOT
    ? resolve(REPO_ROOT, "apps/web", envFileName)
    : resolve(STANDALONE_CONFIG_DIR, envFileName);
  const composeFile = REPO_ROOT
    ? resolve(REPO_ROOT, "docker-compose.yml")
    : STANDALONE_COMPOSE_FILE;

  ensureConfigDir(configDir);

  // Check if already configured
  if (existsSync(envFile)) {
    const overwrite = await p.confirm({
      message: ".env file already exists. Overwrite it?",
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled. Existing configuration preserved.");
      process.exit(0);
    }
  }

  const pubsubVerificationToken = generateSecret(32);
  const existingEnv = readExistingEnv(envFile);
  const env: EnvConfig = {};
  const { webPort, postgresPort, redisPort, redisHttpPort, changedPorts } =
    await resolveSetupPorts({ useDockerInfra });
  const portConfigNote = formatPortConfigNote(changedPorts);
  if (portConfigNote) {
    p.note(portConfigNote, "Port Configuration");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OAuth Providers
  // ═══════════════════════════════════════════════════════════════════════════

  p.note(
    "Choose which email providers to support.\nPress Enter to skip any field and add it later.",
    "OAuth Configuration",
  );

  const oauthProviders = await p.multiselect({
    message: "Which OAuth providers do you want to configure?",
    options: [
      { value: "google", label: "Google (Gmail)" },
      { value: "microsoft", label: "Microsoft (Outlook)" },
    ],
    required: true,
  });

  if (p.isCancel(oauthProviders)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const wantsGoogle = oauthProviders.includes("google");
  const wantsMicrosoft = oauthProviders.includes("microsoft");

  // Google OAuth
  if (wantsGoogle) {
    p.note(
      `1. Enable required APIs (Gmail, People; Calendar/Drive optional):
   https://console.cloud.google.com/apis/library
2. Configure the OAuth consent screen:
   https://console.cloud.google.com/apis/credentials/consent
   Click "Get Started" if shown, then complete the wizard.
3. Create OAuth 2.0 Client ID (Web application):
   https://console.cloud.google.com/apis/credentials
4. Add redirect URIs:
   - http://localhost:${webPort}/api/auth/callback/google
   - http://localhost:${webPort}/api/google/linking/callback
5. Copy Client ID and Client Secret

Tip: with the gcloud CLI installed, run 'inbox-zero setup-google'
to enable APIs and provision Pub/Sub automatically.

Full guide: https://docs.getinboxzero.com/self-hosting/google-oauth`,
      "Google OAuth Setup",
    );

    const googleOAuth = await p.group(
      {
        clientId: () =>
          p.text({
            message: "Google 客户端 ID（按 Enter 跳过）",
            placeholder: "123456789012-abcdefghijk.apps.googleusercontent.com",
          }),
        clientSecret: () =>
          p.text({
            message: "Google 客户端密钥（按 Enter 跳过）",
            placeholder: "GOCSPX-...",
          }),
      },
      {
        onCancel: () => {
          p.cancel("配置已取消");
          process.exit(0);
        },
      },
    );

    env.GOOGLE_CLIENT_ID = googleOAuth.clientId || "your-google-client-id";
    env.GOOGLE_CLIENT_SECRET =
      googleOAuth.clientSecret || "your-google-client-secret";

    // 用于实时邮件通知的 Google Pub/Sub 配置
    p.note(
      `要接收实时邮件通知，你需要配置 Google Pub/Sub：

1. 打开 Google Cloud Console：https://console.cloud.google.com/cloudpubsub/topic/list
2. 创建一个新主题（例如 "inbox-zero-emails"）
3. 将 Gmail API 服务账号添加为发布者：
   - 点击该主题 → 权限 → 添加主账号
   - 添加：gmail-api-push@system.gserviceaccount.com
   - 角色：Pub/Sub Publisher
4. 创建一个指向你的 webhook URL 的推送订阅：
   - 端点：https://yourdomain.com/api/google/webhook?token=${pubsubVerificationToken}
5. 复制完整的主题名称（例如 projects/my-project-123/topics/inbox-zero-emails）

完整指南：https://docs.getinboxzero.com/self-hosting/google-pubsub`,
      "Google Pub/Sub 配置（Gmail 必需）",
    );

    const pubsubTopic = await p.text({
      message: "Google Pub/Sub 主题名称",
      placeholder: "projects/your-project-id/topics/inbox-zero-emails",
      validate: (v) => {
        if (!v) return; // 允许留空以跳过
        if (!v.startsWith("projects/") || !v.includes("/topics/")) {
          return "主题名称格式必须为：projects/PROJECT_ID/topics/TOPIC_NAME";
        }
        return;
      },
    });

    if (p.isCancel(pubsubTopic)) {
      p.cancel("配置已取消");
      process.exit(0);
    }

    env.GOOGLE_PUBSUB_TOPIC_NAME =
      pubsubTopic || "projects/your-project-id/topics/inbox-zero-emails";
  } else {
    env.GOOGLE_CLIENT_ID = "skipped";
    env.GOOGLE_CLIENT_SECRET = "skipped";
  }

  // Microsoft OAuth
  if (wantsMicrosoft) {
    p.note(
      `1. 打开 Azure 门户：https://portal.azure.com/
2. 进入应用注册 → 新注册
3. 设置账户类型："任何组织目录中的账户和个人 Microsoft 账户"
4. 添加重定向 URI：
   - http://localhost:${webPort}/api/auth/callback/microsoft
   - http://localhost:${webPort}/api/outlook/linking/callback
   - http://localhost:${webPort}/api/outlook/calendar/callback（仅日历集成需要）
5. 进入证书和密码 → 新客户端密码
6. 复制应用程序（客户端）ID 和密码值

完整指南：https://docs.getinboxzero.com/self-hosting/microsoft-oauth`,
      "Microsoft OAuth 配置",
    );

    const microsoftOAuth = await p.group(
      {
        clientId: () =>
          p.text({
            message: "Microsoft 客户端 ID（按 Enter 跳过）",
            placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          }),
        clientSecret: () =>
          p.text({
            message: "Microsoft 客户端密钥（按 Enter 跳过）",
            placeholder: "你的客户端密钥",
          }),
        tenantId: () =>
          p.text({
            message: "Microsoft 租户 ID",
            placeholder: "common",
            initialValue: "common",
          }),
      },
      {
        onCancel: () => {
          p.cancel("配置已取消");
          process.exit(0);
        },
      },
    );

    env.MICROSOFT_CLIENT_ID =
      microsoftOAuth.clientId || "your-microsoft-client-id";
    env.MICROSOFT_CLIENT_SECRET =
      microsoftOAuth.clientSecret || "your-microsoft-client-secret";
    env.MICROSOFT_TENANT_ID = microsoftOAuth.tenantId || "common";
    env.MICROSOFT_WEBHOOK_CLIENT_STATE = generateSecret(32);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM 服务提供商
  // ═══════════════════════════════════════════════════════════════════════════

  p.note("选择你的 AI 服务提供商。你之后可以在设置中更改。", "LLM 配置");

  const llmProvider = await p.select({
    message: "LLM 服务提供商",
    options: [...LLM_PROVIDER_OPTIONS],
  });
  if (p.isCancel(llmProvider)) cancelSetup();
  const selectedLlmProvider = String(llmProvider);

  await promptLlmCredentials(selectedLlmProvider, env);

  // ═══════════════════════════════════════════════════════════════════════════
  // 自动生成的值
  // ═══════════════════════════════════════════════════════════════════════════

  const spinner = p.spinner();
  spinner.start("正在生成配置...");

  // 根据环境模式设置 NODE_ENV
  env.NODE_ENV = isDevMode ? "development" : "production";

  // Redis token（用于 Docker Redis）
  const redisToken = generateSecret(32);

  if (useDockerInfra) {
    // 使用 Docker Compose 运行 Postgres/Redis
    env.POSTGRES_USER = "postgres";
    env.POSTGRES_PASSWORD =
      existingEnv.POSTGRES_PASSWORD ||
      (isDevMode ? "password" : generateSecret(16));
    env.POSTGRES_DB = "inboxzero";
    env.POSTGRES_PORT = postgresPort;
    env.REDIS_PORT = redisPort;
    env.REDIS_HTTP_PORT = redisHttpPort;
    env.WEB_PORT = webPort;
    env.REDIS_HTTP_TOKEN = redisToken;
    env.QUEUE_BACKEND = "internal";

    if (runWebInDocker) {
      // Web app runs in Docker: use container hostnames
      env.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@db:5432/${env.POSTGRES_DB}`;
      env.DIRECT_URL = env.DATABASE_URL;
      env.REDIS_HTTP_URL = "http://serverless-redis-http:80";
      env.INTERNAL_API_URL = "http://web:3000";
    } else {
      // Web app runs on host: containers expose ports to localhost
      env.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@localhost:${postgresPort}/${env.POSTGRES_DB}`;
      env.DIRECT_URL = env.DATABASE_URL;
      env.REDIS_HTTP_URL = `http://localhost:${redisHttpPort}`;
      env.INTERNAL_API_URL = `http://localhost:${webPort}`;
    }
  } else {
    // External infrastructure - set placeholders for user to fill in
    env.DATABASE_URL = "postgresql://user:password@your-host:5432/inboxzero";
    env.DIRECT_URL = env.DATABASE_URL;
    env.REDIS_HTTP_URL = "https://your-redis-url";
    env.REDIS_HTTP_TOKEN = "your-redis-token";
  }

  // Secrets (same for both modes)
  env.AUTH_SECRET = generateSecret(32);
  Object.assign(env, generateEncryptionSecrets(existingEnv));
  env.INTERNAL_API_KEY = generateSecret(32);
  env.API_KEY_SALT = generateSecret(32);
  env.CRON_SECRET = generateSecret(32);
  env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = pubsubVerificationToken;
  // Google PubSub topic - only set placeholder if not already configured during Google OAuth setup
  if (!env.GOOGLE_PUBSUB_TOPIC_NAME) {
    env.GOOGLE_PUBSUB_TOPIC_NAME =
      "projects/your-project-id/topics/inbox-zero-emails";
  }

  // App config
  env.NEXT_PUBLIC_BASE_URL = `http://localhost:${webPort}`;
  env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS = "true";

  spinner.stop("配置已生成");

  // ═══════════════════════════════════════════════════════════════════════════
  // Write files
  // ═══════════════════════════════════════════════════════════════════════════

  // Fetch docker-compose.yml if using Docker infra and not in repo
  if (useDockerInfra && !REPO_ROOT) {
    spinner.start("Fetching docker-compose.yml from repository...");

    let composeContent: string;
    try {
      composeContent = await fetchDockerCompose();
      composeContent = fixComposeEnvPaths(composeContent);
    } catch {
      spinner.stop("Failed to fetch docker-compose.yml");
      p.log.error(
        "Could not fetch docker-compose.yml from GitHub.\n" +
          "Please check your internet connection and try again.",
      );
      process.exit(1);
    }

    spinner.stop("Configuration fetched");
    writeFileSync(composeFile, composeContent);
  }

  spinner.start("Fetching .env template...");

  let template: string;
  try {
    template = await getEnvTemplate();
  } catch {
    spinner.stop("Failed to fetch .env template");
    p.log.error(
      "Could not fetch .env.example template.\n" +
        "Please check your internet connection and try again.",
    );
    process.exit(1);
  }

  spinner.stop("Template loaded");
  spinner.start("Writing .env file...");

  // Write .env based on template with user values filled in
  const envContent = generateEnvFile({
    env,
    useDockerInfra,
    llmProvider: selectedLlmProvider,
    template,
    composeEnvFile: REPO_ROOT
      ? `./apps/web/${envFileName}`
      : `./${envFileName}`,
  });
  saveEnvFile(envFile, envContent);

  spinner.stop(".env file created");

  // ═══════════════════════════════════════════════════════════════════════════
  // 摘要
  // ═══════════════════════════════════════════════════════════════════════════

  const configuredFeatures = [
    `✓ 环境：${isDevMode ? "开发" : "生产"}`,
    `✓ 基础设施：${useDockerInfra ? "Docker Compose" : "外部"}`,
    useDockerInfra
      ? `✓ Web 应用：${runWebInDocker ? "在 Docker 中" : "在宿主机上"}`
      : null,
    wantsGoogle ? "✓ Google OAuth" : "✗ Google OAuth（已跳过）",
    wantsMicrosoft ? "✓ Microsoft OAuth" : "✗ Microsoft OAuth（已跳过）",
    `✓ LLM 服务提供商（${llmProvider}）`,
  ]
    .filter(Boolean)
    .join("\n");

  p.note(configuredFeatures, "配置摘要");

  p.note(`环境文件已保存到：\n${envFile}`, "输出");

  if (!useDockerInfra) {
    p.log.warn(
      "你选择了外部基础设施。\n" +
        "请更新 .env 文件中的 DATABASE_URL 和 REDIS_HTTP_URL。",
    );
  }

  // 根据配置构建后续步骤
  let nextSteps: string;

  const composeCmd = getComposeCommand(envFile, composeFile);

  if (runWebInDocker) {
    // Web 应用在 Docker 中运行，包含数据库与 Redis
    const baseUrlCommand =
      process.platform === "win32"
        ? "$env:NEXT_PUBLIC_BASE_URL = 'https://yourdomain.com';"
        : "NEXT_PUBLIC_BASE_URL=https://yourdomain.com";
    nextSteps = `# 启动所有服务（Web、数据库与 Redis）：
${baseUrlCommand} ${composeCmd} --profile all up -d

# 查看日志：
docker logs inbox-zero-services-web-1 -f

# 然后打开：
https://yourdomain.com`;
  } else {
    // Web 应用在宿主机上运行（pnpm dev 或 pnpm start）
    const dockerStep = useDockerInfra
      ? `# 启动 Docker 服务（数据库与 Redis）：\n${composeCmd} --profile local-db --profile local-redis up -d\n\n`
      : "";
    const migrateCmd = isDevMode
      ? "pnpm prisma:migrate:dev"
      : "pnpm prisma:migrate:deploy";
    const startCmd = isDevMode ? "pnpm dev" : "pnpm build && pnpm start";

    nextSteps = `${dockerStep}# 运行数据库迁移：
${migrateCmd}

# 启动服务器：
${startCmd}

# 然后打开：
http://localhost:${webPort}`;
  }

  p.note(nextSteps, "后续步骤");

  p.outro("设置完成！🎉");
}

// ═══════════════════════════════════════════════════════════════════════════
// 启动命令
// ═══════════════════════════════════════════════════════════════════════════

async function runStart(options: { detach: boolean }) {
  requireDocker();

  if (!existsSync(STANDALONE_COMPOSE_FILE)) {
    p.log.error(
      "Inbox Zero 尚未配置生产模式。\n" +
        "请先运行 'inbox-zero setup' 并选择 Production (Docker)。",
    );
    process.exit(1);
  }

  p.intro("🚀 正在启动 Inbox Zero");

  const composeArgs = ["compose", "-f", STANDALONE_COMPOSE_FILE];

  if (checkContainersRunning(composeArgs)) {
    const restart = await p.confirm({
      message: "Inbox Zero 已在运行，要重启吗？",
      initialValue: true,
    });
    if (p.isCancel(restart) || !restart) {
      p.outro("Inbox Zero 已在运行。");
      return;
    }
    const stopSpinner = p.spinner();
    stopSpinner.start("正在停止现有容器...");
    await runDockerCommand([...composeArgs, "down"]);
    stopSpinner.stop("已停止");
  }

  const spinner = p.spinner();
  spinner.start("正在拉取最新镜像...");

  const pullResult = await runDockerCommand([...composeArgs, "pull"]);

  if (pullResult.status !== 0) {
    spinner.stop("拉取镜像失败");
    p.log.error(pullResult.stderr || "未知错误");
    process.exit(1);
  }

  spinner.stop("镜像已拉取");

  if (options.detach) {
    spinner.start("正在启动容器...");

    const upResult = await runDockerCommand([
      ...composeArgs,
      "--profile",
      "all",
      "up",
      "-d",
    ]);

    if (upResult.status !== 0) {
      const portError = parsePortConflict(upResult.stderr);
      spinner.stop("Failed to start");
      if (portError) {
        p.log.error(portError);
        logPortConflictGuidance();
      } else {
        p.log.error(upResult.stderr || "Unknown error");
      }
      process.exit(1);
    }

    spinner.stop("Containers started");

    // Get web port from env (with safe reading)
    let webPort = "3000";
    if (existsSync(STANDALONE_ENV_FILE)) {
      try {
        const envContent = readFileSync(STANDALONE_ENV_FILE, "utf-8");
        const parsedEnv = parseEnvFile(envContent);
        webPort = parsedEnv.WEB_PORT || webPort;
      } catch {
        // Use default port if env file can't be read
      }
    }

    p.note(
      `Inbox Zero is running at:\nhttp://localhost:${webPort}\n\nView logs: inbox-zero logs\nStop: inbox-zero stop`,
      "Running",
    );

    p.outro("Inbox Zero started! 🎉");
  } else {
    p.log.info("Starting containers in foreground...");

    const child = spawn("docker", [...composeArgs, "--profile", "all", "up"], {
      stdio: "inherit",
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on("close", (c) => resolve(c));
    });
    if (code !== 0) {
      process.exit(code ?? 1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stop Command
// ═══════════════════════════════════════════════════════════════════════════

async function runStop() {
  requireDocker();

  if (!existsSync(STANDALONE_COMPOSE_FILE)) {
    p.log.error("Inbox Zero is not configured.");
    process.exit(1);
  }

  p.intro("Stopping Inbox Zero");

  const spinner = p.spinner();
  spinner.start("Stopping containers...");

  const result = await runDockerCommand([
    "compose",
    "-f",
    STANDALONE_COMPOSE_FILE,
    "down",
  ]);

  if (result.status !== 0) {
    spinner.stop("Failed to stop");
    p.log.error(result.stderr || "Unknown error");
    process.exit(1);
  }

  spinner.stop("Containers stopped");
  p.outro("Inbox Zero stopped");
}

// ═══════════════════════════════════════════════════════════════════════════
// Logs Command
// ═══════════════════════════════════════════════════════════════════════════

async function runLogs(options: { follow: boolean; tail: string }) {
  requireDocker();

  if (!existsSync(STANDALONE_COMPOSE_FILE)) {
    p.log.error("Inbox Zero is not configured.");
    process.exit(1);
  }

  const args = [
    "compose",
    "-f",
    STANDALONE_COMPOSE_FILE,
    "logs",
    "--tail",
    options.tail,
  ];
  if (options.follow) {
    args.push("-f");
  }

  const child = spawn("docker", args, { stdio: "inherit" });

  await new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0 || options.follow) {
        resolve();
      } else {
        reject(new Error(`docker compose logs exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Command
// ═══════════════════════════════════════════════════════════════════════════

async function runStatus() {
  requireDocker();

  if (!existsSync(STANDALONE_COMPOSE_FILE)) {
    p.log.error("Inbox Zero is not configured.\nRun 'inbox-zero setup' first.");
    process.exit(1);
  }

  spawnSync("docker", ["compose", "-f", STANDALONE_COMPOSE_FILE, "ps"], {
    stdio: "inherit",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 更新命令
// ═══════════════════════════════════════════════════════════════════════════

async function runUpdate() {
  requireDocker();

  if (!existsSync(STANDALONE_COMPOSE_FILE)) {
    p.log.error("Inbox Zero 尚未配置。");
    process.exit(1);
  }

  p.intro("正在更新 Inbox Zero");

  const spinner = p.spinner();
  spinner.start("正在拉取最新镜像...");

  const pullResult = await runDockerCommand([
    "compose",
    "-f",
    STANDALONE_COMPOSE_FILE,
    "pull",
  ]);

  if (pullResult.status !== 0) {
    spinner.stop("拉取失败");
    p.log.error(pullResult.stderr || "未知错误");
    process.exit(1);
  }

  spinner.stop("镜像已更新");

  const restart = await p.confirm({
    message: "是否使用新镜像重启？",
    initialValue: true,
  });

  if (p.isCancel(restart)) {
    p.outro("更新完成。运行 'inbox-zero start' 以使用新版本。");
    return;
  }

  if (restart) {
    spinner.start("正在重启...");

    await runDockerCommand(["compose", "-f", STANDALONE_COMPOSE_FILE, "down"]);
    const upResult = await runDockerCommand([
      "compose",
      "-f",
      STANDALONE_COMPOSE_FILE,
      "--profile",
      "all",
      "up",
      "-d",
    ]);

    if (upResult.status !== 0) {
      const portError = parsePortConflict(upResult.stderr);
      spinner.stop("重启失败");
      if (portError) {
        p.log.error(portError);
        logPortConflictGuidance();
      } else {
        p.log.error(upResult.stderr || "未知错误");
      }
      process.exit(1);
    }

    spinner.stop("已重启");
  }

  p.outro("更新完成！🎉");
}

// ═══════════════════════════════════════════════════════════════════════════
// 配置命令
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG_CATEGORIES: Record<
  string,
  { description: string; keys: string[] }
> = {
  "Google (OAuth & Pub/Sub)": {
    description: "Gmail 集成与实时通知",
    keys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_PUBSUB_TOPIC_NAME",
      "GOOGLE_PUBSUB_VERIFICATION_TOKEN",
    ],
  },
  "Microsoft (OAuth)": {
    description: "Outlook / Microsoft 365 集成",
    keys: [
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_TENANT_ID",
    ],
  },
  "AI Provider": {
    description: "LLM 服务提供商与 API 密钥",
    keys: [
      "DEFAULT_LLMS",
      "ECONOMY_LLMS",
      "CHAT_LLMS",
      "NANO_LLMS",
      "DRAFT_LLMS",
      "LLM_API_KEY",
      "BEDROCK_ACCESS_KEY",
      "BEDROCK_SECRET_KEY",
      "BEDROCK_REGION",
    ],
  },
  "Database & Redis": {
    description: "数据库与缓存连接",
    keys: [
      "DATABASE_URL",
      "DIRECT_URL",
      "REDIS_HTTP_URL",
      "REDIS_HTTP_TOKEN",
      "UPSTASH_REDIS_URL",
      "UPSTASH_REDIS_TOKEN",
    ],
  },
  "Local Ports": {
    description: "Docker 主机端口绑定",
    keys: ["WEB_PORT", "POSTGRES_PORT", "REDIS_PORT", "REDIS_HTTP_PORT"],
  },
  "App Settings": {
    description: "应用 URL 与功能开关",
    keys: [
      "NEXT_PUBLIC_BASE_URL",
      "NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS",
      "NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED",
    ],
  },
};

function requireEnvFile(name?: string): { envFile: string; content: string } {
  const envFile = findEnvFile(name);
  if (!envFile) {
    const suffix = name ? ` (${name})` : "";
    p.log.error(
      `未找到 .env 文件${suffix}。\n请先运行 'inbox-zero setup' 创建。`,
    );
    process.exit(1);
  }
  return { envFile, content: readFileSync(envFile, "utf-8") };
}

async function runConfigInteractive(name?: string) {
  p.intro("Inbox Zero 配置");

  const { envFile, content } = requireEnvFile(name);
  const env = parseEnvFile(content);

  const category = await p.select({
    message: "你想配置什么？",
    options: Object.entries(CONFIG_CATEGORIES).map(
      ([name, { description }]) => ({
        value: name,
        label: name,
        hint: description,
      }),
    ),
  });

  if (p.isCancel(category)) {
    p.cancel("已取消");
    process.exit(0);
  }

  const { keys } = CONFIG_CATEGORIES[category];

  const currentValues = keys
    .map((key) => {
      const value = env[key];
      const display = value ? redactValue(key, value) : "（未设置）";
      return `  ${key} = ${display}`;
    })
    .join("\n");

  p.note(currentValues, `当前 ${category} 设置`);

  const keyToUpdate = await p.select({
    message: "要更新哪项设置？",
    options: keys.map((key) => ({
      value: key,
      label: key,
      hint: env[key] ? redactValue(key, env[key]) : "（未设置）",
    })),
  });

  if (p.isCancel(keyToUpdate)) {
    p.cancel("已取消");
    process.exit(0);
  }

  const currentValue = env[keyToUpdate];
  const newValue = await p.text({
    message: `请输入 ${keyToUpdate} 的新值`,
    placeholder: currentValue || "请输入值",
    initialValue: isSensitiveKey(keyToUpdate) ? "" : currentValue || "",
  });

  if (p.isCancel(newValue)) {
    p.cancel("已取消");
    process.exit(0);
  }

  if (!newValue) {
    p.log.warn("未输入任何值，未做更改");
    process.exit(0);
  }

  const updated = updateEnvValue(content, keyToUpdate, newValue);
  saveEnvFile(envFile, updated);

  p.log.success(`Updated ${keyToUpdate}`);
  p.note(
    "If containers are running, restart for changes to take effect:\n  inbox-zero stop && inbox-zero start",
    "Next step",
  );
  p.outro("Done!");
}

const VALID_CONFIG_KEYS = new Set(
  Object.values(CONFIG_CATEGORIES).flatMap((c) => c.keys),
);

async function runConfigSet(key: string, value: string, name?: string) {
  if (!VALID_CONFIG_KEYS.has(key)) {
    p.log.error(`未知的键：${key}`);
    p.log.info(
      `有效键：\n${[...VALID_CONFIG_KEYS].map((k) => `  ${k}`).join("\n")}`,
    );
    process.exit(1);
  }
  const { envFile, content } = requireEnvFile(name);
  const updated = updateEnvValue(content, key, value);
  saveEnvFile(envFile, updated);
  p.log.success(`已设置 ${key}`);
}

async function runConfigGet(key: string, name?: string) {
  const { content } = requireEnvFile(name);
  const env = parseEnvFile(content);
  const value = env[key];
  if (value === undefined) {
    p.log.warn(`${key} 未设置`);
  } else {
    p.log.info(`${key} = ${redactValue(key, value)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 环境文件生成器（基于模板）
// ═══════════════════════════════════════════════════════════════════════════

const ENV_EXAMPLE_URL =
  "https://raw.githubusercontent.com/elie222/inbox-zero/main/apps/web/.env.example";

async function fetchEnvExample(): Promise<string> {
  const response = await fetch(ENV_EXAMPLE_URL);
  if (!response.ok) {
    throw new Error(`获取 .env.example 失败：${response.statusText}`);
  }
  return response.text();
}

async function getEnvTemplate(): Promise<string> {
  if (REPO_ROOT) {
    const templatePath = resolve(REPO_ROOT, "apps/web/.env.example");
    if (existsSync(templatePath)) {
      return readFileSync(templatePath, "utf-8");
    }
  }
  return fetchEnvExample();
}

function cancelSetup(): never {
  p.cancel("设置已取消。");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Docker Compose 获取器
// ═══════════════════════════════════════════════════════════════════════════

const COMPOSE_URL =
  "https://raw.githubusercontent.com/elie222/inbox-zero/main/docker-compose.yml";

async function fetchDockerCompose(): Promise<string> {
  const response = await fetch(COMPOSE_URL);
  if (!response.ok) {
    throw new Error(`获取 docker-compose.yml 失败：${response.statusText}`);
  }
  return response.text();
}

// ═══════════════════════════════════════════════════════════════════════════
// Docker 命令辅助函数
// ═══════════════════════════════════════════════════════════════════════════

function runDockerCommand(
  args: string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, _reject) => {
    const child = spawn("docker", args, { stdio: "pipe" });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        status: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });

    child.on("error", (err) => {
      resolve({ status: 1, stdout: "", stderr: err.message });
    });
  });
}

function logPortConflictGuidance() {
  p.log.info(
    "Stop the conflicting process or change the port:\n" +
      "  inbox-zero config set WEB_PORT <port>\n" +
      "  inbox-zero config set POSTGRES_PORT <port>\n" +
      "  inbox-zero config set REDIS_PORT <port>\n" +
      "  inbox-zero config set REDIS_HTTP_PORT <port>",
  );
}

function readExistingEnv(envFile: string): EnvConfig {
  if (!existsSync(envFile)) return {};
  return parseEnvFile(readFileSync(envFile, "utf-8"));
}

function checkContainersRunning(composeArgs: string[]): boolean {
  const result = spawnSync("docker", [...composeArgs, "ps", "-q"], {
    stdio: "pipe",
  });
  if (result.status !== 0) return false;
  return (result.stdout?.toString().trim() ?? "") !== "";
}

// Only run main() when executed directly, not when imported for testing
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("main.ts") ||
    process.argv[1].endsWith("inbox-zero.js") ||
    basename(process.argv[1]).startsWith("inbox-zero"));

if (isMainModule) {
  main().catch((error) => {
    p.log.error(String(error));
    process.exit(1);
  });
}

function saveEnvFile(envFile: string, content: string) {
  writeFileSync(envFile, content);
  const warning = syncManagedComposeEnv({ envFile, repoRoot: REPO_ROOT });
  if (warning) p.log.warn(warning);
}
