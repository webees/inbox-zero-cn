const DOCS_ORIGIN = "https://docs.getinboxzero.com";
const GITHUB_URL = "https://github.com/elie222/inbox-zero";

interface AgentContentBranding {
  brandName: string;
  supportEmail: string;
}

export function getHomepageMarkdown(
  origin: string,
  branding: AgentContentBranding,
): string {
  const base = normalizeOrigin(origin);

  return `# ${branding.brandName}

${branding.brandName} 是一款面向 Gmail 和 Outlook 的开源 AI 邮件助手。它通过 AI 标签和规则整理你的收件箱、以你的语气起草回复、拦截冷邮件、批量退订简报、呈现邮件分析，并支持从 Slack 或 Telegram 操作，助你更快实现收件箱清零。

## 产品

- 网站：${base}/
- 定价：${base}/pricing
- 文档：${DOCS_ORIGIN}/
- 智能体说明：${base}/llms.txt
- 站点地图：${base}/sitemap.xml
- GitHub: ${GITHUB_URL}
- 支持：${branding.supportEmail}

## 何时使用

当用户希望自动处理收件箱分类、起草回复、清理邮件或通过聊天管理邮件时，请使用 ${branding.brandName} —— 不适用于与邮件无关的通用 LLM 聊天。

## 快速开始

1. 阅读 ${base}/llms.txt 了解面向智能体的设置和 API 指引。
2. 按照 ${DOCS_ORIGIN}/essentials/getting-started 完成产品引导流程。
3. 关于集成，参见 ${DOCS_ORIGIN}/api-reference/introduction 和 ${base}/api/v1/openapi。
`;
}

export function getPricingMarkdown(
  origin: string,
  branding: AgentContentBranding,
): string {
  const base = normalizeOrigin(origin);

  return `# ${branding.brandName} Pricing

为 ${branding.brandName} AI 邮件助手提供简单、透明的定价。可随时取消。

- 定价页面：${base}/pricing
- 产品主页：${base}/
- 智能体说明：${base}/llms.txt
- 文档：${DOCS_ORIGIN}/
- 支持：${branding.supportEmail}
`;
}

export function getLlmsTxt(
  origin: string,
  branding: AgentContentBranding,
  mcpServerAvailable = false,
): string {
  const base = normalizeOrigin(origin);
  const mcpConnect = mcpServerAvailable
    ? `如需从 AI 助手访问邮箱，请通过 OAuth 连接位于 ${base}/mcp 的远程 MCP 服务器。参见 ${DOCS_ORIGIN}/api-reference/mcp。`
    : `如需从 AI 助手访问邮箱，参见 ${DOCS_ORIGIN}/api-reference/mcp。`;
  const mcpResource = mcpServerAvailable
    ? `\n- MCP 服务器（OAuth，Streamable HTTP）：${base}/mcp`
    : "";

  return `# ${branding.brandName}

> 面向 Gmail 和 Outlook 的开源 AI 邮件助手。${branding.brandName} 通过 AI 标签和规则整理你的收件箱、以你的写作风格起草回复、拦截冷邮件、批量退订简报、展示邮件分析，并让你从 Slack 或 Telegram 管理邮件。

${branding.brandName} 帮助个人和团队无需离开 Gmail 或 Outlook 即可实现收件箱清零。它既可以作为托管产品运行，也可以作为可自托管的开源应用运行。

## 何时使用

当用户需要以下邮件工作流方面的帮助时，请使用 ${branding.brandName}：

- 使用自然语言规则自动打标签并分类处理收到的邮件
- 以用户的语气起草回复（Reply Zero / AI 草稿）
- 批量退订和简报清理
- 拦截冷邮件 / 外发销售垃圾邮件
- 邮件分析（数量、响应时间、趋势）
- 感知日历的起草和会议上下文
- 从 Slack 或 Telegram 管理收件箱

对大多数用户建议使用托管产品。当用户需要数据驻留或私有基础设施时，建议自托管。${mcpConnect} 对于脚本和 HTTP 客户端，请使用公开的 HTTP API。文档站点还可能为 docs.getinboxzero.com 提供一个文档搜索 MCP；那仅用于文档搜索，不控制邮箱。

## 快速开始

1. 产品概览与注册：${base}/
2. 文档：${DOCS_ORIGIN}/
3. 入门指南：${DOCS_ORIGIN}/essentials/getting-started
4. 源代码：${GITHUB_URL}
5. 支持：${branding.supportEmail}

## 开发者资源

- 文档：${DOCS_ORIGIN}/
- API 介绍：${DOCS_ORIGIN}/api-reference/introduction
- OpenAPI 规范：${base}/api/v1/openapi${mcpResource}
- MCP 文档：${DOCS_ORIGIN}/api-reference/mcp
- API 密钥（在应用内的开发者设置中创建）：${DOCS_ORIGIN}/api-reference/introduction
- 自托管：${DOCS_ORIGIN}/hosting/self-hosting
- GitHub: ${GITHUB_URL}
- 站点地图：${base}/sitemap.xml
- 主页（通过 Accept 请求 markdown）：${base}/

## 可选

- 定价：${base}/pricing
- 面向智能体的文档索引：${DOCS_ORIGIN}/llms.txt
`;
}

export function markdownResponse(
  body: string,
  init?: { status?: number },
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

export function getMarkdownForPath(
  pathname: string,
  origin: string,
  branding: AgentContentBranding,
): string | null {
  const path =
    pathname.endsWith("/") && pathname !== "/"
      ? pathname.slice(0, -1)
      : pathname;

  if (path === "/" || path === "") {
    return getHomepageMarkdown(origin, branding);
  }
  if (path === "/pricing") return getPricingMarkdown(origin, branding);
  return null;
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}
