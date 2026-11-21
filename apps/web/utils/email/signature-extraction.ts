import * as cheerio from "cheerio";

/**
 * 从 Outlook 邮件的 HTML 内容中提取邮件签名
 * 用于从已发送邮件中提取签名，因为 Outlook API 不支持获取签名
 * @param htmlContent The HTML content of the email
 * @returns The extracted signature or null if no signature is found
 */
export function extractSignatureFromHtml(htmlContent: string): string | null {
  if (!htmlContent) return null;

  try {
    const $ = cheerio.load(htmlContent);
    const signatureElement = $('[id^="Signature"]');

    if (signatureElement.length > 0) {
      return (
        signatureElement
          .html()
          ?.replace(/&amp;/g, "&")
          .replace(/>\s+/g, ">")
          .replace(/\s+</g, "<")
          .replace(/\s+/g, " ")
          .trim() ?? null
      );
    }
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: helpful for debugging
    console.error("解析签名 HTML 出错：", error);
  }

  return null;
}
