import * as cheerio from "cheerio";
import {
  containsUnsubscribeKeyword,
  containsUnsubscribeUrlPattern,
} from "@/utils/parse/unsubscribe";

export function findUnsubscribeLink(html?: string | null) {
  if (!html) return;

  const $ = cheerio.load(html);
  let unsubscribeLink: string | undefined;

  $("a").each((_index, element) => {
    const text = $(element).text().toLowerCase();
    if (containsUnsubscribeKeyword(text)) {
      unsubscribeLink = $(element).attr("href");
      // console.debug(
      //   `找到文本为 '${text}' 且链接为 ${unsubscribeLink} 的链接`,
      // );
      return false; // 跳出循环
    }

    const href = $(element).attr("href") || "";
    if (containsUnsubscribeUrlPattern(href)) {
      unsubscribeLink = href;
      // console.debug(
      //   `找到 href 为 '${href}' 且链接为 ${unsubscribeLink} 的链接`,
      // );
      return false; // 跳出循环
    }
  });

  if (unsubscribeLink) return unsubscribeLink;

  // 如果还没有找到链接，尝试查找包含单词 unsubscribe 的行
  // 且同一行中有链接。

  // nodeType 为 3 表示文本节点，即元素或属性内部的真实文本。
  const textNodes = $("*")
    .contents()
    .filter(
      (_index, content) =>
        content.nodeType === 3 && content.data.includes("unsubscribe"),
    );

  textNodes.each((_index, textNode) => {
    // 查找最近一个包含 'a' 标签的父节点
    const parent = $(textNode).parent();
    const link = parent.find("a").attr("href");
    if (link) {
      // console.debug(`找到包含 'unsubscribe' 的文本和链接：${link}`);
      unsubscribeLink = link;
      return false; // 跳出循环
    }
  });

  return unsubscribeLink;
}
