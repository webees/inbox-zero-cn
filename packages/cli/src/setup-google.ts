import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import { generateSecret } from "./utils";
import { setupPubSubSubscription } from "./google-pubsub";

// ═══════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════

interface GcloudPrerequisites {
  authenticated: boolean;
  installed: boolean;
  projectId: string | null;
}

interface SetupResult {
  error?: string;
  success: boolean;
}

export interface GoogleSetupOptions {
  domain?: string;
  projectId?: string;
  skipOauth?: boolean;
  skipPubsub?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 主设置函数
// ═══════════════════════════════════════════════════════════════════════════

export async function runGoogleSetup(options: GoogleSetupOptions) {
  p.intro("Inbox Zero 的 Google Cloud 设置");

  // 步骤 1：检查前置条件
  const spinner = p.spinner();
  spinner.start("正在检查 gcloud CLI...");

  const prereqs = checkGcloudPrerequisites();

  if (!prereqs.installed) {
    spinner.stop("未找到 gcloud CLI");
    p.log.error(
      "未安装 gcloud CLI。\n" +
        "请从以下地址安装：https://cloud.google.com/sdk/docs/install\n" +
        "安装后运行：gcloud auth login",
    );
    process.exit(1);
  }

  spinner.stop("已找到 gcloud CLI");

  // 步骤 2：确保认证
  if (!prereqs.authenticated) {
    p.log.warn("你尚未通过 gcloud 认证。");
    const authenticate = await p.confirm({
      message: "要现在进行认证吗？",
      initialValue: true,
    });

    if (p.isCancel(authenticate) || !authenticate) {
      p.cancel("已取消设置。请先手动运行 'gcloud auth login'。");
      process.exit(0);
    }

    p.log.info("正在打开浏览器进行认证...");
    spawnSync("gcloud", ["auth", "login"], { stdio: "inherit" });
  }

  // 步骤 3：获取项目 ID
  let projectId = options.projectId || prereqs.projectId;

  if (!projectId) {
    const inputProjectId = await p.text({
      message: "请输入你的 Google Cloud 项目 ID：",
      placeholder: "my-project-123",
      validate: (v) => (v ? undefined : "必须填写项目 ID"),
    });

    if (p.isCancel(inputProjectId)) {
      p.cancel("已取消设置。");
      process.exit(0);
    }

    projectId = inputProjectId;
  } else {
    p.log.info(`正在使用项目：${projectId}`);
  }

  // 步骤 4：获取域名（OAuth 重定向 URI 和 Pub/Sub webhook 需要）
  let domain = options.domain;

  if (!domain) {
    const inputDomain = await p.text({
      message: "请输入你的应用域名（用于 OAuth 重定向和 Pub/Sub webhook）：",
      placeholder: "app.example.com",
      validate: (v) => {
        if (!v) return; // 允许留空以便本地开发
        if (!v.includes(".")) return "请输入有效的域名";
        return;
      },
    });

    if (p.isCancel(inputDomain)) {
      p.cancel("已取消设置。");
      process.exit(0);
    }

    domain = inputDomain || undefined;
  }

  // 步骤 5：启用所需 API
  spinner.start(
    "正在启用 Google Cloud API（Gmail、People、Calendar、Drive、Pub/Sub）...",
  );

  const apiResult = enableGoogleApis(projectId);

  if (!apiResult.success) {
    spinner.stop("启用 API 失败");
    p.log.error(apiResult.error || "未知错误");
    process.exit(1);
  }

  spinner.stop("已成功启用 API");

  // 步骤 6：OAuth 同意屏幕指引（如果未跳过）
  let clientId = "";
  let clientSecret = "";

  if (!options.skipOauth) {
    const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`;

    p.note(
      `创建 OAuth 凭据前，你需要配置同意屏幕。

步骤：
1. 如果显示横幅，点击 "Get Started"
2. 用户类型：
   - "Internal" — 仅限 Google Workspace，所有组织成员都可登录
   - "External" — 任意 Google 账号（包括个人 Gmail）
     你需要把自己添加为测试用户（步骤 7）
3. 应用名称："Inbox Zero"（或你偏好的名称）
4. 用户支持邮箱：你的邮箱
5. 开发者联系方式：你的邮箱
6. 在权限范围部分依次点击 "Save and Continue"
7. 如果选择 External：将你的邮箱添加为测试用户
8. 完成向导

控制台将在你的浏览器中打开。`,
      "OAuth 同意屏幕",
    );

    const openConsent = await p.confirm({
      message: "在浏览器中打开 OAuth 同意屏幕吗？",
      initialValue: true,
    });

    if (openConsent && !p.isCancel(openConsent)) {
      openBrowser(consentUrl);
    }

    const consentDone = await p.confirm({
      message: "你已完成同意屏幕设置吗？",
      initialValue: false,
    });

    if (p.isCancel(consentDone) || !consentDone) {
      p.log.warn("你可以继续，但在配置同意屏幕之前 OAuth 无法正常工作。");
    }

    // 步骤 7：OAuth 凭据指引
    const credentialsUrl = `https://console.cloud.google.com/apis/credentials/oauthclient?project=${projectId}`;
    const redirectUris = domain
      ? `   - https://${domain}/api/auth/callback/google
   - https://${domain}/api/google/linking/callback
   - https://${domain}/api/google/calendar/callback
   - https://${domain}/api/google/drive/callback`
      : `   - http://localhost:3000/api/auth/callback/google
   - http://localhost:3000/api/google/linking/callback
   - http://localhost:3000/api/google/calendar/callback
   - http://localhost:3000/api/google/drive/callback`;

    p.note(
      `现在创建 OAuth 2.0 凭据：

1. 选择 "Web application" 作为应用类型
2. 名称："Inbox Zero"（或你偏好的名称）
3. 添加已获授权的重定向 URI：
${redirectUris}
4. 点击 "Create"
5. 复制 Client ID 和 Client Secret

控制台将在你的浏览器中打开。`,
      "OAuth 凭据",
    );

    const openCredentials = await p.confirm({
      message: "在浏览器中打开 OAuth 凭据页面吗？",
      initialValue: true,
    });

    if (openCredentials && !p.isCancel(openCredentials)) {
      openBrowser(credentialsUrl);
    }

    const oauthInput = await p.group(
      {
        clientId: () =>
          p.text({
            message: "粘贴你的 Google Client ID：",
            placeholder: "123456789012-abc.apps.googleusercontent.com",
            validate: (v) => {
              if (!v) return; // 允许留空以跳过
              if (!v.endsWith(".apps.googleusercontent.com")) {
                return "Client ID 应以 .apps.googleusercontent.com 结尾";
              }
              return;
            },
          }),
        clientSecret: () =>
          p.text({
            message: "粘贴你的 Google Client Secret：",
            placeholder: "GOCSPX-...",
          }),
      },
      {
        onCancel: () => {
          p.cancel("已取消设置。");
          process.exit(0);
        },
      },
    );

    clientId = oauthInput.clientId || "";
    clientSecret = oauthInput.clientSecret || "";
  }

  // 步骤 8：Pub/Sub 设置（自动化）
  const topicName = "inbox-zero-emails";
  const subscriptionName = "inbox-zero-subscription";
  const verificationToken = generateSecret(32);
  let topicFullName = "";
  let pubsubSuccess = false;

  if (!options.skipPubsub && domain) {
    const webhookUrl = `https://${domain}/api/google/webhook?token=${verificationToken}`;
    topicFullName = `projects/${projectId}/topics/${topicName}`;

    spinner.start("正在创建 Pub/Sub 主题...");

    const topicResult = setupPubSubTopic(projectId, topicName);

    if (!topicResult.success) {
      spinner.stop("创建 Pub/Sub 主题失败");
      p.log.error(topicResult.error || "未知错误");
      p.log.warn("你可以稍后手动设置 Pub/Sub。");
    } else {
      spinner.stop("已创建具有 Gmail 权限的 Pub/Sub 主题");

      spinner.start("正在创建 Pub/Sub 推送订阅...");

      const subResult = setupPubSubSubscription(
        projectId,
        topicName,
        subscriptionName,
        webhookUrl,
      );

      if (!subResult.success) {
        spinner.stop("创建订阅失败");
        p.log.error(subResult.error || "未知错误");
        p.log.warn(
          "你可以手动创建订阅：\n" +
            `gcloud pubsub subscriptions create ${subscriptionName} --topic=${topicName} --push-endpoint="${webhookUrl}" --project=${projectId}`,
        );
      } else {
        spinner.stop("已创建 Pub/Sub 订阅");
        pubsubSuccess = true;
      }
    }
  }

  // 步骤 9：输出环境变量
  const envVars: string[] = [];

  if (clientId) {
    envVars.push(`GOOGLE_CLIENT_ID=${clientId}`);
  }
  if (clientSecret) {
    envVars.push(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
  }
  // 即使失败也始终输出 Pub/Sub 变量（尝试过就输出），以便用户完成手动设置
  if (!options.skipPubsub && domain) {
    envVars.push(`GOOGLE_PUBSUB_TOPIC_NAME=${topicFullName}`);
    envVars.push(`GOOGLE_PUBSUB_VERIFICATION_TOKEN=${verificationToken}`);
  }

  if (envVars.length > 0) {
    p.note(`将这些添加到你的 .env 文件：\n\n${envVars.join("\n")}`, "环境变量");
  }

  // 摘要
  const summary = [
    "✓ 已启用 API（Gmail、People、Calendar、Drive、Pub/Sub）",
    options.skipOauth
      ? "✗ 已跳过 OAuth 设置"
      : clientId
        ? "✓ 已配置 OAuth 凭据"
        : "! 未提供 OAuth 凭据",
    options.skipPubsub
      ? "✗ 已跳过 Pub/Sub 设置"
      : !domain
        ? "! 已跳过 Pub/Sub 设置（未提供域名）"
        : pubsubSuccess
          ? "✓ 已创建 Pub/Sub 主题和订阅"
          : "! Pub/Sub 设置未完成（已提供环境变量以便手动设置）",
  ].join("\n");

  p.note(summary, "设置摘要");

  p.outro("Google Cloud 设置完成！");
}

// ═══════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

function checkGcloudPrerequisites(): GcloudPrerequisites {
  // 检查是否已安装 gcloud
  const versionResult = spawnSync("gcloud", ["--version"], { stdio: "pipe" });
  if (versionResult.status !== 0) {
    return { installed: false, authenticated: false, projectId: null };
  }

  // 检查认证
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

  // 获取当前项目 ID
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

function enableGoogleApis(projectId: string): SetupResult {
  const apis = [
    "gmail.googleapis.com",
    "people.googleapis.com",
    "calendar-json.googleapis.com",
    "drive.googleapis.com",
    "pubsub.googleapis.com",
  ];

  const result = spawnSync(
    "gcloud",
    ["services", "enable", ...apis, "--project", projectId],
    { stdio: "pipe" },
  );

  if (result.status !== 0) {
    return {
      success: false,
      error: result.stderr?.toString() || "启用 API 失败",
    };
  }

  return { success: true };
}

function setupPubSubTopic(projectId: string, topicName: string): SetupResult {
  // 创建主题
  const createResult = spawnSync(
    "gcloud",
    ["pubsub", "topics", "create", topicName, "--project", projectId],
    { stdio: "pipe" },
  );

  // 忽略 "already exists" 错误
  if (
    createResult.status !== 0 &&
    !createResult.stderr?.toString().includes("ALREADY_EXISTS")
  ) {
    return {
      success: false,
      error: createResult.stderr?.toString() || "创建主题失败",
    };
  }

  // 授予 Gmail 服务账号发布权限
  const bindingResult = spawnSync(
    "gcloud",
    [
      "pubsub",
      "topics",
      "add-iam-policy-binding",
      topicName,
      "--member=serviceAccount:gmail-api-push@system.gserviceaccount.com",
      "--role=roles/pubsub.publisher",
      "--project",
      projectId,
    ],
    { stdio: "pipe" },
  );

  if (bindingResult.status !== 0) {
    return {
      success: false,
      error: bindingResult.stderr?.toString() || "添加 IAM 绑定失败",
    };
  }

  return { success: true };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  // Windows 的 'start' 是 shell 内置命令，不是可执行文件
  spawnSync(cmd, [url], { stdio: "pipe", shell: platform === "win32" });
}
