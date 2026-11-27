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
import { senderFilterSchema } from "@/utils/split-inbox/sender-filter";
import { createSearchParams } from "@/utils/url";

/**
 * “匹配任一”分区的一个分支。叶子节点是单个条件，因此服务商可以直接对它们
 * 做 OR，而无需解析嵌套表达式。
 */
const threadsQueryLeaf = z
  .strictObject({
    labelId: z.string().trim().min(1).nullish(),
    fromEmail: z.string().trim().min(1).nullish(),
    toEmail: senderFilterSchema.nullish(),
    isUnread: z.literal(true).nullish(),
    before: z.coerce.date().nullish(),
    inboxSection: z.enum(["focused", "other"]).nullish(),
  })
  .refine(
    (leaf) =>
      Object.values(leaf).filter(
        (value) => value !== null && value !== undefined,
      ).length === 1,
    { message: "每个“匹配任一”分支必须包含一个条件" },
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
              { message: "排除其他分区需要 Gmail 条件" },
            ),
          }),
        )
        .max(MAX_MAIL_SPLITS)
        .nullish(),
    ),
    q: z.string().nullish(),
    fromEmail: z.string().nullish(),
    /** 收件人或抄送字段中指向此地址或 @domain 的邮件。 */
    toEmail: senderFilterSchema.nullish(),
    limit: z.coerce.number().max(100).nullish(),
    type: z.string().nullish(),
    folderId: z.string().nullish(), // 用于 Outlook
    inboxSection: z.enum(["focused", "other"]).nullish(),
    category: z.string().trim().min(1).max(256).nullish(),
    splitId: z.string().trim().min(1).max(128).nullish(),
    nextPageToken: microsoftGraphPageTokenSchema,
    labelId: z.string().nullish(), // 用于 Google
    labelIds: z.array(z.string()).nullish(), // 用于 Google
    // 匹配这些标签中任意一个的会话，叠加在必须全部匹配的 `labelIds` 之上。
    // 通过为每个标签分别发起一次服务商查询来实现。
    anyLabelIds: z.array(z.string()).max(MAX_SPLIT_LABELS).nullish(),
    excludeLabelNames: z.array(z.string()).nullish(), // 用于 Google
    after: z.coerce.date().nullish(),
    before: z.coerce.date().nullish(),
    isUnread: z.coerce.boolean().nullish(),
    /**
     * 匹配其中任意一个，并与查询的其余条件做 AND。由于对象列表没有自然的
     * 查询字符串形式，传输时使用 JSON。
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
        !query.toEmail &&
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
    { message: "排除其他分区需要使用纯收件箱查询" },
  )
  .refine(
    (query) =>
      !query.anyOf?.length ||
      (!query.q &&
        !query.anyLabelIds?.length &&
        !query.folderId &&
        (!query.type || query.type === "inbox")),
    {
      message: "“匹配任一”条件需要不含搜索或标签并集的收件箱查询",
    },
  );
export type ThreadsQuery = z.infer<typeof threadsQuery>;

// Opt-in slim response for list rows. Anything unrecognised falls back to the
// full response so a bad param can never drop data a caller depends on.
export const threadsView = z.enum(["full", "list"]).catch("full");

/** Preserve invalid input so validation rejects it instead of widening the query. */
function parseAnyOf(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Serialises a query for `/api/threads`, JSON-encoding the `anyOf` branches. */
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
