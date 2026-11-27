import { BRAND_NAME } from "@/utils/branding";
import { escapeHtml } from "@/utils/string";

export function renderSentWithFooterHtml(link: string) {
  return `<div>使用 <a href="${escapeHtml(link)}">${escapeHtml(BRAND_NAME)}</a> 发送</div>`;
}
