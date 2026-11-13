import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { putSsmParameterWithTags } from "./aws-setup/aws-cli";
import { getBedrockCredentials } from "./aws-setup/bedrock";
import { getWebhookUrl, setupGooglePubSub } from "./aws-setup/google-pubsub";
import {
  ensureDatabaseUrlParameters,
  ensureRedisUrlParameter,
} from "./aws-setup/ssm-urls";
import { getDefaultLlmModels } from "./llm";
import { generateSecret } from "./utils";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface AwsPrerequisites {
  awsCliInstalled: boolean;
  copilotInstalled: boolean;
  profile: string | null;
  region: string | null;
}

interface GcloudPrerequisites {
  authenticated: boolean;
  installed: boolean;
  projectId: string | null;
}

export interface AwsSetupOptions {
  environment?: string;
  profile?: string;
  region?: string;
  yes?: boolean; // Non-interactive mode with defaults
}

interface SecretConfig {
  name: string;
  value: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const RDS_INSTANCE_OPTIONS = [
  {
    value: "db.t3.micro",
    label: "db.t3.micro  (~$12/mo)",
    hint: "1 vCPU、1GB 内存——适合 1-5 位用户",
  },
  {
    value: "db.t3.small",
    label: "db.t3.small  (~$24/mo)",
    hint: "2 vCPU、2GB 内存——适合 5-20 位用户",
  },
  {
    value: "db.t3.medium",
    label: "db.t3.medium (~$48/mo)",
    hint: "2 vCPU、4GB 内存——适合 20-100 位用户",
  },
  {
    value: "db.t3.large",
    label: "db.t3.large  (~$96/mo)",
    hint: "2 vCPU、8GB 内存——适合 100+ 位用户",
  },
];

const REDIS_INSTANCE_OPTIONS = [
  {
    value: "cache.t4g.micro",
    label: "cache.t4g.micro  (~$12/mo)",
    hint: "0.5 GiB——适合 <100 位用户",
  },
  {
    value: "cache.t4g.small",
    label: "cache.t4g.small  (~$24/mo)",
    hint: "1.37 GiB——适合 100-500 位用户",
  },
  {
    value: "cache.t4g.medium",
    label: "cache.t4g.medium (~$48/mo)",
    hint: "3.09 GiB——适合 500+ 位用户",
  },
];

const APP_NAME = "inbox-zero";
const SERVICE_NAME = "inbox-zero-ecs";
const ENVIRONMENT_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
const ENVIRONMENT_NAME_ERROR =
  "必须以字母开头，且只能包含小写字母、数字和连字符";

// ═══════════════════════════════════════════════════════════════════════════
// Main Setup Function
// ═══════════════════════════════════════════════════════════════════════════

export async function runAwsSetup(options: AwsSetupOptions) {
  p.intro("Inbox Zero 的 AWS Copilot 设置");

  const environmentError = validateEnvironmentName(options.environment);
  if (environmentError) {
    p.log.error(`无效的环境名称：${environmentError}`);
    process.exit(1);
  }
  const nonInteractive = options.yes === true;
  if (nonInteractive) {
    p.log.info("以非交互模式运行并使用默认值");
  }

  let bedrockCredentials = nonInteractive
    ? await getBedrockCredentials(true)
    : undefined;

  // Cleanup any leftover files from a previous interrupted run
  cleanupInterruptedRun();

  const workspaceDir = getCopilotWorkspaceDir();
  if (workspaceDir && workspaceDir !== process.cwd()) {
    p.log.info(`使用 Copilot 工作区：${workspaceDir}`);
    process.chdir(workspaceDir);
  }

  // Step 1: Check AWS prerequisites
  const spinner = p.spinner();
  spinner.start("正在检查前置条件...");

  const awsPrereqs = checkAwsPrerequisites();

  if (!awsPrereqs.awsCliInstalled) {
    spinner.stop("未找到 AWS CLI");
    p.log.error(
      "未安装 AWS CLI。\n" +
        "请从此处安装：https://aws.amazon.com/cli/\n" +
        "安装后运行：aws configure",
    );
    process.exit(1);
  }

  if (!awsPrereqs.copilotInstalled) {
    spinner.stop("未找到 AWS Copilot CLI");
    p.log.error(
      "未安装 AWS Copilot CLI。\n" +
        "请从此处安装：https://aws.github.io/copilot-cli/docs/getting-started/install/",
    );
    process.exit(1);
  }

  // Check if gcloud is available for integrated setup
  const gcloudPrereqs = checkGcloudPrerequisites();
  const gcloudAvailable =
    gcloudPrereqs.installed && gcloudPrereqs.authenticated;

  spinner.stop("前置条件检查完成");

  p.log.success("已安装 AWS CLI");
  p.log.success("已安装 Copilot CLI");
  if (gcloudAvailable) {
    p.log.success("gcloud CLI 已配置");
  } else {
    p.log.warn("gcloud CLI 未配置 - 你需要单独运行 'inbox-zero setup-google'");
  }

  // 第 2 步：获取 AWS 配置文件
  let profile = options.profile;

  if (!profile) {
    const availableProfiles = getAwsProfiles();

    if (availableProfiles.length === 0) {
      p.log.error(
        "未找到 AWS 配置文件。请先配置 AWS 凭据：\n" +
          "  aws configure --profile inbox-zero",
      );
      process.exit(1);
    }

    if (availableProfiles.length === 1 || nonInteractive) {
      // 在非交互模式下使用第一个配置文件（通常是 "default"）
      profile = availableProfiles.includes("default")
        ? "default"
        : availableProfiles[0];
      p.log.info(`使用 AWS 配置文件：${profile}`);
    } else {
      const profileChoice = await p.select({
        message: "选择 AWS 配置文件：",
        options: availableProfiles.map((pr) => ({
          value: pr,
          label: pr,
          hint: pr === "default" ? "默认配置文件" : undefined,
        })),
      });

      if (p.isCancel(profileChoice)) {
        p.cancel("设置已取消。");
        process.exit(0);
      }

      profile = profileChoice as string;
    }
  } else {
    p.log.info(`使用 AWS 配置文件：${profile}`);
  }

  // 验证该配置文件可用
  spinner.start("正在验证 AWS 凭据...");
  const credentialsValid = validateAwsCredentials(profile);
  if (!credentialsValid) {
    spinner.stop("AWS 凭据无效");
    p.log.error(
      `无法验证配置文件 '${profile}' 的凭据。\n` +
        "请确认：\n" +
        "1. 你使用的是 IAM 用户（而非根账户）\n" +
        "2. 凭据已正确配置\n" +
        "3. 运行：aws configure --profile " +
        profile,
    );
    process.exit(1);
  }
  spinner.stop("AWS 凭据已验证");

  // 第 3 步：获取 AWS 区域
  let region =
    options.region || awsPrereqs.region || getRegionForProfile(profile);

  if (!region) {
    if (nonInteractive) {
      region = "us-east-1";
      p.log.info(`使用区域：${region}`);
    } else {
      const regionInput = await p.text({
        message: "AWS 区域：",
        placeholder: "us-east-1",
        initialValue: "us-east-1",
      });

      if (p.isCancel(regionInput)) {
        p.cancel("设置已取消。");
        process.exit(0);
      }

      region = regionInput || "us-east-1";
    }
  } else {
    p.log.info(`使用区域：${region}`);
  }

  // 第 4 步：获取环境名称
  let envName = options.environment;

  if (!envName) {
    if (nonInteractive) {
      envName = "production";
      p.log.info(`使用环境：${envName}`);
    } else {
      const envInput = await p.text({
        message: "环境名称（例如 production、staging、dev）：",
        placeholder: "production",
        initialValue: "production",
        validate: (v) => validateEnvironmentName(v),
      });

      if (p.isCancel(envInput)) {
        p.cancel("设置已取消。");
        process.exit(0);
      }

      envName = envInput;
    }
  }

  // 第 6 步：选择 RDS 实例规格
  let rdsSize: string;
  if (nonInteractive) {
    rdsSize = "db.t3.micro";
    p.log.info(`使用 RDS 实例：${rdsSize}`);
  } else {
    const rdsSizeChoice = await p.select({
      message: "选择 RDS PostgreSQL 实例规格：",
      options: RDS_INSTANCE_OPTIONS,
    });

    if (p.isCancel(rdsSizeChoice)) {
      p.cancel("设置已取消。");
      process.exit(0);
    }
    rdsSize = rdsSizeChoice as string;
  }

  // 第 7 步：获取域名（可选）
  let domain: string | undefined;
  if (nonInteractive) {
    domain = undefined;
    p.log.info("域名：（无）");
  } else {
    const domainInput = await p.text({
      message: "你的应用域名（可选，按 Enter 跳过）：",
      placeholder: "app.example.com",
    });

    if (p.isCancel(domainInput)) {
      p.cancel("设置已取消。");
      process.exit(0);
    }

    domain = domainInput || undefined;
  }

  // 第 8 步：询问是否启用 Webhook 网关（用于防火墙受限的部署）
  let useWebhookGateway: boolean;
  if (nonInteractive) {
    useWebhookGateway = false;
    p.log.info("Webhook 网关：否");
  } else {
    const webhookChoice = await p.confirm({
      message: "为防火墙受限的部署启用 Webhook 网关？",
      initialValue: false,
    });

    if (p.isCancel(webhookChoice)) {
      p.cancel("设置已取消。");
      process.exit(0);
    }
    useWebhookGateway = webhookChoice;
  }

  // 第 8.5 步：询问是否启用 Redis（用于订阅/实时功能）
  let enableRedis: boolean;
  let redisSize: string;

  if (nonInteractive) {
    enableRedis = true;
    redisSize = "cache.t4g.micro";
    p.log.info(`Redis：是（${redisSize}）`);
  } else {
    const redisChoice = await p.confirm({
      message: "为实时功能启用 Redis？",
      initialValue: true,
    });

    if (p.isCancel(redisChoice)) {
      p.cancel("设置已取消。");
      process.exit(0);
    }
    enableRedis = redisChoice;

    if (enableRedis) {
      const redisSizeChoice = await p.select({
        message: "选择 Redis 实例规格：",
        options: REDIS_INSTANCE_OPTIONS,
      });

      if (p.isCancel(redisSizeChoice)) {
        p.cancel("设置已取消。");
        process.exit(0);
      }
      redisSize = redisSizeChoice as string;
    } else {
      redisSize = "";
    }
  }

  // 第 9 步：Google OAuth 凭据（必填）
  let configureGoogle = false;
  let googleConfig: { projectId: string } | null = null;
  let googleOAuth: { clientId: string; clientSecret: string } | null = null;

  if (nonInteractive) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      p.log.error(
        "缺少 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET。\n" +
          "在非交互模式下，运行前请设置这些环境变量：\n" +
          "GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... inbox-zero setup-aws --yes",
      );
      process.exit(1);
    }
    googleOAuth = { clientId, clientSecret };
  } else {
    p.note(
      "应用启动需要 Google OAuth 凭据。\n" +
        "创建地址：https://console.cloud.google.com/apis/credentials",
      "需要 Google OAuth",
    );

    const oauthInput = await p.group(
      {
        clientId: () =>
          p.text({
            message: "Google 客户端 ID：",
            placeholder: "123456789012-abc.apps.googleusercontent.com",
            validate: (v) => (v ? undefined : "客户端 ID 为必填项"),
          }),
        clientSecret: () =>
          p.text({
            message: "Google 客户端密钥：",
            placeholder: "GOCSPX-...",
            validate: (v) => (v ? undefined : "客户端密钥为必填项"),
          }),
      },
      {
        onCancel: () => {
          p.cancel("设置已取消。");
          process.exit(0);
        },
      },
    );

    googleOAuth = {
      clientId: oauthInput.clientId,
      clientSecret: oauthInput.clientSecret,
    };
  }

  // 第 10 步：如果 gcloud 可用，询问是否配置 Google Cloud 集成
  if (gcloudAvailable && !nonInteractive) {
    const integrateGoogle = await p.confirm({
      message: "检测到 gcloud。是否在同一步骤中配置 Google Cloud？",
      initialValue: true,
    });

    if (!p.isCancel(integrateGoogle) && integrateGoogle) {
      configureGoogle = true;

      // 获取 Google 项目 ID
      let projectId = gcloudPrereqs.projectId;
      if (!projectId) {
        const projectInput = await p.text({
          message: "Google Cloud 项目 ID：",
          placeholder: "my-project-123",
          validate: (v) => (v ? undefined : "项目 ID 为必填项"),
        });

        if (p.isCancel(projectInput)) {
          p.cancel("设置已取消。");
          process.exit(0);
        }

        projectId = projectInput;
      } else {
        p.log.info(`使用 Google Cloud 项目：${projectId}`);
      }

      googleConfig = { projectId };
    }
  } else if (nonInteractive) {
    p.log.info("Google 集成：已跳过（非交互模式）");
  }

  const configuredPubsubTopic = process.env.GOOGLE_PUBSUB_TOPIC_NAME;
  const pubsubTopicName =
    configuredPubsubTopic ||
    (googleConfig
      ? `projects/${googleConfig.projectId}/topics/${domain || "inbox-zero"}`
      : "projects/your-project-id/topics/inbox-zero-emails");
  const pubsubTopic = /^projects\/([^/\s]+)\/topics\/([^/\s]+)$/.exec(
    pubsubTopicName,
  );
  const topicSource = configuredPubsubTopic
    ? "GOOGLE_PUBSUB_TOPIC_NAME"
    : "从应用域名推导出的 Pub/Sub 主题";
  if (!pubsubTopic) {
    throw new Error(
      `${topicSource} 必须是 projects/PROJECT_ID/topics/TOPIC_ID`,
    );
  }
  const topicId = pubsubTopic[2];
  if (
    !/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topicId) ||
    topicId.startsWith("goog")
  ) {
    throw new Error(
      `${topicSource} 使用的主题 ID 必须为 3–255 个字符，以字母开头，只能包含字母、数字、-_.~+%，且不能以 goog 开头`,
    );
  }
  const pubsubSubscriptionName = `${topicId}-${APP_NAME}-${envName}-subscription`;
  if (
    configureGoogle &&
    useWebhookGateway &&
    pubsubSubscriptionName.length > 255
  ) {
    throw new Error(
      "生成的 Pub/Sub 订阅名称超过 255 个字符；请选择更短的主题 ID 或环境名称",
    );
  }
  if (googleConfig && pubsubTopic[1] !== googleConfig.projectId) {
    throw new Error(
      "GOOGLE_PUBSUB_TOPIC_NAME 必须属于所选的 Google Cloud 项目",
    );
  }

  // 第 11 步：选择 LLM 服务提供商
  let llmProvider: string;
  let llmApiKey = "";
  let llmEnvVar = "";

  if (nonInteractive) {
    // 显式运行时凭据会在预配前进行验证。
    llmProvider = "bedrock";
    llmEnvVar = "BEDROCK_REGION";
    llmApiKey = region;
    p.log.info("LLM 服务提供商：AWS Bedrock");
  } else {
    const llmChoice = await p.select({
      message: "LLM 服务提供商：",
      options: [
        { value: "anthropic", label: "Anthropic (Claude)" },
        { value: "openai", label: "OpenAI (GPT)" },
        { value: "google", label: "Google (Gemini)" },
        {
          value: "openrouter",
          label: "OpenRouter",
          hint: "访问多个模型",
        },
        {
          value: "aigateway",
          label: "Vercel AI Gateway",
          hint: "访问多个模型",
        },
        { value: "bedrock", label: "AWS Bedrock" },
        { value: "groq", label: "Groq", hint: "快速推理" },
        { value: "cerebras", label: "Cerebras", hint: "快速推理" },
      ],
    });

    if (p.isCancel(llmChoice)) {
      p.cancel("设置已取消。");
      process.exit(0);
    }

    llmProvider = llmChoice as string;

    // 获取 LLM API 密钥
    if (llmProvider === "bedrock") {
      p.log.info("配置可访问所选模型的 Bedrock 凭据。");
      bedrockCredentials = await getBedrockCredentials(false);
      llmEnvVar = "BEDROCK_REGION";
      llmApiKey = region;
    } else {
      const apiKeyMap: Record<string, { url: string }> = {
        anthropic: {
          url: "https://console.anthropic.com/settings/keys",
        },
        openai: {
          url: "https://platform.openai.com/api-keys",
        },
        google: {
          url: "https://aistudio.google.com/apikey",
        },
        openrouter: {
          url: "https://openrouter.ai/settings/keys",
        },
        aigateway: {
          url: "https://vercel.com/docs/ai-gateway",
        },
        groq: {
          url: "https://console.groq.com/keys",
        },
        cerebras: {
          url: "https://cloud.cerebras.ai",
        },
      };

      const { url } = apiKeyMap[llmProvider];
      llmEnvVar = "LLM_API_KEY";

      p.log.info(`在此获取 API 密钥：${url}`);

      const apiKeyInput = await p.text({
        message: `${llmProvider.charAt(0).toUpperCase() + llmProvider.slice(1)} API 密钥：`,
        placeholder: "sk-...",
        validate: (v) => (v ? undefined : "API 密钥为必填项"),
      });

      if (p.isCancel(apiKeyInput)) {
        p.cancel("设置已取消。");
        process.exit(0);
      }

      llmApiKey = apiKeyInput;
    }
  }
  const defaultLlms = `${llmProvider}:${getDefaultLlmModels(llmProvider).default}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // Begin Deployment
  // ═══════════════════════════════════════════════════════════════════════════

  p.note(
    `配置摘要：
