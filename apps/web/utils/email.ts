import type { ParsedMessage } from "@/utils/types";
import { z } from "zod";

const emailSchema = z.string().email();

// 将 "John Doe <john.doe@gmail>" 转换为 "John Doe"
// 将 '"Doe, John" <john.doe@gmail>' 转换为 "Doe, John"
// 将 "<john.doe@gmail>" 转换为 "john.doe@gmail"
// 将 "john.doe@gmail" 转换为 "john.doe@gmail"
export function extractNameFromEmail(email: string) {
  if (!email) return "";
  const firstPart = email.split("<")[0]?.trim();
  if (firstPart) return unquoteDisplayName(firstPart);
  const secondPart = email.split("<")?.[1]?.trim();
  if (secondPart) return secondPart.split(">")[0];
  return email;
}

// 从逗号分隔的头部字符串中提取所有邮箱地址
// 例如 "John <john@example.com>, Jane <jane@example.com>" -> ["john@example.com", "jane@example.com"]
export function extractEmailAddresses(header: string): string[] {
  return splitRecipientList(header)
    .map((part) => extractEmailAddress(part))
    .filter((email) => email.length > 0);
}

export function splitRecipientList(recipientList: string): string[] {
  if (!recipientList) return [];

  // 一次遍历，而不是统计引号的正则：头部来自发件人，
  // 而这段代码会在每封同步的邮件上运行。
  const recipients: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < recipientList.length; index++) {
    const char = recipientList[index];
    if (inQuotes && char === "\\") index++;
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) {
      recipients.push(recipientList.slice(start, index));
      start = index + 1;
    }
  }
  recipients.push(recipientList.slice(start));

  return recipients.map((recipient) => recipient.trim()).filter(Boolean);
}

// 将 "John Doe <john.doe@gmail>" 转换为 "john.doe@gmail"
export function extractEmailAddress(email: string): string {
  if (!email) return "";

  // 在开头统一去除首尾空格
  const trimmedEmail = email.trim();

  // 首先尝试从尖括号中提取
  const bracketMatch = trimmedEmail.match(/<([^<>]+)>$/);
  if (bracketMatch) {
    const candidate = bracketMatch[1].trim();
    if (isValidEmail(candidate)) {
      return candidate;
    }
  }

  // 如果没有尖括号或括号内不是有效邮箱，则尝试整个字符串
  if (isValidEmail(trimmedEmail)) {
    return trimmedEmail;
  }

  // 最后，在字符串中查找任何类似邮箱的模式
  const emailPattern = /\b[^\s<>]+@[^\s<>]+\.[^\s<>]+\b/g;
  const matches = trimmedEmail.match(emailPattern);
  if (matches) {
    // 逐个尝试每个匹配项，找出有效的邮箱
    for (const match of matches) {
      if (isValidEmail(match)) {
        return match;
      }
    }
  }

  return "";
}

export function canonicalizeEmailAddress(email: string): string {
  return extractEmailAddress(email).toLowerCase();
}

export function isSameEmailAddress(left: string, right: string) {
  return canonicalizeEmailAddress(left) === canonicalizeEmailAddress(right);
}

// "me, Dana, Alex": who a message goes to, short enough to scan in a header.
export function formatRecipientNames(recipients: string[], userEmail: string) {
  const seen = new Set<string>();
  let includesMe = false;
  const names: string[] = [];
  for (const recipient of recipients) {
    const key =
      canonicalizeEmailAddress(recipient) || recipient.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (userEmail && isSameEmailAddress(recipient, userEmail)) {
      includesMe = true;
    } else {
      names.push(recipientFirstName(recipient));
    }
  }
  // "me" leads however the account was addressed, so it's easy to spot.
  return (includesMe ? ["me", ...names] : names).join(", ");
}

export function messageRepliesToSourceSender({
  sentMessage,
  sourceMessage,
}: {
  sentMessage: Pick<ParsedMessage, "headers">;
  sourceMessage: Pick<ParsedMessage, "headers">;
}) {
  const replyTargetEmails = extractEmailAddresses(
    sourceMessage.headers["reply-to"] || sourceMessage.headers.from,
  ).map((email) => email.toLowerCase());
  if (!replyTargetEmails.length) return null;

  const recipientEmails = [
    ...extractEmailAddresses(sentMessage.headers.to),
    ...extractEmailAddresses(sentMessage.headers.cc ?? ""),
    ...extractEmailAddresses(sentMessage.headers.bcc ?? ""),
  ].map((email) => email.toLowerCase());

  if (!recipientEmails.length) return null;

  const recipientEmailSet = new Set(recipientEmails);
  return replyTargetEmails.some((email) => recipientEmailSet.has(email));
}

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}

// 规范化邮箱地址：
// - 转换为小写
// - 移除本地部分中的所有点
// - 移除本地部分中的所有空白
// - 保持域名部分不变
// 例如："John.Doe.Smith@gmail.com" -> "johndoesmith@gmail.com"
export function normalizeEmailAddress(email: string) {
  const [localPart, domain] = email.toLowerCase().split("@");
  if (!domain) return email.toLowerCase();
  // 移除本地部分中的所有点和空白
  const normalizedLocal = localPart.trim().replace(/[\s.]+/g, "");
  return `${normalizedLocal}@${domain}`;
}

