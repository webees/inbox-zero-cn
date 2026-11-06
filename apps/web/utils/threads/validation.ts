import { z } from "zod";
import {
  MAX_SPLIT_FILTERS,
  mailSplitFiltersSchema,
} from "@/utils/split-inbox/split-filters";
import {
  MAX_MAIL_SPLITS,
  MAX_SPLIT_LABELS,
} from "@/utils/split-inbox/split-constants";
import { microsoftGraphPageTokenSchema } from "@/utils/outlook/page-token";
import { createSearchParams } from "@/utils/url";

/**
 * “匹配任一”分栏的一个分支。叶子节点都是单一条件，因此
 * 提供方可以直接对它们做 OR，而无需解析嵌套表达式。
 */
const threadsQueryLeaf = z
  .strictObject({
    labelId: z.string().trim().min(1).nullish(),
    fromEmail: z.string().trim().min(1).nullish(),
    isUnread: z.literal(true).nullish(),
    before: z.coerce.date().nullish(),
    inboxSection: z.enum(["focused", "other"]).nullish(),
  })
  .refine(
    (leaf) =>
      Object.values(leaf).filter(
        (value) => value !== null && value !== undefined,
      ).length === 1,
    { message: "每个「匹配任一」分支只能包含一个条件" },
  );
export type ThreadsQueryLeaf = z.infer<typeof threadsQueryLeaf>;

export const threadsQuery = z
  .object({
    excludeSplits: z.preprocess(
      (value) => (typeof value === "string" ? parseAnyOf(value) : value),
      z
        .array(
          z.object({
            matchAll: z.boolean(),
            filters: mailSplitFiltersSchema.refine(
              (filters) =>
                filters.every(
                  (filter) =>
                    filter.kind !== "CATEGORY" ||
                    !["focused", "other"].includes(filter.value ?? ""),
                ),
              { message: "排除其他分栏需要 Gmail 条件" },
            ),
          }),
        )
        .max(MAX_MAIL_SPLITS)
        .nullish(),
    ),
    q: z.string().nullish(),
    fromEmail: z.string().nullish(),
    limit: z.coerce.number().max(100).nullish(),
    type: z.string().nullish(),
    folderId: z.string().nullish(), // 用于 Outlook
    inboxSection: z.enum(["focused", "other"]).nullish(),
    category: z.string().trim().min(1).max(256).nullish(),
    splitId: z.string().trim().min(1).max(128).nullish(),
    nextPageToken: microsoftGraphPageTokenSchema,
    labelId: z.string().nullish(), // 用于 Google
    labelIds: z.array(z.string()).nullish(), // 用于 Google
    // 除必须全部匹配的 `labelIds` 之外，还匹配这些标签中任意一个的会话。
    // 通过为每个标签分别发起一次提供方查询来实现。
    anyLabelIds: z.array(z.string()).max(MAX_SPLIT_LABELS).nullish(),
    excludeLabelNames: z.array(z.string()).nullish(), // 用于 Google
    after: z.coerce.date().nullish(),
    before: z.coerce.date().nullish(),
    isUnread: z.coerce.boolean().nullish(),
    /**
     * 匹配其中任意一个，并与查询的其余部分做 AND。由于对象列表没有自然的
     * query-string 形式，因此以 JSON 传输。
     */
    anyOf: z.preprocess(
      (value) => (typeof value === "string" ? parseAnyOf(value) : value),
      z.array(threadsQueryLeaf).max(MAX_SPLIT_FILTERS).nullish(),
    ),
  })
  .refine(
    (query) =>
      !query.excludeSplits?.length ||
      (query.type === "inbox" &&
        !query.q &&
        !query.fromEmail &&
        !query.labelId &&
        !query.labelIds?.length &&
        !query.excludeLabelNames?.length &&
        !query.after &&
        !query.before &&
        !query.isUnread &&
        !query.folderId &&
        !query.inboxSection &&
        !query.category &&
        !query.splitId &&
        !query.anyOf?.length &&
        !query.anyLabelIds?.length),
    { message: "排除其他分栏需要普通的收件箱查询" },
  )
  .refine(
    (query) =>
      !query.anyOf?.length ||
      (!query.q &&
        !query.anyLabelIds?.length &&
        !query.folderId &&
        (!query.type || query.type === "inbox")),
    {
      message: "「匹配任一」条件需要一个不含搜索或标签并集的收件箱查询",
    },
  );
export type ThreadsQuery = z.infer<typeof threadsQuery>;

// 为列表行提供的可选精简响应。任何无法识别的值都会回退到
// 完整响应，因此错误的参数绝不会丢弃调用方依赖的数据。
export const threadsView = z.enum(["full", "list"]).catch("full");

/** 保留无效输入，让校验拒绝它而不是放宽查询条件。 */
function parseAnyOf(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 为 `/api/threads` 序列化查询，将 `anyOf` 分支以 JSON 编码。 */
export function threadsQueryToSearchParams(
  query: ThreadsQuery & Record<string, unknown>,
) {
  const { anyOf, excludeSplits, ...rest } = query;
  return createSearchParams({
    ...rest,
    ...(excludeSplits?.length
      ? { excludeSplits: JSON.stringify(excludeSplits) }
      : {}),
    ...(anyOf?.length ? { anyOf: JSON.stringify(anyOf) } : {}),
  });
}