• AWS 配置文件：${profile}
• AWS 区域：${region}
• 环境：${envName}
• VPC：由 Copilot 管理
• RDS 实例：${rdsSize}
• Redis：${enableRedis ? `是（${redisSize}）` : "否"}
• 域名：${domain || "（无）"}
• Webhook 网关：${useWebhookGateway ? "是" : "否"}
• Google 集成：${configureGoogle ? "是" : "否"}
• LLM 服务提供商：${llmProvider}`,
    "准备部署",
  );

  if (!nonInteractive) {
    const confirmDeploy = await p.confirm({
      message: "是否继续部署？此操作将创建 AWS 资源。",
      initialValue: true,
    });

    if (p.isCancel(confirmDeploy) || !confirmDeploy) {
      p.cancel("部署已取消。");
      process.exit(0);
    }
  } else {
    p.log.info("继续部署（非交互模式）...");
  }

  // Set environment variables for all subsequent commands
  const env = {
    ...process.env,
    AWS_PROFILE: profile,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };

  // Step 12: Update addons.parameters.yml with RDS and Redis configuration
  spinner.start("正在更新基础设施配置...");
  updateAddonsParameters({
    rdsInstanceClass: rdsSize as string,
    enableRedis,
    redisInstanceClass: redisSize,
  });
  spinner.stop("基础设施配置已更新");

  // Step 13: Generate and store secrets in SSM
  spinner.start("正在生成密钥...");

  const pubsubVerificationToken = generateSecret(32);
  const secrets: SecretConfig[] = [
    { name: "AUTH_SECRET", value: generateSecret(32) },
    { name: "EMAIL_ENCRYPT_SECRET", value: generateSecret(32) },
    { name: "EMAIL_ENCRYPT_SALT", value: generateSecret(16) },
    { name: "INTERNAL_API_KEY", value: generateSecret(32) },
    { name: "CRON_SECRET", value: generateSecret(32) },
    {
      name: "GOOGLE_PUBSUB_VERIFICATION_TOKEN",
      value: pubsubVerificationToken,
    },
  ];

  // Add Google OAuth secrets (required)
  if (googleOAuth) {
    secrets.push(
      { name: "GOOGLE_CLIENT_ID", value: googleOAuth.clientId },
      { name: "GOOGLE_CLIENT_SECRET", value: googleOAuth.clientSecret },
    );
  }

  secrets.push({ name: "GOOGLE_PUBSUB_TOPIC_NAME", value: pubsubTopicName });

  if (bedrockCredentials) {
    for (const [name, value] of Object.entries(bedrockCredentials)) {
      secrets.push({ name, value });
    }
  }

  // Add LLM API key
  if (llmEnvVar && llmApiKey) {
    secrets.push({ name: llmEnvVar, value: llmApiKey });
  }

  spinner.stop("密钥已生成");

  // Step 14: Initialize Copilot app (if not already done)
  spinner.start("正在初始化 Copilot 应用...");

  const appInitResult = initCopilotApp(domain, env);
  if (!appInitResult.success) {
    spinner.stop("初始化应用失败");
    p.log.error(appInitResult.error || "未知错误");
    process.exit(1);
  }

  spinner.stop("Copilot 应用已初始化");

  // Step 15: Initialize environment
  spinner.start(`正在初始化 ${envName} 环境...`);

  const envInitResult = initCopilotEnv(envName, profile, env);
  if (!envInitResult.success) {
    spinner.stop("初始化环境失败");
    p.log.error(envInitResult.error || "未知错误");
    process.exit(1);
  }

  spinner.stop(`${envName} 环境已初始化`);

  // Step 16: Store secrets in SSM
  spinner.start("正在将密钥存储到 AWS SSM...");

  for (const secret of secrets) {
    const ssmResult = storeSecretInSsm(secret.name, secret.value, envName, env);
    if (!ssmResult.success) {
      spinner.stop(`存储密钥失败：${secret.name}`);
      p.log.error(ssmResult.error || "未知错误");
      // Continue with other secrets
    }
  }

  spinner.stop("密钥已存储到 SSM");

  // Step 17: Webhook gateway is stored in templates/ and only copied to addons/ when needed
  // This avoids the chicken-and-egg problem (webhook gateway needs HTTPS listener from service)
  // We'll copy it after the service is deployed if the user wants it

  // Step 18: Deploy environment (creates VPC, RDS)
  spinner.start(`正在部署 ${envName} 环境（可能需要 10-15 分钟）...`);

  let envDeployResult = deployCopilotEnv(envName, env);

  // Check for orphaned environment registration (role doesn't exist but registration does)
  if (
    !envDeployResult.success &&
    envDeployResult.error?.includes("not authorized to perform: sts:AssumeRole")
  ) {
    spinner.stop("检测到孤立的环境注册");
    p.log.warn("发现来自上次失败部署的过期环境注册。");
    p.log.info("正在清理并重试...");

    const cleaned = cleanupOrphanedEnvironment(APP_NAME, envName, env);
    if (cleaned) {
      // Also delete local workspace file to re-register
      const copilotRoot = findCopilotRoot();
      if (copilotRoot) {
        const workspacePath = resolve(copilotRoot, ".workspace");
        if (existsSync(workspacePath)) {
          spawnSync("rm", [workspacePath]);
        }
        // Also remove the local env directory
        const envDir = resolve(copilotRoot, "environments", envName);
        if (existsSync(envDir)) {
          spawnSync("rm", ["-rf", envDir]);
        }
      }

      // Re-init app first (workspace was deleted)
      spinner.start("正在重新初始化应用...");
      initCopilotApp(domain, env);
      spinner.stop("应用已重新初始化");

      // Re-init environment
      spinner.start("正在重新初始化环境...");
      initCopilotEnv(envName, profile, env);
      spinner.stop("环境已重新初始化");

      spinner.start(`正在部署 ${envName} 环境（可能需要 10-15 分钟）...`);
      envDeployResult = deployCopilotEnv(envName, env);
    }
  }

  if (!envDeployResult.success) {
    spinner.stop("部署环境失败");
    p.log.error(envDeployResult.error || "未知错误");
    p.note(
      `常见问题：
