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

${branding.brandName} 是一款面向 Gmail 和 Outlook 的开源 AI 邮件助手。它通过 AI 标签和规则整理收件箱、以您的口吻撰写回复草稿、拦截冷邮件、批量退订新闻简报、展示邮件分析，并可在 Slack 或 Telegram 中使用，帮助您更快实现收件箱清零。

## 产品

- [网站](${base}/)：产品概览与注册。
- [价格](${base}/pricing)：套餐、账单和功能。
- [文档](${DOCS_ORIGIN}/)：产品指南与开发者文档。
- [Agent 资源](${base}/llms.txt)：设置、身份验证和可用接口。
- [站点地图](${base}/sitemap.xml)：可供发现的公开页面。
- [GitHub](${GITHUB_URL})：源代码与自托管。
${branding.supportEmail ? `- 支持：${branding.supportEmail}\n` : ""}
## 何时使用

使用 ${branding.brandName} 自动整理收件箱、撰写回复草稿、清理邮件或通过聊天管理邮件。

## 开始使用

1. 使用 Google 或 Microsoft 在 ${base}/login 登录并连接您的邮箱。
2. 按照[入门指南](${DOCS_ORIGIN}/essentials/getting-started)操作。
3. 如需连接 Agent，请参阅[连接 MCP](${DOCS_ORIGIN}/essentials/mcp)，并查看 [Agent 资源](${base}/llms.txt) 了解此部署可用的接口。

${getPricingMarkdown(origin, branding)}
`;
}

export function getPricingMarkdown(
  origin: string,
  branding: AgentContentBranding,
): string {
  const base = normalizeOrigin(origin);

  return `## ${branding.brandName} 价格

每个套餐都包含邮件应用（网页、桌面和 iPhone）以及 AI 功能，并提供 7 天免费试用。可随时取消。

${tiers
  .map(
    (tier) => `### ${tier.name}

${tier.description}

- 按月：每位用户每月 $${tier.price.monthly} USD，按月计费。
- 按年：每位用户每月 ${formatPrice(tier.price.annually)} USD，按年计费（每位用户每年 ${formatPrice(tier.price.annually * 12)} USD）。
- 每位用户包含 ${INCLUDED_EMAIL_ACCOUNTS_PER_PERSON} 个邮箱账号。按月度计费时，每个额外账号每月 ${formatPrice(getExtraAccountPrice(tier.price.monthly))} USD；按年度计费时，每月 ${formatPrice(getExtraAccountPrice(tier.price.annually))} USD。每位团队成员按独立用户计费。
${tier.features.map((feature) => `- ${feature.text}`).join("\n")}`,
  )
  .join("\n\n")}

### 企业版

如需 SSO、SCIM、本地部署和专属客户经理，请联系销售。企业版价格可定制。

- [价格页面](${base}/pricing)
- [产品主页](${base}/)
- [联系销售](https://www.getinboxzero.com/sales)
- [Agent 资源](${base}/llms.txt)
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

> 面向 Gmail 和 Outlook 的开源 AI 邮件助手。整理邮件、以您的写作风格撰写回复草稿、自动执行收件箱规则、拦截冷邮件、批量退订新闻简报并查看邮件分析。提供托管产品和自托管应用两种形式。

## 何时使用

使用 ${branding.brandName} 通过自然语言规则整理收件箱、以用户的口吻撰写回复草稿、清理新闻简报、拦截冷邮件、分析邮件量和响应时间、结合日历撰写草稿并提供会议背景，或通过 Slack 或 Telegram 管理邮件。它可以与 Gmail 和 Outlook 配合使用。

大多数用户建议使用托管产品。需要数据驻留或私有基础设施时请选择自托管。通过 MCP 连接助手；启用后，脚本和 HTTP 客户端可使用公共 HTTP API。

## 产品与设置

- [产品概览](${base}/)：功能与注册。
- [价格](${base}/pricing)：套餐、计费周期和功能。
- [入门指南](${DOCS_ORIGIN}/essentials/getting-started)：连接邮箱并配置邮件自动化。
- [文档](${DOCS_ORIGIN}/)：产品指南与集成参考。
- [自托管](${DOCS_ORIGIN}/hosting/self-hosting)：在您自己的基础设施上部署。

## Agent 与开发者接口

${capabilities.mcpServerAvailable ? `- [邮箱 MCP 服务器](${base}/mcp)：支持 OAuth 的 Streamable HTTP；搜索和读取邮件、创建草稿、管理规则并读取统计数据。标准访问不会发送邮件；发送邮件需要单独按应用批准 mcp:send 权限范围。\n` : ""}- [连接 MCP](${DOCS_ORIGIN}/essentials/mcp)：连接助手，并通过 Google 或 Microsoft 登录授权访问邮箱。
- [MCP 参考](${DOCS_ORIGIN}/api-reference/mcp)：OAuth 发现、S256 PKCE、权限范围和自托管配置。
${capabilities.externalApiEnabled ? `- [OpenAPI 架构](${base}/openapi.json)：用于统计、规则和发件人退订的机器可读公共 HTTP API 契约。\n` : ""}- [API 身份验证与快速入门](${DOCS_ORIGIN}/api-reference/introduction)：在设置中创建账号级 API 密钥，并在 API-Key 请求头中使用所需权限范围。
- [文档索引](${DOCS_ORIGIN}/llms.txt)：面向 Agent 的更多文档页面；文档搜索与邮箱访问相互独立。
- [主页](${base}/)：也可通过 Accept: text/markdown 请求头获取 Markdown 版本。
- [站点地图](${base}/sitemap.xml)：可供发现的公开页面。

## 源代码与支持

- [GitHub](${GITHUB_URL})：源代码与问题跟踪。
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
