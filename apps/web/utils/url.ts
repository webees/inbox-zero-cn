import { extractDomainFromEmail } from "@/utils/email";

export function createSearchParams(params: Record<string, unknown>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    searchParams.set(key, String(value));
  }

  return searchParams;
}

function getGmailUrlForFragment(
  fragment: string,
  emailAddress?: string | null,
) {
  if (!emailAddress) return `https://mail.google.com/mail/u/0/#${fragment}`;

  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(emailAddress)}#${fragment}`;
}

// 个人 Microsoft 账号（outlook / hotmail / live / msn）在
// outlook.live.com 登录；其他都是 Entra ID / Microsoft 365 邮箱，
// 由 outlook.office.com 提供服务。这两个主机路由到不同的服务，因此
// 将企业用户指向 outlook.live.com 会把他们带到主页。
// 前缀匹配可覆盖 outlook.fr、live.co.uk、hotmail.de 等国家/地区变体。
const PERSONAL_MICROSOFT_DOMAIN_PREFIXES = ["outlook.", "hotmail.", "live."];
const PERSONAL_MICROSOFT_DOMAINS = new Set(["msn.com", "passport.com"]);

function isPersonalMicrosoftEmail(emailAddress?: string | null) {
  if (!emailAddress) return false;
  const domain = extractDomainFromEmail(emailAddress).toLowerCase();
  if (!domain) return false;
  if (PERSONAL_MICROSOFT_DOMAINS.has(domain)) return true;
  return PERSONAL_MICROSOFT_DOMAIN_PREFIXES.some((prefix) =>
    domain.startsWith(prefix),
  );
}

function getOutlookBaseUrl(isPersonalMailbox: boolean) {
  return isPersonalMailbox
    ? "https://outlook.live.com/mail/0"
    : "https://outlook.office.com/mail";
}

const OUTLOOK_WEB_HOSTS = new Set([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
]);

// Graph 的 `webLink` 会被重定向，因此仅允许 Outlook 主机。
function toOutlookReadingPaneUrl(webLink?: string | null) {
  if (!webLink) return null;

  let url: URL;
  try {
    url = new URL(webLink);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!OUTLOOK_WEB_HOSTS.has(url.hostname.toLowerCase())) return null;

  url.searchParams.set("ispopout", "0");
  return url.toString();
}

// 仅包含构建草稿深度链接所需的字段。
type DraftLinkTarget = {
  id: string;
  threadId?: string | null;
  externalUrl?: string | null;
};

type SearchField = "from" | "to";

type ProviderUrlConfig = {
  requiresMessageId: boolean;
  buildUrl: (messageOrThreadId: string, emailAddress?: string | null) => string;
  buildDraftUrl: (
    draft: DraftLinkTarget,
    emailAddress?: string | null,
  ) => string | null;
  selectId: (messageId: string, threadId: string) => string;
  buildSearchUrl: (
    field: SearchField,
    address: string,
    emailAddress?: string | null,
  ) => string;
};

const GOOGLE_CONFIG: ProviderUrlConfig = {
  requiresMessageId: false,
  buildUrl: (messageOrThreadId: string, emailAddress?: string | null) =>
    getGmailUrlForFragment(`all/${messageOrThreadId}`, emailAddress),
  // Gmail 的写信深度链接使用无法从 API id 推导出的内部 id，
  // 因此草稿本身无法打开。但它的会话可以打开，而草稿箱是
  // 唯一包含它的标签。
  buildDraftUrl: (draft: DraftLinkTarget, emailAddress?: string | null) =>
    getGmailUrlForFragment(
      `drafts/${encodeURIComponent(draft.threadId || draft.id)}`,
      emailAddress,
    ),
  selectId: (messageId: string, _threadId: string) => messageId,
  buildSearchUrl: (
    field: SearchField,
    address: string,
    emailAddress?: string | null,
  ) =>
    getGmailUrlForFragment(
      `advanced-search/${field}=${encodeURIComponent(address)}`,
      emailAddress,
    ),
};

const PROVIDER_CONFIG: Record<string, ProviderUrlConfig> = {
  microsoft: {
    requiresMessageId: true,
    buildUrl: (messageOrThreadId: string, emailAddress?: string | null) => {
      const encodedMessageId = encodeURIComponent(messageOrThreadId);
      return `${getOutlookBaseUrl(isPersonalMicrosoftEmail(emailAddress))}/inbox/id/${encodedMessageId}`;
    },
    buildDraftUrl: (draft: DraftLinkTarget, emailAddress?: string | null) => {
      const readingPaneUrl = toOutlookReadingPaneUrl(draft.externalUrl);
      if (readingPaneUrl) return readingPaneUrl;

      return draft.id
        ? `${getOutlookBaseUrl(isPersonalMicrosoftEmail(emailAddress))}/drafts/id/${encodeURIComponent(draft.id)}`
        : null;
    },
    selectId: (messageId: string, _threadId: string) => messageId,
    buildSearchUrl: (
      field: SearchField,
      address: string,
      emailAddress?: string | null,
    ) => {
      const query = encodeURIComponent(`${field}:${address}`);
      return `${getOutlookBaseUrl(isPersonalMicrosoftEmail(emailAddress))}/search/q/${query}`;
    },
  },
  google: GOOGLE_CONFIG,
  default: {
    ...GOOGLE_CONFIG,
    selectId: (_messageId: string, threadId: string) => threadId,
  },
} as const;

