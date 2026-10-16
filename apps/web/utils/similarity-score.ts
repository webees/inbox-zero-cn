import { stripBrandingSignatures } from "@/utils/referral/signature";
import he from "he";
import * as stringSimilarity from "string-similarity";
import {
  convertEmailHtmlToText,
  parseReply,
  stripForwardedContent,
} from "@/utils/mail";
import { stripQuotedContent } from "@/utils/ai/choose-rule/draft-management";
import { stripQuotedHtmlContent } from "@/utils/email/parse-message-reply";
import {
  stripPlainTextSignature,
  stripProviderSignatureHtml,
} from "@/utils/email/signature-normalization";
import type { ParsedMessage } from "@/utils/types";

const HTML_TAG_NAMES = [
  "html",
  "head",
  "body",
  "div",
  "p",
  "br",
  "a",
  "span",
  "table",
  "tr",
  "td",
  "blockquote",
  "meta",
];

const HTML_TAG_PATTERN = new RegExp(
  `<\\/?(?:${HTML_TAG_NAMES.join("|")})(?:\\s|\\/|>)`,
  "i",
);

/**
 * 规范化内容以便进行 Outlook（HTML）比较。
 * 将 \n 转换为 <br> 再转换为纯文本，并剥离引用内容。
 */
function normalizeForOutlook(content: string, stripSignature = false): string {
  const signatureStripped = stripSignature
    ? stripProviderSignatureHtml(content)
    : content;
  const withBr = signatureStripped.replace(/\n/g, "<br>");
  const plainText = convertEmailHtmlToText({
    htmlText: stripQuotedHtmlContent(withBr),
    includeLinks: false,
  });
  const withoutQuotedContent = stripQuotedContent(plainText);
  const withoutForwardedContent = stripForwardedContent(withoutQuotedContent);
  const withoutSignature = stripSignature
    ? stripPlainTextSignature(withoutForwardedContent)
    : withoutForwardedContent;
  return stripBrandingSignatures(withoutSignature).toLowerCase().trim();
}

/**
 * 解码 HTML 实体（例如 &#x1F44B; -> 👋），且不修改其他内容。
 * 无效的码点（> 0x10FFFF）保持不变，以避免 RangeError。
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isFinite(codePoint) || codePoint > 0x10_ff_ff) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const codePoint = Number.parseInt(dec, 10);
      if (!Number.isFinite(codePoint) || codePoint > 0x10_ff_ff) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&[a-zA-Z][a-zA-Z0-9]+;/g, (match) => he.decode(match));
}

/**
 * 规范化内容以便进行 Gmail（纯文本）比较。
 * 使用 parseReply 提取回复、解码 HTML 实体，并剥离引用内容。
 */
function normalizePlainText(content: string, stripSignature = false): string {
  const signatureStripped = stripSignature
    ? stripProviderSignatureHtml(content)
    : content;
  const plainText = looksLikeHtmlContent(signatureStripped)
    ? convertEmailHtmlToText({
        htmlText: stripQuotedHtmlContent(
          signatureStripped.replace(/\n/g, "<br>"),
        ),
        includeLinks: false,
      })
    : signatureStripped;
  const reply = parseReply(plainText);
  const decoded = decodeHtmlEntities(reply);
  const withoutQuotedContent = stripQuotedContent(decoded);
  const withoutForwardedContent = stripForwardedContent(withoutQuotedContent);
  const withoutSignature = stripSignature
    ? stripPlainTextSignature(withoutForwardedContent)
    : withoutForwardedContent;
  return stripBrandingSignatures(withoutSignature).toLowerCase().trim();
}

/**
 * 计算已存储的草稿内容与服务商邮件之间的相似度。
 * 处理 Outlook HTML 内容并正确剥离引用内容。
 *
 * @param storedContent The original stored draft content (from executedAction.content)
 * @param providerMessage The message from the email provider (ParsedMessage or plain text)
 * @returns A similarity score between 0.0 and 1.0.
 */
