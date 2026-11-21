import { env } from "@/env";
import {
  extractEmailAddress,
  extractEmailAddresses,
  extractNameFromEmail,
  formatEmailWithName,
} from "@/utils/email";

// In prod: hello+ai@example.com
// In dev: hello+ai-test@example.com
const FILEBOT_SUFFIX = `ai${env.NODE_ENV === "development" ? "-test" : ""}`;
const FILEBOT_DISPLAY_NAME = "Inbox Zero Assistant";
// 由 utils/drive/filing-notifications.ts 生成的主题。作为回退匹配，
// 因为某些服务商会在回复时丢弃 Reply-To 和 From 显示名。保留英文变体以识别汉化前发送的旧通知。
const FILEBOT_NOTIFICATION_SUBJECT =
  /^(?:re:\s*)*(?:✓ Filed |✓ 已归档 |📄 Where should I file |📄 应该把 |📄 Filing update for |📄 归档更新：)/i;

/**
 * 检查邮件中是否有任一收件人是 filebot 回复地址。
 * Pattern: user+ai@domain.com (or user+ai-test@domain.com in dev)
 * 处理 To 字段中的多个收件人（以逗号分隔）。
 */
export function isFilebotEmail({
  userEmail,
  emailToCheck,
}: {
  userEmail: string;
  emailToCheck: string;
}): boolean {
  if (!emailToCheck) return false;

  const [localPart, domain] = userEmail.split("@");
  if (!localPart || !domain) return false;

  const pattern = buildFilebotPattern(localPart, domain);

  // 按逗号拆分，以处理 To 字段中的多个收件人
  const recipients = emailToCheck.split(",");

  for (const recipient of recipients) {
    const extractedEmail = extractEmailAddress(recipient.trim());
    if (extractedEmail && pattern.test(extractedEmail)) {
      return true;
    }
  }

  return false;
}

/**
 * 生成 filebot 的 reply-to 邮箱地址。
 * Returns: user+filebot@domain.com
 */
export function getFilebotEmail({ userEmail }: { userEmail: string }): string {
  const [localPart, domain] = userEmail.split("@");
  if (!localPart || !domain) {
    throw new Error("无效的邮箱格式");
  }
  return `${localPart}+${FILEBOT_SUFFIX}@${domain}`;
}

export function getFilebotReplyTo({
  userEmail,
}: {
  userEmail: string;
}): string {
  return formatEmailWithName(
    FILEBOT_DISPLAY_NAME,
    getFilebotEmail({ userEmail }),
  );
}

export function getFilebotFrom({ userEmail }: { userEmail: string }): string {
  return formatEmailWithName(FILEBOT_DISPLAY_NAME, userEmail);
}

/**
 * 检查某封外发邮件是否为 filebot 通知邮件。
 * 这些是助手内部生成的消息，不应被视为
 * 用于会话状态跟踪的用户外发回复。
 */
export function isFilebotNotificationMessage({
  userEmail,
  from,
  to,
  replyTo,
}: {
  userEmail: string;
  from: string;
  to: string;
  replyTo?: string;
}): boolean {
  if (
    replyTo &&
    isFilebotEmail({
      userEmail,
      emailToCheck: replyTo,
    })
  ) {
    return true;
  }

  const normalizedUserEmail = userEmail.toLowerCase();
  const fromEmail = extractEmailAddress(from)?.toLowerCase();
  if (fromEmail !== normalizedUserEmail) return false;

  const toEmails = extractEmailAddresses(to).map((email) =>
    email.toLowerCase(),
  );
  if (!toEmails.includes(normalizedUserEmail)) return false;

  const fromName = extractNameFromEmail(from).trim().toLowerCase();
  return fromName === FILEBOT_DISPLAY_NAME.toLowerCase();
}

/**
 * 检查某条会话消息是否属于用户与归档
 * 助手的往来：应用发送到该会话的通知，或用户对
 * 通知的回复。二者都不是真实对话中的一轮。
 */
export function isFilebotConversationMessage({
  userEmail,
  message,
}: {
  userEmail: string;
  message: {
    headers: {
      from: string;
      to: string;
      subject?: string;
      "reply-to"?: string;
    };
  };
}): boolean {
  const { from, to, subject } = message.headers;

  if (
    isFilebotNotificationMessage({
      userEmail,
      from,
      to,
      replyTo: message.headers["reply-to"],
    })
  ) {
    return true;
  }

  const normalizedUserEmail = userEmail.toLowerCase();
  if (extractEmailAddress(from)?.toLowerCase() !== normalizedUserEmail) {
    return false;
  }

  if (isFilebotEmail({ userEmail, emailToCheck: to })) return true;

  const isSelfAddressed = extractEmailAddresses(to).some(
    (email) => email.toLowerCase() === normalizedUserEmail,
  );

  return (
    isSelfAddressed && FILEBOT_NOTIFICATION_SUBJECT.test(subject?.trim() ?? "")
  );
}

/**
 * 为 filebot 邮件构建正则模式。
 * 用户的本地部分和域名不区分大小写，因为不同服务商会
 * 以不同大小写投递到同一邮箱。出于安全考虑，filebot 后缀区分大小写。
 */
function buildFilebotPattern(localPart: string, domain: string): RegExp {
  return new RegExp(
    `^${caseInsensitivePattern(localPart)}\\+${FILEBOT_SUFFIX}@${caseInsensitivePattern(domain)}$`,
  );
}

// 为每个字母匹配任一种大小写，同时不使整个模式不区分大小写
function caseInsensitivePattern(str: string): string {
  return str
    .split("")
    .map((char) => {
      if (/[a-zA-Z]/.test(char)) {
        return `[${char.toLowerCase()}${char.toUpperCase()}]`;
      }
      return escapeRegex(char);
    })
    .join("");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
