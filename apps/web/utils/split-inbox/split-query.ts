import { MailSplitFilterKind } from "@/generated/prisma/enums";
import type {
  ThreadsQuery,
  ThreadsQueryLeaf,
} from "@/utils/threads/validation";
import { isOutlookInboxSection } from "@/utils/outlook/inbox-sections";

export type MailSplitFilter = {
  kind: MailSplitFilterKind;
  value: string | null;
};

export type MailSplit = {
  id: string;
  name: string;
  /** false 表示「显示匹配任一条件的邮件」。 */
  matchAll: boolean;
  filters: MailSplitFilter[];
};

type QuerySplit = Pick<MailSplit, "matchAll" | "filters"> & { name?: string };

export const OTHER_SPLIT_ID = "other-inbox";

export function otherMailSplitQuery(splits: MailSplit[]): ThreadsQuery {
  return {
    type: "inbox",
    excludeSplits: splits
      .filter((split) => split.filters.length > 0)
      .map(({ matchAll, filters }) => ({
        matchAll,
        filters: filters.map(({ kind, value }) => ({ kind, value })),
      })),
  };
}

export type PortableLabelSplit = MailSplit & { labelNames: string[] };

/**「早于」条件提供的选项，以及每个选项向前追溯的时间范围。 */
const OLDER_THAN_DAYS: Record<string, number> = {
  "3d": 3,
  "1w": 7,
  "1m": 30,
};

export const OLDER_THAN_OPTIONS = [
  { value: "3d", name: "3 days" },
  { value: "1w", name: "a week" },
  { value: "1m", name: "a month" },
];

/**
 * 每个分类都是独立的服务器查询。在客户端过滤分页列表
 * 只会搜索已加载的页面，从而静默地少报结果。
 *
 * 注入 `now` 以便「早于」时间窗口可被测试。
 */
export function mailSplitToThreadsQuery(
  split: QuerySplit,
  now: Date = new Date(),
): ThreadsQuery {
  // 没有条件的分类就是普通收件箱——这就是「全部」。
  if (!split.filters.length) return { type: "inbox" };

  return split.matchAll ? matchAllQuery(split, now) : matchAnyQuery(split, now);
}

export function mailTypeToThreadsQuery(type: string): ThreadsQuery {
  if (isOutlookInboxSection(type)) {
    return { type: "inbox", inboxSection: type };
  }
  return { type };
}

/** 当归档应删除该行而不仅仅重写标签时为 true。搜索范围是整个邮箱。 */
export function threadListQueryRequiresInbox(query: ThreadsQuery): boolean {
  if (query.q) return false;
  if (query.type === "inbox" || query.type === "unread") return true;
  if (query.labelId === "INBOX") return true;
  return Boolean(query.labelIds?.includes("INBOX"));
}

export function getPortableLabelSplits(
  splits: MailSplit[],
  labelsById: Record<string, { name: string }>,
): PortableLabelSplit[] {
  return splits.flatMap((split) => {
    const labelFilters = split.filters.filter(
      (filter) => filter.kind === MailSplitFilterKind.LABEL,
    );
    if (
      !labelFilters.length ||
      labelFilters.length !== split.filters.length ||
      (split.matchAll && labelFilters.length > 1)
    )
      return [];

    const labelNames = labelFilters.map(
      (filter) => labelsById[filter.value ?? ""]?.name.trim() ?? "",
    );
    // 依赖账号已不存在的标签的分类无法
    // 在其他地方重现，因此会被丢弃而不是被静默放宽。
    if (labelNames.some((name) => !name)) return [];

    return [{ ...split, labelNames }];
  });
}

/** 所有条件以 AND 合并为单个服务商查询。 */
function matchAllQuery(split: QuerySplit, now: Date): ThreadsQuery {
  const labelIds = ["INBOX"];
  const query: ThreadsQuery = {};

  for (const filter of split.filters) {
    switch (filter.kind) {
      case MailSplitFilterKind.UNREAD:
        query.isUnread = true;
        break;
      case MailSplitFilterKind.STARRED:
        labelIds.push("STARRED");
        break;
      case MailSplitFilterKind.LABEL:
        labelIds.push(requireValue(filter, split, "label"));
        break;
      case MailSplitFilterKind.CATEGORY: {
        const category = requireValue(filter, split, "category");
        if (isOutlookInboxSection(category)) query.inboxSection = category;
        else labelIds.push(category);
        break;
      }
      case MailSplitFilterKind.FROM:
        query.fromEmail = requireValue(filter, split, "sender");
        break;
      case MailSplitFilterKind.OLDER_THAN: {
        const before = olderThanDate(
          requireValue(filter, split, "age"),
          split,
          now,
        );
        if (!query.before || before < query.before) query.before = before;
        break;
      }
    }
  }

  // `inboxSection` 仅在没有任何其他条件固定
  // 文件夹时收窄 Outlook 的收件箱，因此它自身携带收件箱范围而非标签 id。
  if (query.inboxSection && labelIds.length === 1)
    return { ...query, type: "inbox" };
  return { ...query, labelIds };
}

/**
 * 「匹配任一」是析取，单个扁平查询无法表达，因此每个
 * 条件成为独立的叶子，服务商在收件箱内对其做 OR。
 */
function matchAnyQuery(split: QuerySplit, now: Date): ThreadsQuery {
  const anyOf = split.filters.map<ThreadsQueryLeaf>((filter) => {
    switch (filter.kind) {
      case MailSplitFilterKind.UNREAD:
        return { isUnread: true };
      case MailSplitFilterKind.STARRED:
        return { labelId: "STARRED" };
      case MailSplitFilterKind.LABEL:
        return { labelId: requireValue(filter, split, "label") };
      case MailSplitFilterKind.CATEGORY: {
        const category = requireValue(filter, split, "category");
        return isOutlookInboxSection(category)
          ? { inboxSection: category }
          : { labelId: category };
      }
      case MailSplitFilterKind.FROM:
        return { fromEmail: requireValue(filter, split, "sender") };
      case MailSplitFilterKind.OLDER_THAN:
        return {
          before: olderThanDate(requireValue(filter, split, "age"), split, now),
        };
    }
  });

  return { labelIds: ["INBOX"], anyOf };
}

function requireValue(
  filter: MailSplitFilter,
  split: QuerySplit,
  what: string,
): string {
  if (!filter.value)
    throw new Error(`Split "${split.name ?? "Other"}" has no ${what}`);
  return filter.value;
}

function olderThanDate(token: string, split: QuerySplit, now: Date): Date {
  const days = OLDER_THAN_DAYS[token];
  if (!days)
    throw new Error(`Split "${split.name ?? "Other"}" has an unknown age`);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function labelIdsToThreadsQuery(labelIds: string[]): ThreadsQuery {
  if (labelIds.length === 1) return { labelIds: [labelIds[0], "INBOX"] };
  return { labelIds: ["INBOX"], anyLabelIds: labelIds };
}
