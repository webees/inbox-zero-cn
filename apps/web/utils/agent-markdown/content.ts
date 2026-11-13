import {
  formatPrice,
  getExtraAccountPrice,
  INCLUDED_EMAIL_ACCOUNTS_PER_PERSON,
  tiers,
} from "@/app/(app)/premium/config";

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

${branding.brandName} 是一款适用于 Gmail 和 Outlook 的开源 AI 邮件助手。它通过 AI 标签和规则整理你的收件箱、以你的语气撰写回复草稿、拦截冷邮件、批量退订新闻邮件、展示邮件分析，并支持从 Slack 或 Telegram 使用，帮助你更快实现收件箱清零。

## 产品

- [网站](${base}/)：产品概览与注册。
- [价格](${base}/pricing)：套餐、账单和功能。
- [文档](${DOCS_ORIGIN}/)：产品指南和开发者文档。
- [智能体资源](${base}/llms.txt)：设置、认证和可用接口。
- [站点地图](${base}/sitemap.xml)：可供发现的公开页面。
- [GitHub](${GITHUB_URL})：源代码和自托管。
${branding.supportEmail ? `- 支持：${branding.supportEmail}\n` : ""}
## 何时使用

使用 ${branding.brandName} 自动分类收件箱、撰写回复草稿、清理邮件，或通过聊天管理邮件。

## 开始使用

1. 使用 Google 或 Microsoft 在 ${base}/login 登录并连接你的邮箱。
2. 按照[入门指南](${DOCS_ORIGIN}/essentials/getting-started)操作。
3. 如需连接智能体，请遵循[连接 MCP](${DOCS_ORIGIN}/essentials/mcp)，并查看[智能体资源](${base}/llms.txt)以了解此部署可用的接口。

${getPricingMarkdown(origin, branding)}
`;
}

export function getPricingMarkdown(
  origin: string,
  branding: AgentContentBranding,
): string {
  const base = normalizeOrigin(origin);

  return `## ${branding.brandName} 价格

邮件应用：网页、桌面端和 iPhone 免费。AI 功能需付费套餐，提供 7 天免费试用。可随时取消。

${tiers
  .map(
    (tier) => `### ${tier.name}

${tier.description}

- 按月：每用户每月 $${tier.price.monthly} 美元，按月计费。
- 按年：每用户每月 ${formatPrice(tier.price.annually)} 美元，按年计费（每用户每年 ${formatPrice(tier.price.annually * 12)} 美元）。
- 每用户包含 ${INCLUDED_EMAIL_ACCOUNTS_PER_PERSON} 个邮箱账号。按月计费时，每个额外账号每月 ${formatPrice(getExtraAccountPrice(tier.price.monthly))} 美元；按年计费时，每个额外账号每月 ${formatPrice(getExtraAccountPrice(tier.price.annually))} 美元。每位团队成员作为单独的用户计费。
${tier.features.map((feature) => `- ${feature.text}`).join("\n")}`,
  )
  .join("\n\n")}

### 企业版

如需 SSO、SCIM、本地部署和专属客户经理，请联系销售。企业版价格根据需求定制。

- [价格页面](${base}/pricing)
- [产品主页](${base}/)
- [联系销售](https://www.getinboxzero.com/sales)
- [智能体资源](${base}/llms.txt)
- [文档](${DOCS_ORIGIN}/)
${branding.supportEmail ? `- 支持：${branding.supportEmail}\n` : ""}`;
}

export function getLlmsTxt(
  origin: string,
  branding: AgentContentBranding,
  capabilities: { externalApiEnabled: boolean; mcpServerAvailable: boolean },
): string {
  const base = normalizeOrigin(origin);

  return `# ${branding.brandName}

> 适用于 Gmail 和 Outlook 的开源 AI 邮件助手。整理邮件、以你的写作风格撰写回复草稿、自动化收件箱规则、拦截冷邮件、批量退订新闻邮件，并查看邮件分析。提供托管产品，也可自托管部署。

## 何时使用

使用 ${branding.brandName} 通过自然语言规则分类收件箱、以用户语气撰写回复草稿、清理新闻邮件、拦截冷邮件、分析邮件量和响应时间、结合日历撰写草稿和提供会议背景，或通过 Slack 或 Telegram 管理邮件。它可以与 Gmail 和 Outlook 配合使用。

大多数用户建议使用托管产品。如需数据驻留或私有基础设施，可选择自托管。通过 MCP 连接助手；启用后可使用公开 HTTP API 供脚本和 HTTP 客户端调用。

## 产品与设置

- [产品概览](${base}/)：功能与注册。
- [价格](${base}/pricing)：免费邮件应用、付费 AI 套餐、计费周期和功能。
- [入门指南](${DOCS_ORIGIN}/essentials/getting-started)：连接邮箱并配置邮件自动化。
- [文档](${DOCS_ORIGIN}/)：产品指南和集成参考。
- [自托管](${DOCS_ORIGIN}/hosting/self-hosting)：部署到你自己的基础设施。

## 智能体与开发者接口

${capabilities.mcpServerAvailable ? `- [邮箱 MCP 服务器](${base}/mcp)：带 OAuth 的 Streamable HTTP；搜索和读取邮件、创建草稿、管理规则并读取统计数据。标准访问不会发送邮件；发送需要单独为每个应用批准 mcp:send 权限范围。\n` : ""}- [连接 MCP](${DOCS_ORIGIN}/essentials/mcp)：连接助手并使用 Google 或 Microsoft 登录授权邮箱访问。
- [MCP 参考](${DOCS_ORIGIN}/api-reference/mcp)：OAuth 发现、S256 PKCE、权限范围和自托管配置。
${capabilities.externalApiEnabled ? `- [OpenAPI 架构](${base}/openapi.json)：用于统计、规则和发件人退订的机器可读公开 HTTP API 契约。\n` : ""}- [API 认证与快速入门](${DOCS_ORIGIN}/api-reference/introduction)：在设置中创建账号范围的 API 密钥，并在 API-Key 请求头中使用所需权限范围。
- [文档索引](${DOCS_ORIGIN}/llms.txt)：供智能体使用的更多文档页面；文档搜索与邮箱访问相互独立。
- [主页](${base}/)：也可通过 Accept: text/markdown 请求头获取 Markdown 版本。
- [站点地图](${base}/sitemap.xml)：可供发现的公开页面。

## 源代码与支持

- [GitHub](${GITHUB_URL})：源代码和问题跟踪。
${branding.supportEmail ? `- [支持](mailto:${branding.supportEmail})：产品帮助。\n` : ""}`;
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