• CloudFormation 堆栈处于 ROLLBACK 状态（请通过 AWS 控制台删除）
• IAM 权限问题（请确保使用 IAM 用户而非根账户）
• 网络/超时问题（重试该命令）`,
      "故障排除",
    );
    process.exit(1);
  }

  spinner.stop(`${envName} 环境已部署`);

  // Step 18.25: Ensure database URL parameters
  spinner.start("正在确保数据库 URL 参数...");
  const dbUrlResult = ensureDatabaseUrlParameters(APP_NAME, envName, env);
  if (!dbUrlResult.success) {
    spinner.stop("数据库 URL 设置失败");
    p.log.warn(dbUrlResult.error || "无法设置数据库 URL 参数");
  } else {
    spinner.stop("数据库 URL 参数已确保");
  }

  // Step 18.3: Ensure Redis URL parameter (if Redis enabled)
  if (enableRedis) {
    spinner.start("正在确保 Redis URL 参数...");
    const redisUrlResult = ensureRedisUrlParameter(APP_NAME, envName, env);
    if (!redisUrlResult.success) {
      spinner.stop("Redis URL 设置失败");
      p.log.warn(redisUrlResult.error || "无法设置 Redis URL 参数");
    } else {
      spinner.stop("Redis URL 参数已确保");
    }
  }

  // Step 18.5: Update service manifest with dynamic secrets
  spinner.start("正在使用密钥更新服务清单...");
  updateServiceManifestSecrets({
    llmEnvVar,
    hasGoogleOAuth: !!googleOAuth,
    enableRedis,
  });
  spinner.stop("服务清单已更新");

  // Step 18.6: Update service manifest variables (base URL + LLM provider)
  const initialBaseUrl = domain ? `https://${domain}` : "http://localhost";
  spinner.start("正在更新服务清单变量...");
  updateServiceManifestVariables({
    baseUrl: initialBaseUrl,
    defaultLlms,
  });
  spinner.stop("服务清单变量已更新");

  // Step 18.7: Update service manifest HTTP config (domain/redirect)
  spinner.start("正在更新服务清单 HTTP 设置...");
  updateServiceManifestHttp({ domain });
  spinner.stop("服务清单 HTTP 设置已更新");

  // Step 19: Initialize and deploy service
  spinner.start("正在初始化服务...");

  const svcInitResult = initCopilotService(env);
  if (!svcInitResult.success) {
    spinner.stop("初始化服务失败");
    p.log.error(svcInitResult.error || "未知错误");
    process.exit(1);
  }

  spinner.stop("服务已初始化");

  spinner.start("正在部署服务（可能需要 5-10 分钟）...");

  const svcDeployResult = deployCopilotService(envName, env);
  if (!svcDeployResult.success) {
    spinner.stop("部署服务失败");
    p.log.error(svcDeployResult.error || "未知错误");
    process.exit(1);
  }

  spinner.stop("服务已部署");

  // Step 19.5: Update base URL from service endpoint if no domain
  if (!domain) {
    const serviceUrl = getServiceUrl(envName, env);
    if (serviceUrl) {
      spinner.start("正在将基础 URL 更新为服务端点...");
      updateServiceManifestVariables({
        baseUrl: serviceUrl,
        defaultLlms,
      });
      spinner.stop("基础 URL 已更新");

      spinner.start("正在使用更新后的基础 URL 重新部署服务...");
      const baseUrlDeployResult = deployCopilotService(envName, env);
      if (!baseUrlDeployResult.success) {
        spinner.stop("使用基础 URL 重新部署服务失败");
        p.log.error(baseUrlDeployResult.error || "未知错误");
        process.exit(1);
      }
      spinner.stop("服务已使用更新后的基础 URL 重新部署");

      resetServiceManifestVariables();
    }
  }

  // Step 20: Deploy webhook gateway addon (only if user requested it)
  let webhookUrl = "";
  if (useWebhookGateway) {
    spinner.start("正在添加 Webhook 网关插件...");

    const copilotRoot = findCopilotRoot();
    const addonsPath = findAddonsPath();

    if (copilotRoot && addonsPath) {
      // Copy webhook-gateway.yml from templates to addons
      const templatePath = resolve(
        copilotRoot,
        "templates",
        "webhook-gateway.yml",
      );
      const addonPath = resolve(addonsPath, "webhook-gateway.yml");

      if (existsSync(templatePath)) {
        const content = readFileSync(templatePath, "utf-8");
        writeFileSync(addonPath, content);

        // Add webhook gateway parameters to addons.parameters.yml
        const paramsPath = resolve(addonsPath, "addons.parameters.yml");
        if (existsSync(paramsPath)) {
          let paramsContent = readFileSync(paramsPath, "utf-8");
          const listenerProtocol = domain ? "HTTPS" : "HTTP";
          if (!paramsContent.includes("WebhookAudience:")) {
            paramsContent = `${paramsContent.trimEnd()}\n\n  # Webhook gateway params (auto-added)\n  WebhookAudience: ''\n  WebhookListenerProtocol: '${listenerProtocol}'\n`;
          } else if (!paramsContent.includes("WebhookListenerProtocol:")) {
            paramsContent = `${paramsContent.trimEnd()}\n  WebhookListenerProtocol: '${listenerProtocol}'\n`;
          } else {
            paramsContent = paramsContent.replace(
              /WebhookListenerProtocol:\s*['"]?[^'\n]*['"]?/,
              `WebhookListenerProtocol: '${listenerProtocol}'`,
            );
          }
          writeFileSync(paramsPath, paramsContent);
        }

        spinner.stop("Webhook 网关插件已添加");

        // Redeploy environment to include webhook gateway
        spinner.start("正在部署 Webhook 网关（可能需要几分钟）...");
        const webhookDeployResult = deployCopilotEnv(envName, env);
        if (!webhookDeployResult.success) {
          spinner.stop("部署 Webhook 网关失败");
          p.log.error(webhookDeployResult.error || "未知错误");
          // Clean up - remove the addon so it doesn't fail next time
          spawnSync("rm", [addonPath]);
          // Remove the parameters we added
          if (existsSync(paramsPath)) {
            let paramsContent = readFileSync(paramsPath, "utf-8");
            paramsContent = paramsContent.replace(
              /\n\n\s+# Webhook gateway params \(auto-added\)\n\s+WebhookAudience: ''\n\s+WebhookListenerProtocol: '[^']+'\n?/,
              "",
            );
            writeFileSync(paramsPath, paramsContent);
          }
        } else {
          spinner.stop("Webhook 网关已部署");
          // Get the webhook URL from CloudFormation outputs
          webhookUrl = getWebhookUrl(APP_NAME, envName, env);
        }
      } else {
        spinner.stop("未找到 Webhook 网关模板");
        p.log.warn(
          `未找到模板：${templatePath}。\n` +
            "你可以稍后手动添加 Webhook 网关。",
        );
      }
    }
  }

  // Step 21: Configure Google Pub/Sub if integrated
  if (configureGoogle && googleConfig && webhookUrl) {
    spinner.start("正在配置 Google Cloud Pub/Sub...");

    const pubsubResult = await setupGooglePubSub({
      subscriptionName: pubsubSubscriptionName,
      projectId: googleConfig.projectId,
      webhookUrl,
      topicName: topicId,
      verificationToken: pubsubVerificationToken,
    });

    if (!pubsubResult.success) {
      spinner.stop("配置 Pub/Sub 失败");
      p.log.warn(
        "Pub/Sub 设置失败。你可以手动配置：\n" +
          `inbox-zero setup-google --webhook-url "${webhookUrl}"`,
      );
    } else {
      spinner.stop("Google Pub/Sub 已配置");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════

  const appUrl = domain
    ? `https://${domain}`
    : "（请查看 Copilot 输出获取 URL）";

  const summary = [
    `✓ RDS PostgreSQL（${rdsSize}）已部署`,
    enableRedis
      ? `✓ ElastiCache Redis（${redisSize}）已部署`
      : "✗ Redis（未启用）",
    "✓ 密钥已存储到 SSM",
    "✓ ECS 服务已部署",
    useWebhookGateway && webhookUrl
      ? `✓ Webhook 网关：${webhookUrl}`
      : useWebhookGateway
        ? "! Webhook 网关部署需要处理"
        : "✗ Webhook 网关（未启用）",
    configureGoogle && webhookUrl
      ? "✓ Google Pub/Sub 已配置"
      : configureGoogle
        ? "! Google Pub/Sub 需要手动设置"
        : "✗ Google 集成（未配置）",
  ].join("\n");

  p.note(summary, "部署完成");

  // Next steps
  const nextSteps: string[] = [];

  if (!configureGoogle) {
    nextSteps.push(
      `运行 Google 设置：\n  inbox-zero setup-google${webhookUrl ? ` --webhook-url "${webhookUrl}"` : ""}`,
    );
  }

  if (!domain) {
    nextSteps.push("获取应用 URL：\n  copilot svc show --name inbox-zero-ecs");
  }

  nextSteps.push(
    "查看日志：\n  copilot svc logs --follow",
    "检查状态：\n  copilot svc status",
  );

  p.note(nextSteps.join("\n\n"), "后续步骤");

  p.outro(`应用 URL：${appUrl}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function checkAwsPrerequisites(): AwsPrerequisites {
  // Check AWS CLI
  const awsResult = spawnSync("aws", ["--version"], { stdio: "pipe" });
  const awsCliInstalled = awsResult.status === 0;

  // Check Copilot CLI
  const copilotResult = spawnSync("copilot", ["--version"], { stdio: "pipe" });
  const copilotInstalled = copilotResult.status === 0;

  // Get current profile
  const profile = process.env.AWS_PROFILE || null;

  // Get current region
  let region = null;
  if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
    region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION)?.trim();
  }
  if (!region) {
    const regionResult = profile
      ? spawnSync("aws", ["configure", "get", "region", "--profile", profile], {
          stdio: "pipe",
        })
      : spawnSync("aws", ["configure", "get", "region"], { stdio: "pipe" });
    region =
      regionResult.status === 0
        ? regionResult.stdout.toString().trim() || null
        : null;
  }

  return { awsCliInstalled, copilotInstalled, profile, region };
}

export function validateEnvironmentName(
  environment: string | undefined,
): string | undefined {
  if (environment === undefined) return;
  if (!environment) return "环境名称为必填项";
  if (!ENVIRONMENT_NAME_REGEX.test(environment)) {
    return ENVIRONMENT_NAME_ERROR;
  }
  return;
}

function getRegionForProfile(profile: string): string | null {
  const envRegion =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (envRegion) return envRegion;

  const result = spawnSync(
    "aws",
    ["configure", "get", "region", "--profile", profile],
    { stdio: "pipe" },
  );
  if (result.status !== 0) return null;
  return result.stdout.toString().trim() || null;
}

function checkGcloudPrerequisites(): GcloudPrerequisites {
  // Check if gcloud is installed
  const versionResult = spawnSync("gcloud", ["--version"], { stdio: "pipe" });
  if (versionResult.status !== 0) {
    return { installed: false, authenticated: false, projectId: null };
  }

  // Check authentication
  const authResult = spawnSync("gcloud", ["auth", "list", "--format=json"], {
    stdio: "pipe",
  });
  let authenticated = false;
  if (authResult.status === 0) {
    try {
      const accounts = JSON.parse(authResult.stdout.toString());
      authenticated = Array.isArray(accounts) && accounts.length > 0;
    } catch {
      authenticated = false;
    }
  }

  // Get current project ID
  const projectResult = spawnSync(
    "gcloud",
    ["config", "get-value", "project"],
    { stdio: "pipe" },
  );
  const projectId =
    projectResult.status === 0
      ? projectResult.stdout.toString().trim() || null
      : null;

  return { installed: true, authenticated, projectId };
}

function validateAwsCredentials(profile: string): boolean {
  const result = spawnSync(
    "aws",
    ["sts", "get-caller-identity", "--profile", profile],
    { stdio: "pipe" },
  );
  return result.status === 0;
}

function getAwsProfiles(): string[] {
  const profiles: string[] = [];
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const credentialsPath = `${homeDir}/.aws/credentials`;

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, "utf-8");
      const matches = content.match(/^\[([^\]]+)\]/gm);
      if (matches) {
        for (const match of matches) {
          const profileName = match.slice(1, -1); // Remove [ and ]
          profiles.push(profileName);
        }
      }
    }
  } catch {
    // Ignore errors reading credentials file
  }

  // Also check config file for profiles defined there
  const configPath = `${homeDir}/.aws/config`;
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const matches = content.match(/^\[profile ([^\]]+)\]/gm);
      if (matches) {
        for (const match of matches) {
          const profileName = match.replace("[profile ", "").slice(0, -1);
          if (!profiles.includes(profileName)) {
            profiles.push(profileName);
          }
        }
      }
    }
  } catch {
    // Ignore errors reading config file
  }

  return profiles;
}

function cleanupInterruptedRun(): void {
  const addonsPath = findAddonsPath();
  if (!addonsPath) return;

  // Clean up any leftover .bak or .disabled files from old runs
  const webhookGatewayBackup = resolve(addonsPath, "webhook-gateway.yml.bak");
  const webhookGatewayDisabled = resolve(
    addonsPath,
    "webhook-gateway.yml.disabled",
  );

  if (existsSync(webhookGatewayBackup)) {
    spawnSync("rm", [webhookGatewayBackup]);
  }
  if (existsSync(webhookGatewayDisabled)) {
    spawnSync("rm", [webhookGatewayDisabled]);
  }
}

function cleanupOrphanedEnvironment(
  appName: string,
  envName: string,
  env: NodeJS.ProcessEnv,
): boolean {
  // Check if there's an orphaned environment registration in SSM
  // This happens when env init succeeds but env deploy fails, leaving a stale registration
  const checkResult = spawnSync(
    "aws",
    [
      "ssm",
      "get-parameter",
      "--name",
      `/copilot/applications/${appName}/environments/${envName}`,
      "--query",
      "Parameter.Value",
      "--output",
      "text",
    ],
    { stdio: "pipe", env },
  );

  // Delete the SSM registration if it exists
  if (checkResult.status === 0) {
    spawnSync(
      "aws",
      [
        "ssm",
        "delete-parameter",
        "--name",
        `/copilot/applications/${appName}/environments/${envName}`,
      ],
      { stdio: "pipe", env },
    );
  }

  // Check if there's a stuck CloudFormation stack in ROLLBACK_COMPLETE or similar state
  const stackName = `${appName}-${envName}`;
  const stackStatusResult = spawnSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].StackStatus",
      "--output",
      "text",
    ],
    { stdio: "pipe", env },
  );

  const stackStatus = stackStatusResult.stdout?.toString().trim();
  if (
    stackStatus &&
    (stackStatus.includes("ROLLBACK_COMPLETE") ||
      stackStatus.includes("DELETE_FAILED") ||
      stackStatus.includes("CREATE_FAILED"))
  ) {
    // Delete the stuck stack
    spawnSync(
      "aws",
      ["cloudformation", "delete-stack", "--stack-name", stackName],
      { stdio: "pipe", env },
    );

    // Wait for deletion (with timeout)
    spawnSync(
      "aws",
      [
        "cloudformation",
        "wait",
        "stack-delete-complete",
        "--stack-name",
        stackName,
      ],
      { stdio: "pipe", env, timeout: 300_000 },
    );
  }

  return true;
}

function findCopilotRoot(): string | null {
  const possiblePaths = [
    resolve(process.cwd(), "copilot"),
    resolve(process.cwd(), "../copilot"),
    resolve(process.cwd(), "../../copilot"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

function getCopilotWorkspaceDir(): string | null {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return null;
  return resolve(copilotRoot, "..");
}

function findAddonsPath(): string | null {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return null;

  const addonsPath = resolve(copilotRoot, "environments/addons");
  return existsSync(addonsPath) ? addonsPath : null;
}

function updateAddonsParameters(config: {
  rdsInstanceClass: string;
  enableRedis: boolean;
  redisInstanceClass: string;
}): void {
  const addonsPath = findAddonsPath();
  if (!addonsPath) {
    return;
  }

  const paramsFile = resolve(addonsPath, "addons.parameters.yml");
  if (!existsSync(paramsFile)) {
    return;
  }

  let content = readFileSync(paramsFile, "utf-8");

  // Update or add RDSInstanceClass parameter
  if (content.includes("RDSInstanceClass:")) {
    content = content.replace(
      /RDSInstanceClass:\s*['"]?[^'\n]*['"]?/,
      `RDSInstanceClass: '${config.rdsInstanceClass}'`,
    );
  } else {
    content = `${content.trimEnd()}\n  RDSInstanceClass: '${config.rdsInstanceClass}'\n`;
  }

  // Update EnableRedis parameter
  const enableRedisValue = config.enableRedis ? "true" : "false";
  if (content.includes("EnableRedis:")) {
    content = content.replace(
      /EnableRedis:\s*['"]?[^'\n]*['"]?/,
      `EnableRedis: '${enableRedisValue}'`,
    );
  } else {
    content = `${content.trimEnd()}\n  EnableRedis: '${enableRedisValue}'\n`;
  }

  // Update RedisInstanceClass parameter
  if (config.enableRedis && config.redisInstanceClass) {
    if (content.includes("RedisInstanceClass:")) {
      content = content.replace(
        /RedisInstanceClass:\s*['"]?[^'\n]*['"]?/,
        `RedisInstanceClass: '${config.redisInstanceClass}'`,
      );
    } else {
      content = `${content.trimEnd()}\n  RedisInstanceClass: '${config.redisInstanceClass}'\n`;
    }
  }

  writeFileSync(paramsFile, content);
}

export function updateServiceManifestSecrets(config: {
  llmEnvVar: string;
  hasGoogleOAuth: boolean;
  enableRedis?: boolean;
}): void {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return;

  const manifestPath = resolve(copilotRoot, SERVICE_NAME, "manifest.yml");
  if (!existsSync(manifestPath)) return;

  let content = readFileSync(manifestPath, "utf-8");

  const baseSecrets = [
    "AUTH_SECRET",
    "EMAIL_ENCRYPT_SECRET",
    "EMAIL_ENCRYPT_SALT",
    "INTERNAL_API_KEY",
    "CRON_SECRET",
    "GOOGLE_PUBSUB_VERIFICATION_TOKEN",
    "GOOGLE_PUBSUB_TOPIC_NAME",
    "DATABASE_URL",
    "DIRECT_URL",
  ];
  const optionalSecrets = [
    ...(config.llmEnvVar ? [config.llmEnvVar] : []),
    ...(config.llmEnvVar === "BEDROCK_REGION"
      ? ["BEDROCK_ACCESS_KEY", "BEDROCK_SECRET_KEY"]
      : []),
    ...(config.hasGoogleOAuth
      ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
      : []),
    ...(config.enableRedis ? ["REDIS_URL"] : []),
  ];

  for (const secretName of [...baseSecrets, ...optionalSecrets]) {
    content = normalizeSecretReference(content, secretName);
    if (!new RegExp(`^\\s+${secretName}:`, "m").test(content)) {
      content = content.replace(
        /^secrets:.*$/m,
        (heading) =>
          `${heading}\n  ${secretName}: ${getSecretReference(secretName)}`,
      );
    }
  }

  content = removeSecrets(content, [
    "REDIS_HTTP_URL",
    "REDIS_HTTP_TOKEN",
    "UPSTASH_REDIS_URL",
    "UPSTASH_REDIS_TOKEN",
    ...(config.enableRedis ? [] : ["REDIS_URL"]),
    ...(config.llmEnvVar === "BEDROCK_REGION"
      ? []
      : ["BEDROCK_REGION", "BEDROCK_ACCESS_KEY", "BEDROCK_SECRET_KEY"]),
  ]);

  writeFileSync(manifestPath, content);
}

function updateServiceManifestVariables(config: {
  baseUrl: string;
  defaultLlms: string;
}): void {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return;

  const manifestPath = resolve(copilotRoot, SERVICE_NAME, "manifest.yml");
  if (!existsSync(manifestPath)) return;

  let content = readFileSync(manifestPath, "utf-8");
  content = setManifestVariable(
    content,
    "NEXT_PUBLIC_BASE_URL",
    config.baseUrl,
  );
  content = content.replace(/^\s*DEFAULT_LLM_PROVIDER:.*\n?/m, "");
  content = content.replace(/^\s*DEFAULT_LLM_MODEL:.*\n?/m, "");
  content = setManifestVariable(content, "DEFAULT_LLMS", config.defaultLlms);
  writeFileSync(manifestPath, content);
}

function updateServiceManifestHttp(config: { domain?: string }): void {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return;

  const manifestPath = resolve(copilotRoot, SERVICE_NAME, "manifest.yml");
  if (!existsSync(manifestPath)) return;

  let content = readFileSync(manifestPath, "utf-8");
  content = content.replace(/^\s*#?\s*alias:.*\n?/m, "");
  content = content.replace(/^\s*#?\s*redirect_to_https:.*\n?/m, "");

  const httpBlockMatch = content.match(/http:\n\s+path: '\/'\n/);
  if (httpBlockMatch) {
    const insertLines = config.domain
      ? `  alias: ${config.domain}\n  redirect_to_https: true\n`
      : "  # alias: YOUR_DOMAIN  # 若使用自定义域名，取消注释并设置\n  # redirect_to_https: true  # 使用带 HTTPS 的域名时启用\n";
    content = content.replace(
      /http:\n\s+path: '\/'\n/,
      `http:\n  path: '/'\n${insertLines}`,
    );
  }

  writeFileSync(manifestPath, content);
}

function resetServiceManifestVariables(): void {
  const copilotRoot = findCopilotRoot();
  if (!copilotRoot) return;

  const manifestPath = resolve(copilotRoot, SERVICE_NAME, "manifest.yml");
  if (!existsSync(manifestPath)) return;

  let content = readFileSync(manifestPath, "utf-8");
  content = content.replace(
    /^\s*NEXT_PUBLIC_BASE_URL:.*$/m,
    "  NEXT_PUBLIC_BASE_URL: # 你的域名，例如 https://www.getinboxzero.com（带 http 或 https）",
  );
  content = content.replace(/^\s*DEFAULT_LLM_PROVIDER:.*\n?/m, "");
  content = content.replace(/^\s*DEFAULT_LLM_MODEL:.*\n?/m, "");
  content = content.replace(/^\s*DEFAULT_LLMS:.*$/m, "  DEFAULT_LLMS:");
  writeFileSync(manifestPath, content);
}

function setManifestVariable(
  content: string,
  key: string,
  value: string,
): string {
  const lineRegex = new RegExp(`^\\s*${key}:.*$`, "m");
  if (lineRegex.test(content)) {
    return content.replace(lineRegex, `  ${key}: ${value}`);
  }
  if (content.includes("variables:")) {
    return content.replace(
      /variables:\s*\n/,
      `variables:\n  ${key}: ${value}\n`,
    );
  }
  return content;
}

function getServiceUrl(envName: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync(
    "copilot",
    ["svc", "show", "-n", SERVICE_NAME, "--json"],
    { stdio: "pipe", env },
  );
  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout?.toString().trim();
  if (!output) return null;

  try {
    const data = JSON.parse(output) as {
      routes?: { environment: string; url: string }[];
      variables?: { environment: string; name: string; value: string }[];
    };
    const route = data.routes?.find((r) => r.environment === envName);
    if (route?.url) return route.url;

    const lbDns = data.variables?.find(
      (v) => v.environment === envName && v.name === "COPILOT_LB_DNS",
    );
    if (lbDns?.value) return `http://${lbDns.value}`;
  } catch {
    const match = output.match(/https?:\/\/[^\s"]+/);
    if (match) return match[0];
  }

  return null;
}

function initCopilotApp(
  domain: string | undefined,
  env: NodeJS.ProcessEnv,
): { success: boolean; error?: string } {
  const args = ["app", "init", APP_NAME];
  if (domain) {
    args.push("--domain", domain);
  }

  const result = spawnSync("copilot", args, { stdio: "pipe", env });

  // Ignore "already exists" error
  if (
    result.status !== 0 &&
    !result.stderr?.toString().includes("already exists")
  ) {
    return {
      success: false,
      error: result.stderr?.toString() || "初始化应用失败",
    };
  }

  return { success: true };
}

function initCopilotEnv(
  envName: string,
  profile: string,
  env: NodeJS.ProcessEnv,
): { success: boolean; error?: string } {
  const args = [
    "env",
    "init",
    "--name",
    envName,
    "--profile",
    profile,
    "--default-config",
  ];

  const result = spawnSync("copilot", args, { stdio: "pipe", env });

  // Ignore "already exists" error
  if (
    result.status !== 0 &&
    !result.stderr?.toString().includes("already exists")
  ) {
    return {
      success: false,
      error: result.stderr?.toString() || "初始化环境失败",
    };
  }

  // Ensure the environment manifest directory and file exist
  // Copilot sometimes doesn't create these with --default-config
  const copilotRoot = findCopilotRoot();
  if (copilotRoot) {
    const envManifestDir = resolve(copilotRoot, "environments", envName);
    const envManifestPath = resolve(envManifestDir, "manifest.yml");

    if (!existsSync(envManifestPath)) {
      // Create the directory
      if (!existsSync(envManifestDir)) {
        spawnSync("mkdir", ["-p", envManifestDir]);
      }

      // Generate the manifest from Copilot
      const showResult = spawnSync(
        "copilot",
        ["env", "show", "-n", envName, "--manifest"],
        { stdio: "pipe", env },
      );

      if (showResult.status === 0 && showResult.stdout) {
        writeFileSync(envManifestPath, showResult.stdout.toString());
      } else {
        // Fallback: create a minimal manifest
        const minimalManifest = `# The manifest for the "${envName}" environment.
name: ${envName}
type: Environment

observability:
  container_insights: false
`;
        writeFileSync(envManifestPath, minimalManifest);
      }
    }
  }

  return { success: true };
}

function deployCopilotEnv(
  envName: string,
  env: NodeJS.ProcessEnv,
): { success: boolean; error?: string } {
  // Verify manifest exists before deploying
  const copilotRoot = findCopilotRoot();
  if (copilotRoot) {
    const manifestPath = resolve(
      copilotRoot,
      "environments",
      envName,
      "manifest.yml",
    );
    if (!existsSync(manifestPath)) {
      return {
        success: false,
        error:
          `未找到环境清单：${manifestPath}。\n` +
          `尝试运行：copilot env show -n ${envName} --manifest > ${manifestPath}`,
      };
    }
  }

  const result = spawnSync("copilot", ["env", "deploy", "--name", envName], {
    stdio: ["inherit", "inherit", "pipe"],
    env,
  });

  const stderrOutput = result.stderr?.toString() || "";

  if (result.status !== 0) {
    const stackStatus = getEnvStackStatus(envName, env);
    if (stackStatus) {
      if (stackStatus.endsWith("_IN_PROGRESS")) {
        const waitedStatus = waitForEnvStackCompletion(envName, env);
        if (waitedStatus && isEnvStackHealthy(waitedStatus)) {
          return { success: true };
        }
      }
      if (isEnvStackHealthy(stackStatus)) {
        return { success: true };
      }
    }
    // Include the actual error for programmatic checking
    return {
      success: false,
      error:
        stderrOutput ||
        "环境部署失败。请查看上方输出了解详情。\n" +
          "常见问题：\n" +
          "- CloudFormation 堆栈处于 ROLLBACK 状态（请通过 AWS 控制台删除）\n" +
          "- IAM 权限问题（请确保使用 IAM 用户而非根账户）\n" +
          "- 网络/超时问题（重试该命令）",
    };
  }

  return { success: true };
}

function initCopilotService(env: NodeJS.ProcessEnv): {
  success: boolean;
  error?: string;
} {
  const result = spawnSync(
    "copilot",
    [
      "init",
      "--app",
      APP_NAME,
      "--name",
      SERVICE_NAME,
      "--type",
      "Load Balanced Web Service",
      "--deploy",
      "no",
    ],
    { stdio: "pipe", env },
  );

  // Ignore "already exists" error
  if (
    result.status !== 0 &&
    !result.stderr?.toString().includes("already exists")
  ) {
    return {
      success: false,
      error: result.stderr?.toString() || "初始化服务失败",
    };
  }

  return { success: true };
}

function deployCopilotService(
  envName: string,
  env: NodeJS.ProcessEnv,
): { success: boolean; error?: string } {
  const result = spawnSync(
    "copilot",
    ["svc", "deploy", "--name", SERVICE_NAME, "--env", envName],
    { stdio: "inherit", env },
  );

  if (result.status !== 0) {
    return {
      success: false,
      error: "服务部署失败",
    };
  }

  return { success: true };
}

function getEnvStackStatus(
  envName: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const stackName = `${APP_NAME}-${envName}`;
  const result = spawnSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].StackStatus",
      "--output",
      "text",
    ],
    { stdio: "pipe", env },
  );
  if (result.status !== 0) return null;
  return result.stdout.toString().trim() || null;
}

function waitForEnvStackCompletion(
  envName: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const stackName = `${APP_NAME}-${envName}`;
  const updateWait = spawnSync(
    "aws",
    [
      "cloudformation",
      "wait",
      "stack-update-complete",
      "--stack-name",
      stackName,
    ],
    { stdio: "pipe", env },
  );
  if (updateWait.status !== 0) {
    spawnSync(
      "aws",
      [
        "cloudformation",
        "wait",
        "stack-create-complete",
        "--stack-name",
        stackName,
      ],
      { stdio: "pipe", env },
    );
  }
  return getEnvStackStatus(envName, env);
}

function isEnvStackHealthy(status: string): boolean {
  return status === "CREATE_COMPLETE" || status === "UPDATE_COMPLETE";
}

function storeSecretInSsm(
  name: string,
  value: string,
  envName: string,
  env: NodeJS.ProcessEnv,
): { success: boolean; error?: string } {
  const paramName = `/copilot/${APP_NAME}/${envName}/secrets/${name}`;

  const result = putSsmParameterWithTags({
    env,
    appName: APP_NAME,
    envName,
    name: paramName,
    value,
    type: "SecureString",
    errorMessage: `Failed to store ${name}`,
    overwrite: name !== "EMAIL_ENCRYPT_SECRET" && name !== "EMAIL_ENCRYPT_SALT",
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}

function normalizeSecretReference(content: string, secretName: string): string {
  const normalized = getSecretReference(secretName);
  const pattern = new RegExp(`(^\\s+${secretName}:)\\s+.*$`, "m");
  return content.replace(pattern, `$1 ${normalized}`);
}

function getSecretReference(secretName: string): string {
  return `/copilot/\${COPILOT_APPLICATION_NAME}/\${COPILOT_ENVIRONMENT_NAME}/secrets/${secretName}`;
}

function removeSecrets(content: string, secretNames: string[]): string {
  let updated = content;
  for (const secretName of secretNames) {
    const lineRegex = new RegExp(`^\\s*${secretName}:.*\\n?`, "m");
    updated = updated.replace(lineRegex, "");
  }
  return updated;
}
