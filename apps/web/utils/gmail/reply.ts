import type { ParsedMessage } from "@/utils/types";
import { buildReplyQuote } from "@/utils/email/reply-quote";
import { convertNewlinesToBr } from "@/utils/string";

export const createReplyContent = ({
  textContent,
  htmlContent,
  message,
}: {
  textContent?: string;
  htmlContent?: string;
  message: Pick<ParsedMessage, "headers" | "textPlain" | "textHtml">;
}): {
  html: string;
  text: string;
} => {
  const { dirAttribute, quotedHeaderHtml, quotedContentHtml, text } =
    buildReplyQuote({ textContent, message });
  const contentHtml =
    htmlContent || (textContent ? convertNewlinesToBr(textContent) : "");

  const quoteHtml = `<div class="gmail_quote gmail_quote_container">
  <div ${dirAttribute} class="gmail_attr">${quotedHeaderHtml}<br></div>
  <blockquote class="gmail_quote" 
    style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">
    ${quotedContentHtml}
  </blockquote>
</div>`;
  // 没有内容时，这是编辑器的引用块，位于用户回复的下方，
  // 因此它自身不携带空的回复块。
  const html = contentHtml
    ? `<div ${dirAttribute}>${contentHtml}</div>\n<br>\n${quoteHtml}`
    : quoteHtml;

  return { text, html };
};