function getProviderConfig(
  provider?: string,
): (typeof PROVIDER_CONFIG)[keyof typeof PROVIDER_CONFIG] {
  if (!provider) return PROVIDER_CONFIG.default;
  return PROVIDER_CONFIG[provider] ?? PROVIDER_CONFIG.default;
}

export function getEmailUrl(
  messageOrThreadId: string,
  emailAddress?: string | null,
  provider?: string,
): string {
  const config = getProviderConfig(provider);
  return config.buildUrl(messageOrThreadId, emailAddress);
}

/**
 * 传入的是草稿邮件本身而非 id，因为 Gmail 链接到
 * 草稿所在的会话，而 Outlook 链接到其消息。通过
 * `EmailProvider.getDraft` at link time — its message id changes on every edit.
 *
 * Outlook 通过 Graph 的 `webLink` 打开草稿，回退到草稿箱。
 * Gmail 返回草稿箱会话 URL（写信深度链接需要 API
 * 未暴露的内部 id）。
 */
export function getEmailDraftUrl(
  draft: DraftLinkTarget,
  emailAddress?: string | null,
  provider?: string,
): string | null {
  const config = getProviderConfig(provider);
  return config.buildDraftUrl(draft, emailAddress);
}

/**
 * 根据服务商和可用 ID 获取合适的邮件 URL。
 * 对于 Google，如果有 messageId 则使用它，否则使用 threadId。
 * 对于其他服务商，使用 threadId。
 */
export function getEmailUrlForMessage(
  messageId: string,
  threadId: string,
  emailAddress?: string | null,
  provider?: string,
) {
  const config = getProviderConfig(provider);
  const idToUse = config?.selectId(messageId, threadId);

  return getEmailUrl(idToUse, emailAddress, provider);
}

export function getEmailUrlForOptionalMessage({
  messageId,
  threadId,
  emailAddress,
  provider,
  externalUrl,
}: {
  messageId?: string | null;
  threadId?: string | null;
  emailAddress?: string | null;
  provider?: string;
  externalUrl?: string | null;
}) {
  if (provider === "microsoft") return toOutlookReadingPaneUrl(externalUrl);

  const config = getProviderConfig(provider);
  if (config.requiresMessageId && !messageId) return null;

  const resolvedMessageId = messageId || threadId;
  const resolvedThreadId = threadId || messageId;
  if (!resolvedMessageId || !resolvedThreadId) return null;

  return getEmailUrlForMessage(
    resolvedMessageId,
    resolvedThreadId,
    emailAddress,
    provider,
  );
}

// 为向后兼容保留旧函数名
export function getGmailUrl(
  messageOrThreadId: string,
  emailAddress?: string | null,
) {
  return getEmailUrl(messageOrThreadId, emailAddress, "google");
}

export function getGmailSearchUrl(from: string, emailAddress?: string | null) {
  const config = getProviderConfig("google");
  return config.buildSearchUrl("from", from, emailAddress);
}

const OPEN_IN_MAILBOX_LABELS: Record<string, string> = {
  google: "在 Gmail 中打开",
  microsoft: "在 Outlook 中打开",
};

export function getOpenInMailboxLabel(provider?: string | null) {
  if (!provider) return null;
  return OPEN_IN_MAILBOX_LABELS[provider] ?? null;
}

export function getEmailSearchUrl(
  address: string,
  emailAddress?: string | null,
  provider?: string,
  field: SearchField = "from",
) {
  const config = provider ? PROVIDER_CONFIG[provider] : undefined;
  if (!config)
    return PROVIDER_CONFIG.default.buildSearchUrl(field, address, emailAddress);
  return config.buildSearchUrl(field, address, emailAddress);
}

export function getGmailBasicSearchUrl(emailAddress: string, query: string) {
  return getGmailUrlForFragment(
    `search/${encodeURIComponent(query)}`,
    emailAddress,
  );
}

export function getGmailFilterSettingsUrl(emailAddress?: string | null) {
  return getGmailUrlForFragment("settings/filters", emailAddress);
}
