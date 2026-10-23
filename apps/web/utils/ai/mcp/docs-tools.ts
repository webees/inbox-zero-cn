import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { searchDocsIndex } from "@/utils/docs-sources/docs-index";
import {
  DocsFetchError,
  getDocsIndex,
  readDocsPage,
} from "@/utils/docs-sources/fetch-docs";
import type { Logger } from "@/utils/logger";

export function createDocsTools(sources: string[], logger: Logger): ToolSet {
  if (!sources.length) return {};

  const sites = sources.join(", ");

  return {
    search_docs: tool({
      description: `在用户的公开文档（${sites}）中搜索与某个主题相关的页面。匹配页面标题、路径和描述中的确切词语，文档的措辞可能与邮件不同，因此请传入多个替代表述。返回页面标题和 URL；在依赖页面内容之前，先用 read_docs_page 阅读该页面。`,
      inputSchema: z.object({
        queries: z
          .array(z.string())
          .describe(
            "1 到 5 个简短的关键词查询，例如功能名称、同义词以及文档可能使用的术语。",
          ),
      }),
      execute: async ({ queries }) => {
        try {
          const entries = searchDocsIndex(
            await getDocsIndex(sources),
            queries.slice(0, 5),
          );
          if (!entries.length) {
            return "文档索引中未找到匹配页面。请尝试其他表述，或直接使用 read_docs_page 读取文档 URL。";
          }
          return entries
            .map(
              (entry) =>
                `- ${entry.title}: ${entry.url}${entry.description ? ` (${entry.description})` : ""}`,
            )
            .join("\n");
        } catch (error) {
          logger.warn("文档搜索失败", { error });
          return "文档搜索失败。";
        }
      },
    }),
    read_docs_page: tool({
      description: `读取用户公开文档中的页面，并返回其文本和链接。仅允许 ${sites} 下的 URL。`,
      inputSchema: z.object({
        url: z.string().describe("文档页面的完整 https URL。"),
      }),
      execute: async ({ url }) => {
        try {
          return await readDocsPage(url, sources);
        } catch (error) {
          if (error instanceof DocsFetchError) return error.message;
          logger.warn("读取文档页面失败", { error });
          return "无法读取该页面。";
        }
      },
    }),
  };
}
