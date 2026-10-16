const unsubscribeKeywords = [
  "unsubscribe",
  "email preferences",
  "email settings",
  "email options",
  "notification preferences",
];

export function containsUnsubscribeKeyword(text: string) {
  const lowerText = text.toLowerCase();
  return unsubscribeKeywords.some((keyword) => lowerText.includes(keyword));
}

// 用于检测退订 URL 的模式——检查 "unsub" 可捕获：
// - "unsubscribe"、"unsub"、"unsub-email"、"unsubscribed" 等
// 这有助于处理链接文本可能不是英文的非英文邮件，
// 但这些 URL 通常包含这些模式
const unsubscribeUrlPatterns = ["unsub", "opt-out", "optout", "list-manage"];

export function containsUnsubscribeUrlPattern(url: string) {
  const lowerUrl = url.toLowerCase();
  return unsubscribeUrlPatterns.some((pattern) => lowerUrl.includes(pattern));
}

export function cleanUnsubscribeLink(unsubscribeLink?: string | null) {
  if (!unsubscribeLink) return;

  let cleanedLink = unsubscribeLink.trim();
  if (cleanedLink.startsWith("<")) cleanedLink = cleanedLink.slice(1);
  if (cleanedLink.endsWith(">")) cleanedLink = cleanedLink.slice(0, -1);

  return cleanedLink.trim() || undefined;
}

export function parseListUnsubscribeHeader(
  listUnsubscribeHeader?: string | null,
) {
  if (!listUnsubscribeHeader) return [];

  const parts = listUnsubscribeHeader.match(/<[^>]+>|[^,]+/g) || [];
  return parts
    .map((part) => cleanUnsubscribeLink(part))
    .filter((part): part is string => Boolean(part));
}

export function getHttpUnsubscribeLink(options: {
  unsubscribeLink?: string | null;
  listUnsubscribeHeader?: string | null;
}) {
  return getMatchingUnsubscribeLink(options, ["https:", "http:"]);
}

export function getUserFacingUnsubscribeLink(options: {
  unsubscribeLink?: string | null;
  listUnsubscribeHeader?: string | null;
}) {
  return getMatchingUnsubscribeLink(options, ["https:", "http:", "mailto:"]);
}

function getMatchingUnsubscribeLink(
  options: {
    unsubscribeLink?: string | null;
    listUnsubscribeHeader?: string | null;
  },
  allowedProtocols: string[],
) {
  const headerLinks = parseListUnsubscribeHeader(options.listUnsubscribeHeader);
  const fallbackLinks = parseStoredUnsubscribeLinks(options.unsubscribeLink);

  const allLinks = [...headerLinks, ...fallbackLinks];

  // 协议顺序是一种偏好，而不仅仅是一种过滤。发件人常常先列出
  // mailto，而给读者一封待发送的草稿邮件不如
  // 打开一个页面，因此在回退到 mailto 之前先尝试所有网页链接。
  for (const protocol of allowedProtocols) {
    for (const link of allLinks) {
      const normalizedLink = normalizeAllowedUnsubscribeLink(link, [protocol]);
      if (normalizedLink) return normalizedLink;
    }
  }

  return;
}

function parseStoredUnsubscribeLinks(unsubscribeLink?: string | null) {
  if (!unsubscribeLink) return [];

  if (hasMultipleBracketedUnsubscribeLinks(unsubscribeLink)) {
    return parseListUnsubscribeHeader(unsubscribeLink);
  }

  const cleanedLink = cleanUnsubscribeLink(unsubscribeLink);
  if (!cleanedLink) return [];

  if (isSingleUnsubscribeLink(cleanedLink)) return [cleanedLink];

  return parseListUnsubscribeHeader(unsubscribeLink);
}

function normalizeAllowedUnsubscribeLink(
  link: string,
  allowedProtocols: string[],
) {
  try {
    const url = new URL(link);
    if (!allowedProtocols.includes(url.protocol)) return;
    return url.toString();
  } catch {
    return;
  }
}

function isSingleUnsubscribeLink(link: string) {
  try {
    new URL(link);
    return true;
  } catch {
    return false;
  }
}

function hasMultipleBracketedUnsubscribeLinks(link: string) {
  return (link.match(/<[^>]+>/g)?.length || 0) > 1;
}
