import type { ParsedMessage } from "@/utils/types";
import {
  buildQuotedPlainText,
  quotePlainTextContent,
} from "@/utils/email/quoted-plain-text";
import { convertNewlinesToBr, escapeHtml } from "@/utils/string";

export function buildReplyQuote({
  textContent,
  message,
}: {
  textContent?: string;
  message: Pick<ParsedMessage, "headers" | "textPlain" | "textHtml">;
}) {
  const quotedHeader = formatReplyQuotedHeader(message.headers);

  return {
    dirAttribute: `dir="${detectTextDirection(textContent || "")}"`,
    quotedHeaderHtml: escapeHtml(quotedHeader),
    quotedContentHtml:
      message.textHtml ||
      (message.textPlain
        ? convertNewlinesToBr(escapeHtml(message.textPlain))
        : ""),
    text: buildQuotedPlainText({
      textContent,
      quotedHeader,
      quotedContent: quotePlainTextContent(message.textPlain),
    }),
  };
}

export function formatReplyQuotedHeader(
  headers: Pick<ParsedMessage["headers"], "date" | "from">,
) {
  return `在 ${formatEmailDate(new Date(headers.date))}，${headers.from} 写道：`;
}

export function formatEmailDate(date: Date): string {
  const weekday = date.toLocaleString("en-US", { weekday: "short" });
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  const hour = date.getHours();
  const minute = date.getMinutes();

  // 格式："Thu, 6 Feb 2025 23:23"
  return `${weekday}, ${day} ${month} ${year} ${hour}:${minute.toString().padStart(2, "0")}`;
}

function detectTextDirection(text: string): "ltr" | "rtl" {
  // 基本的 RTL 检测——检查文本开头是否有 RTL 字符
  const rtlRegex =
    /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  return rtlRegex.test(text.trim().charAt(0)) ? "rtl" : "ltr";
}
