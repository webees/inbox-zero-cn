import "server-only";
import EmailReplyParser from "email-reply-parser";
import { convert, type FormatCallback } from "html-to-text";
import type { ParsedMessage } from "@/utils/types";
import {
  stripPlainTextSignature,
  stripProviderSignatureHtml,
} from "@/utils/email/signature-normalization";
import {
  removeExcessiveWhitespace,
  truncate,
  truncateHeadTail,
} from "@/utils/string";
import { env } from "@/env";
import { SafeError } from "@/utils/error";

export function parseReply(plainText: string) {
  const parser = new EmailReplyParser().read(plainText);
  const result = parser.getVisibleText();
  return result;
}

export function hasQuotedReplyContent(plainText: string): boolean {
  return new EmailReplyParser().read(plainText).getQuotedText().length > 0;
}

const IMAGE_ALT_MAX_LENGTH = 160;
const IMAGE_PLACEHOLDER = "[image]";
const GENERIC_IMAGE_ALT_TEXT_PATTERN =
  /^(?:avatar|decorative|graphic|icon|image|img|logo|photo|picture|pixel|spacer|tracking pixel)$/i;

// 在处理 HTML 邮件之前执行很重要
// 在某些情况下，这会将一封邮件从 100,000 个字符缩减到 1,000 个字符
function htmlToText(
  html: string,
  {
    includeLinkUrls = false,
    includeImageAltText = false,
  }: Pick<
    EmailToContentOptions,
    "includeLinkUrls" | "includeImageAltText"
  > = {},
) {
  const text = convert(html, {
    wordwrap: 130,
    formatters: { imageAltText: formatImageAltText },
    selectors: [
      {
        selector: "a",
        options: includeLinkUrls
          ? { hideLinkHrefIfSameAsText: true }
          : { ignoreHref: true },
      },
      {
        selector: "img",
        format: includeImageAltText ? "imageAltText" : "skip",
      },
    ],
  });

  return text;
}

const formatImageAltText: FormatCallback = (elem, _walk, builder) => {
  builder.addInline(getImageText(elem.attribs?.alt), {
    noWordTransform: true,
  });
};

function getImageText(value: unknown) {
  if (typeof value !== "string") return IMAGE_PLACEHOLDER;

  const altText = removeExcessiveWhitespace(value).trim();
  if (!altText) return IMAGE_PLACEHOLDER;
  if (GENERIC_IMAGE_ALT_TEXT_PATTERN.test(altText)) return IMAGE_PLACEHOLDER;

  return `[image: ${truncate(altText, IMAGE_ALT_MAX_LENGTH)}]`;
}

export function getEmailClient(messageId: string) {
  const host = getMessageIdHost(messageId);
  if (host === "mail.gmail.com") return "gmail";
  if (host === "we.are.superhuman.com") return "superhuman";
  if (host === "mail.shortwave.com") return "shortwave";
  if (host) return host;

  return "unknown";
}

function getMessageIdHost(messageId: string) {
  const rawHost = messageId.split("@")[1]?.split(">")[0];
  if (!rawHost) return;

  try {
    return new URL(`https://${rawHost}`).hostname.toLowerCase();
  } catch {
    return rawHost.toLowerCase();
  }
}

const FORWARDED_CONTENT_PATTERNS = [
  // Gmail 风格
  /(?:\r?\n|\r)?(?:-{3,}|_{3,})\s*Forwarded message\s*(?:-{3,}|_{3,})/i,
  // 简单的转发标记
  /(?:\r?\n|\r)?(?:-{3,}|_{3,})\s*Forward(?:ed)?(?:\s*message)?(?:-{3,}|_{3,})/i,
  // 转发的邮件头部块
  /(?:^|\r?\n)From:\s*[^\r\n]+(?:\r?\n(?:Date|Sent|To|Cc|Bcc|Subject):\s*[^\r\n]+){2,}/im,
  // iOS/Mac 风格
  /(?:\r?\n|\r)?Begin forwarded message:/im,
  // Outlook 风格
  /(?:\r?\n|\r)?Original Message/i,
];

export function stripForwardedContent(text: string): string {
  for (const pattern of FORWARDED_CONTENT_PATTERNS) {
    const parts = text.split(pattern);
    if (parts.length > 1) {
      // 取转发标记之前的内容并清理
      return removeExcessiveWhitespace(parts[0]);
    }
  }

  return text;
}

export type EmailToContentOptions = {
  maxLength?: number;
  keepTailLength?: number;
  extractReply?: boolean;
  removeForwarded?: boolean;
  stripSignature?: boolean;
  includeLinkUrls?: boolean;
  includeImageAltText?: boolean;
};

export function emailToContent(
  email: Pick<ParsedMessage, "textHtml" | "textPlain" | "snippet">,
  {
    maxLength = 2000,
    keepTailLength,
    extractReply = false,
    removeForwarded = false,
    stripSignature = false,
    includeLinkUrls = false,
    includeImageAltText = false,
  }: EmailToContentOptions = {},
): string {
  let content = "";

  if (email.textHtml) {
    const html = stripSignature
      ? stripProviderSignatureHtml(email.textHtml)
      : email.textHtml;
    content = htmlToText(html, {
      includeLinkUrls,
      includeImageAltText,
    });
  } else if (email.textPlain) {
    content = email.textPlain;
  } else if (email.snippet) {
    content = email.snippet;
  }

  if (extractReply) {
    content = parseReply(content);
  }

  if (removeForwarded) {
    content = stripForwardedContent(content);
  }

  if (stripSignature) {
    content = stripPlainTextSignature(content);
  }

  content = removeExcessiveWhitespace(content);

  if (!maxLength) return content;
  if (keepTailLength) {
    return truncateHeadTail(content, maxLength, keepTailLength);
  }
  return truncate(content, maxLength);
}

export function convertEmailHtmlToText({
  htmlText,
  includeLinks = true,
}: {
  htmlText: string;
  includeLinks?: boolean;
}): string {
  const plainText = convert(htmlText, {
    wordwrap: 130,
    selectors: [
      {
        selector: "a",
        options: includeLinks
          ? { hideLinkHrefIfSameAsText: true } // 保留链接 URL："Text [URL]"
          : { ignoreHref: true }, // 完全移除链接："Text"
      },
      { selector: "img", format: "skip" },
    ],
  });

  return plainText;
}

/**
 * 确保邮件发送已启用。如果已禁用则抛出错误。
 * @throws {SafeError} 如果邮件发送已禁用
 */
export function ensureEmailSendingEnabled(): void {
  if (!env.NEXT_PUBLIC_EMAIL_SEND_ENABLED) {
    throw new SafeError(
      "邮件发送已禁用。设置 NEXT_PUBLIC_EMAIL_SEND_ENABLED=true 以启用。",
    );
  }
}