export function extractUniqueEmailAddresses(
  emails: string[],
  options?: { lowercase?: boolean },
) {
  const lowercase = options?.lowercase ?? false;

  return [
    ...new Set(
      emails
        .map((email) => extractEmailAddress(email))
        .filter(Boolean)
        .map((email) => (lowercase ? email.toLowerCase() : email)),
    ),
  ];
}

// 将 "Name <hey@domain.com>" 转换为 "domain.com"
export function extractDomainFromEmail(email: string): string {
  if (!email) return "";

  // 从 "Name <email@domain.com>" 这类格式化字符串中提取干净的邮箱地址
  const emailAddress = email.includes("<") ? extractEmailAddress(email) : email;

  // 校验邮箱中恰好有一个 @ 符号
  if ((emailAddress.match(/@/g) || []).length !== 1) return "";

  // 使用支持以下情况的正则提取域名：
  // - 国际字符（通过 \p{L}）
  // - 多个子域名（例如 sub1.sub2.domain.com）
  // - 常见的域名字符（字母、数字、点、连字符）
  // - 2 个或更多字符的顶级域名
  const domain = emailAddress.match(
    /@([\p{L}a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/u,
  )?.[1];
  return domain || "";
}

// 返回会话的另一方
// 如果我们是发件人，则返回收件人
// 如果我们是收件人，则返回发件人
export function participant(
  message: { headers: Pick<ParsedMessage["headers"], "from" | "to"> },
  userEmail: string,
) {
  if (!userEmail) return message.headers.from;
  if (message.headers.from.includes(userEmail)) return message.headers.to;
  return message.headers.from;
}

// 将姓名和邮箱转换为 "Name <email@example.com>"，如果没有姓名则仅为 "email@example.com"
// 这是 extractNameFromEmail/extractEmailAddress 的逆操作
export function formatEmailWithName(
  name: string | null | undefined,
  address: string | null | undefined,
): string {
  if (!address) return "";
  if (!name || name === address) return address;
  return `${name} <${address}>`;
}

export function getNewsletterSenderDisplayName({
  email,
  fromName,
  minFromName,
  maxFromName,
}: {
  email: string;
  fromName?: string | null;
  minFromName?: string | null;
  maxFromName?: string | null;
}) {
  const hasMultipleDisplayNames =
    !!minFromName && !!maxFromName && minFromName !== maxFromName;
  const domain = extractDomainFromEmail(email);

  if (hasMultipleDisplayNames && domain) return domain;

  return fromName?.trim() || "";
}

/** 最多两个字母：取自显示名称的首字母，或地址的前几个字母。 */
export function getInitials(name: string) {
  // 按码点展开，避免 emoji 或星平面字母被拆成两半。
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word]);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).join("").toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

// 公共邮箱服务商，对此我们按完整邮箱地址搜索
// 对于公司域名，我们按域名搜索，以捕获同一公司不同人的邮件
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.ca",
  "yahoo.com.au",
  "yahoo.co.in",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.co.jp",
  "yahoo.com.br",
  "yahoo.com.mx",
  "yahoo.co.nz",
  "yahoo.com.sg",
  "yahoo.com.hk",
  "yahoo.com.tw",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.es",
  "hotmail.it",
  "hotmail.ca",
  "hotmail.com.au",
  "outlook.com",
  "outlook.fr",
  "outlook.de",
  "outlook.es",
  "outlook.it",
  "live.com",
  "live.co.uk",
  "live.fr",
  "live.de",
  "live.it",
  "live.ca",
  "live.com.au",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "ya.ru",
  "fastmail.com",
  "fastmail.fm",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "hey.com",
  "mail.com",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// 返回检查以往通信时应使用的搜索词
// 对于公共邮箱服务商（gmail、yahoo 等），返回完整邮箱地址
// 对于公司域名，仅返回域名，以捕获同一公司不同人的邮件
export function getSearchTermForSender(email: string): string {
  const domain = extractDomainFromEmail(email);
  if (!domain) return email;

  return isPublicEmailDomain(domain)
    ? extractEmailAddress(email) || email
    : domain;
}

// 共用公共邮箱服务商并不能说明存在隶属关系，因此这类情况按地址比较。
export function isSameOrganization(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (isSameEmailAddress(left, right)) return true;

  const leftDomain = extractDomainFromEmail(left).toLowerCase();
  if (!leftDomain || isPublicEmailDomain(leftDomain)) return false;

  return leftDomain === extractDomainFromEmail(right).toLowerCase();
}

// 含逗号的显示名称会带引号（'"Doe, John"'），这是头部
// 语法，而不是名称的一部分。
function unquoteDisplayName(name: string) {
  const quoted = name.match(/^"(.*)"$/);
  if (!quoted) return name;
  return quoted[1].replace(/\\(.)/g, "$1").trim();
}

function recipientFirstName(recipient: string) {
  const email = extractEmailAddress(recipient);
  const name = extractNameFromEmail(recipient);
  if (!name || name.includes("@")) return email || name;
  // 通讯录风格的 "Last, First" 名称把名字放在逗号之后。
  const givenName = name.includes(",")
    ? name.slice(name.indexOf(",") + 1).trim()
    : name;
  return givenName.split(/\s+/)[0] || name;
}
