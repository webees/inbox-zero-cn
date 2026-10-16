import he from "he";

export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return he.escape(text);
}

// 空行分隔段落，单个换行变成换行符。之所以转义，是因为这些文本
// 通常由模型或用户撰写，并最终出现在发送的 HTML 中。
export function textToHtmlParagraphs(text?: string | null): string {
  if (!text) return "";

  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

export function truncate(str: string, length: number) {
  return str.length > length ? `${sliceHead(str, length)}...` : str;
}

const HEAD_TAIL_ELLIPSIS = "\n...\n";

// 保留长字符串的开头和结尾，以便结尾的请求/CTA 在截断后仍然保留。
export function truncateHeadTail(
  str: string,
  maxLength: number,
  tailLength: number,
) {
  if (str.length <= maxLength) return str;

  const ellipsis = HEAD_TAIL_ELLIPSIS;
  if (maxLength <= ellipsis.length) return sliceHead(str, maxLength);

  const clampedTailLength = Math.max(
    0,
    Math.min(tailLength, maxLength - ellipsis.length),
  );
  const headLength = maxLength - clampedTailLength - ellipsis.length;
  if (headLength <= 0) {
    return `${ellipsis}${sliceTail(str, maxLength - ellipsis.length)}`;
  }

  return `${sliceHead(str, headLength)}${ellipsis}${sliceTail(str, clampedTailLength)}`;
}

export function trimToNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return;

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function removeExcessiveWhitespace(str: string) {
  return (
    str
      // 首先移除所有零宽空格、软连字符和其他不可见字符
      // 分别处理每个特殊字符，以避免组合字符问题
      .replace(
        /\u200B|\u200C|\u200D|\u200E|\u200F|\uFEFF|\u3164|\u00AD|\u034F/g,
        " ",
      )
      // 将所有类型的换行统一规范化为 \n
      .replace(/\r\n|\r/g, "\n")
      // 然后将多个换行（3 个或更多）合并为两个换行
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      // 清理换行周围的空格（但保留双换行）
      .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
      // 将多个空格（但非换行）替换为单个空格
      .replace(/[^\S\n]+/g, " ")
      // 清理任何首尾空白
      .trim()
  );
}

export function generalizeSubject(subject = "") {
  return (
    subject
      // 移除括号中的内容
      .replace(/\([^)]*\)/g, "")
      // 移除数字和 ID
      .replace(/(?:#\d+|\b\d+\b)/g, "")
      // 清理多余空白
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return count === 1 ? singular : plural;
}

export function formatBulletList(list: string[]) {
  return list.map((item) => `- ${item}`).join("\n");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function convertNewlinesToBr(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

// slice() 按 UTF-16 代码单元计数，因此截断可能落在 emoji 或其他
// 星平面字符中间，留下孤立代理项。某些 LLM API 会将以无效 JSON 形式
// 包含孤立代理项的请求体拒掉，因此改为丢弃这半个字符。
function sliceHead(str: string, length: number) {
  const head = str.slice(0, length);
  return isHighSurrogate(head.charCodeAt(head.length - 1))
    ? head.slice(0, -1)
    : head;
}

function sliceTail(str: string, length: number) {
  const tail = str.slice(-length);
  return isLowSurrogate(tail.charCodeAt(0)) ? tail.slice(1) : tail;
}

function isHighSurrogate(code: number) {
  return code >= 0xd8_00 && code <= 0xdb_ff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc_00 && code <= 0xdf_ff;
}
