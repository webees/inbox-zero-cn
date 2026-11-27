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
      description: `Search the user's public documentation (${sites}) for pages about a topic. Matches exact words in page titles, paths, and descriptions, and the docs may word things differently from the email, so pass several alternative phrasings. Returns page titles and URLs; read a page with read_docs_page before relying on it.`,
      inputSchema: z.object({
        queries: z
          .array(z.string())
          .describe(
            "1 to 5 short keyword queries, such as the feature name, synonyms, and terms the docs are likely to use.",
          ),
      }),
      execute: async ({ queries }) => {
        try {
          const entries = searchDocsIndex(
            await getDocsIndex(sources),
            queries.slice(0, 5),
          );
          if (!entries.length) {
            return "文档索引中没有找到匹配的页面。请尝试其他表述，或直接使用 read_docs_page 读取文档 URL。";
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
      description: `Read a page from the user's public documentation and return its text and links. Only URLs under ${sites} are allowed.`,
      inputSchema: z.object({
        url: z.string().describe("Full https URL of the docs page."),
      }),
      execute: async ({ url }) => {
        try {
          return await readDocsPage(url, sources);
        } catch (error) {
          if (error instanceof DocsFetchError) return error.message;
          logger.warn("文档页面读取失败", { error });
          return "无法读取该页面。";
        }
      },
    }),
  };
}
