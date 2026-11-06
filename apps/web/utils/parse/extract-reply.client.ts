import { splitQuotedHtml } from "@inboxzero/email-editor/core";
import { textToHtmlParagraphs } from "@/utils/string";

/**
 * 将邮箱草稿拆分为用户撰写的回复和其下方的引用。
 * 引用之前的所有内容都保留在回复中，因此重新打开草稿永远不会
 * 丢失已写的内容。
 */
export function extractDraftComposerContent(
  html: string | undefined,
  textPlain?: string,
) {
  const { editableHtml, quotedHtml } = splitQuotedHtml(html ?? "");
  const split = { draftHtml: editableHtml, originalHtml: quotedHtml };
  if (htmlHasContent(split.draftHtml)) return split;
  const fromPlain = textToHtmlParagraphs(textPlain);
  if (!fromPlain) return split;
  return { draftHtml: fromPlain, originalHtml: split.originalHtml };
}

function htmlHasContent(html: string) {
  if (!html.trim()) return false;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.body.querySelector("img, hr, picture, svg, video")) return true;
  return (doc.body.textContent ?? "").replace(/ /g, " ").trim().length > 0;
}