export function calculateSimilarity(
  storedContent?: string | null,
  providerMessage?: string | ParsedMessage | null,
  options: { excludedSignatures?: string[] } = {},
): number {
  return calculateSimilarityDetails(storedContent, providerMessage, options)
    .score;
}

export function calculateSimilarityDetails(
  storedContent?: string | null,
  providerMessage?: string | ParsedMessage | null,
  options: { excludedSignatures?: string[] } = {},
): {
  score: number;
  normalizedStoredContentLength: number;
  normalizedProviderMessageLength: number;
} {
  if (!storedContent || !providerMessage) {
    return {
      score: 0.0,
      normalizedStoredContentLength: 0,
      normalizedProviderMessageLength: 0,
    };
  }

  const baselinePair = normalizePair({
    storedContent,
    providerMessage,
    stripSignature: false,
    excludedSignatures: options.excludedSignatures,
  });
  const baselineScore = compareNormalizedStrings(...baselinePair);

  const signatureStrippedPair = normalizePair({
    storedContent,
    providerMessage,
    stripSignature: true,
    excludedSignatures: options.excludedSignatures,
  });
  const signatureStrippedScore = compareNormalizedStrings(
    ...signatureStrippedPair,
  );
  const useSignatureStrippedPair = signatureStrippedScore >= baselineScore;
  const [normalizedStoredContent, normalizedProviderMessage] =
    useSignatureStrippedPair ? signatureStrippedPair : baselinePair;

  return {
    score: Math.max(baselineScore, signatureStrippedScore),
    normalizedStoredContentLength: normalizedStoredContent.length,
    normalizedProviderMessageLength: normalizedProviderMessage.length,
  };
}

function normalizePair({
  storedContent,
  providerMessage,
  stripSignature,
  excludedSignatures,
}: {
  storedContent: string;
  providerMessage: string | ParsedMessage;
  stripSignature: boolean;
  excludedSignatures?: string[];
}): [string, string] {
  let normalizedStoredContent: string;
  let normalizedProviderMessage: string;
  let normalizeContent: (content: string, stripSignature: boolean) => string;

  if (typeof providerMessage === "string") {
    // 旧版：在 ParsedMessage 贯穿调用方之前使用的纯字符串
    normalizeContent = normalizePlainText;
    normalizedStoredContent = normalizeContent(storedContent, stripSignature);
    normalizedProviderMessage = normalizeContent(
      providerMessage,
      stripSignature,
    );
  } else {
    const isOutlook = providerMessage.bodyContentType === "html";
    const text = providerMessage.textHtml || providerMessage.textPlain || "";
    normalizeContent = isOutlook ? normalizeForOutlook : normalizePlainText;

    normalizedStoredContent = normalizeContent(storedContent, stripSignature);
    normalizedProviderMessage = normalizeContent(text, stripSignature);
  }

  // 以 stripSignature=false 规范化被排除的签名，这样在我们使用
  // 用户保存的签名将其从正文中移除之前，签名剥离器不会把它清空。
  const normalizedExcludedSignatures = excludedSignatures
    ?.map((signature) => normalizeContent(signature, false))
    .filter(Boolean);

  if (!normalizedExcludedSignatures?.length) {
    return [normalizedStoredContent, normalizedProviderMessage];
  }

  return [
    removeExcludedSignatures(
      normalizedStoredContent,
      normalizedExcludedSignatures,
    ),
    removeExcludedSignatures(
      normalizedProviderMessage,
      normalizedExcludedSignatures,
    ),
  ];
}

function compareNormalizedStrings(normalized1: string, normalized2: string) {
  if (!normalized1 || !normalized2) {
    return normalized1 === normalized2 ? 1.0 : 0.0;
  }

  return stringSimilarity.compareTwoStrings(normalized1, normalized2);
}

function removeExcludedSignatures(
  content: string,
  excludedSignatures: string[],
): string {
  let result = content;

  for (const signature of excludedSignatures) {
    result = result.replaceAll(signature, "");
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeHtmlContent(content: string): boolean {
  if (/<!doctype html/i.test(content)) return true;
  return HTML_TAG_PATTERN.test(content);
}
