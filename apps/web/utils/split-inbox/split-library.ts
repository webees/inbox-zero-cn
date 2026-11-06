import { MailSplitFilterKind, SystemType } from "@/generated/prisma/enums";
import type { MailSplitFilterDraft } from "@/utils/split-inbox/split-filters";

/**
 * A condition in the prepared library, written against label *names* so one
 * catalogue works for every account — ids are resolved per account at render.
 */
type LibraryCondition =
  | { kind: "LABEL"; labelName: string }
  | { kind: "CATEGORY"; categoryName: string }
  | { kind: "FROM"; sender: string }
  | { kind: "UNREAD" }
  | { kind: "STARRED" };

export type SplitLibraryEntry = {
  name: string;
  description: string;
  category: string;
  conditions: LibraryCondition[];
  /** Prepared splits ask for every condition unless they list alternatives. */
  matchAll?: boolean;
  /**
   * Turning this on creates the owned system rule (and its label) rather than
   * requiring the label to already exist.
   */
  createsSystemType?: SystemType;
};

export const SPLIT_LIBRARY: SplitLibraryEntry[] = [
  {
    name: "Important",
    category: "通用",
    description: "基于 Gmail 的重要性标记。",
    conditions: [{ kind: "LABEL", labelName: "Important" }],
  },
  {
    name: "待回复",
    category: "通用",
    description: "等待你答复的会话，由 Reply Zero 打上标签。",
    conditions: [{ kind: "LABEL", labelName: "待回复" }],
  },
  {
    name: "Starred",
    category: "通用",
    description: "你加星标的所有邮件，集中在一处。",
    conditions: [{ kind: "STARRED" }],
  },
  {
    name: "等待回复",
    category: "通用",
    description: "你已经回复，对方还没有。值得跟进提醒的会话。",
    conditions: [{ kind: "LABEL", labelName: "等待回复" }],
  },
  {
    name: "知悉",
    category: "通用",
    description: "值得了解，但无需你回复。",
    conditions: [{ kind: "LABEL", labelName: "知悉" }],
  },
  {
    name: "已处理",
    category: "通用",
    description: "已经结束、没有任何人等待的会话。",
    conditions: [{ kind: "LABEL", labelName: "已处理" }],
  },
  {
    name: "日历",
    category: "通用",
    description: "邀请、改期与会议通知。",
    conditions: [{ kind: "LABEL", labelName: "日历" }],
  },
  {
    name: "收据",
    category: "通用",
    description: "付款、结算与发票。",
    conditions: [{ kind: "LABEL", labelName: "收据" }],
  },
  {
    name: "订阅简报",
    category: "通用",
    description: "你订阅的批量邮件，有空时再读。",
    conditions: [{ kind: "LABEL", labelName: "订阅简报" }],
  },
  {
    name: "通知",
    category: "通用",
    description: "工具提醒与摘要，移出主收件箱。",
    conditions: [{ kind: "LABEL", labelName: "通知" }],
  },
  {
    name: "验证码",
    category: "通用",
    description: "一次性密码、两步验证码与登录链接。",
    conditions: [{ kind: "LABEL", labelName: "验证码" }],
    createsSystemType: SystemType.OTP,
  },
  {
    name: "冷邮件",
    category: "通用",
    description: "来自无往来发件人的陌生推销。",
    conditions: [{ kind: "LABEL", labelName: "冷邮件" }],
  },
  {
    name: "Unread",
    category: "通用",
    description: "你还没有打开过的所有邮件。",
    conditions: [{ kind: "UNREAD" }],
  },
  {
    name: "GitHub",
    category: "应用",
    description: "拉取请求、评审与议题动态。",
    conditions: [
      { kind: "FROM", sender: "mentions@noreply.github.com" },
      { kind: "FROM", sender: "notifications@github.com" },
    ],
    matchAll: false,
  },
  {
    name: "Stripe",
    category: "应用",
    description: "来自 Stripe 的结算、争议与发票收据。",
    conditions: [{ kind: "FROM", sender: "receipts@stripe.com" }],
  },
  {
    name: "Linear",
    category: "应用",
    description: "来自 Linear 的议题指派、评论与提及。",
    conditions: [
      { kind: "FROM", sender: "notifications@linear.app" },
      { kind: "FROM", sender: "notifications@mail.linear.app" },
    ],
    matchAll: false,
  },
  {
    name: "Figma",
    category: "应用",
    description: "来自你团队的评论与文件更新。",
    conditions: [{ kind: "FROM", sender: "no-reply@figma.com" }],
  },
  {
    name: "Notion",
    category: "应用",
    description: "文档的评论、提及与更新。",
    conditions: [{ kind: "FROM", sender: "notify@mail.notion.so" }],
  },
  {
    name: "Asana",
    category: "应用",
    description: "任务指派、截止日期与项目更新。",
    conditions: [{ kind: "FROM", sender: "no-reply@asana.com" }],
  },
  {
    name: "Trello",
    category: "应用",
    description: "看板邀请与任务通知。",
    conditions: [{ kind: "FROM", sender: "do-not-reply@trello.com" }],
  },
  {
    name: "HubSpot",
    category: "应用",
    description: "线索动态、表单提交与 CRM 通知。",
    conditions: [
      { kind: "FROM", sender: "noreply@notifications.hubspot.com" },
      { kind: "FROM", sender: "no-reply@hubspot.com" },
      { kind: "FROM", sender: "noreply@hubspot.com" },
    ],
    matchAll: false,
  },
  {
    name: "Salesforce",
    category: "应用",
    description: "商机更新与销售动态。",
    conditions: [
      { kind: "FROM", sender: "info@salesforce.com" },
      { kind: "FROM", sender: "support@salesforce.com" },
      { kind: "FROM", sender: "email@mail.salesforce.com" },
      { kind: "FROM", sender: "noreply@salesforce.com" },
      { kind: "FROM", sender: "no-reply@salesforce.com" },
      { kind: "FROM", sender: "notifications@salesforce.com" },
    ],
    matchAll: false,
  },
  {
    name: "Pipedrive",
    category: "应用",
    description: "交易更新、跟进与销售管道动态。",
    conditions: [
      { kind: "FROM", sender: "notifications@pipedrive.com" },
      { kind: "FROM", sender: "info@pipedrive.com" },
      { kind: "FROM", sender: "notifier@pipedrive.com" },
      { kind: "FROM", sender: "support@pipedrive.com" },
      { kind: "FROM", sender: "noreply@pipedrive.com" },
    ],
    matchAll: false,
  },
];

export const SPLIT_LIBRARY_CATEGORIES = [
  ...new Set(SPLIT_LIBRARY.map((entry) => entry.category)),
];

/**
 * Resolves an entry's label and category names against this account. Returns
 * null when the account has no such label, so the library never offers a split
 * that would come back empty for a reason the reader can't see. Opt-in entries
 * that create their own system rule still appear — see availableLibraryFilters.
 */
export function resolveLibraryEntry(
  entry: SplitLibraryEntry,
  {
    labelsByName,
    categoriesByName,
  }: {
    labelsByName: Map<string, string>;
    categoriesByName: Map<string, string>;
  },
): MailSplitFilterDraft[] | null {
  const filters: MailSplitFilterDraft[] = [];

  for (const condition of entry.conditions) {
    switch (condition.kind) {
      case "UNREAD":
        filters.push({ kind: MailSplitFilterKind.UNREAD, value: null });
        break;
      case "STARRED":
        filters.push({ kind: MailSplitFilterKind.STARRED, value: null });
        break;
      case "FROM":
        filters.push({
          kind: MailSplitFilterKind.FROM,
          value: condition.sender,
        });
        break;
      case "LABEL": {
        const labelId = labelsByName.get(condition.labelName.toLowerCase());
        if (!labelId) return null;
        filters.push({ kind: MailSplitFilterKind.LABEL, value: labelId });
        break;
      }
      case "CATEGORY": {
        const category = categoriesByName.get(
          condition.categoryName.toLowerCase(),
        );
        if (!category) return null;
        filters.push({ kind: MailSplitFilterKind.CATEGORY, value: category });
        break;
      }
    }
  }

  return filters;
}

/**
 * Same as resolveLibraryEntry, except opt-in system-rule entries stay visible
 * before their label exists so the library can be the way they get created.
 */
export function availableLibraryFilters(
  entry: SplitLibraryEntry,
  maps: {
    labelsByName: Map<string, string>;
    categoriesByName: Map<string, string>;
  },
): MailSplitFilterDraft[] | null {
  const filters = resolveLibraryEntry(entry, maps);
  if (filters) return filters;
  return entry.createsSystemType ? [] : null;
}

/** The human-readable "Definition" rows shown on a library entry's detail view. */
export function libraryDefinition(entry: SplitLibraryEntry) {
  return entry.conditions.map((condition) => {
    switch (condition.kind) {
      case "UNREAD":
        return { key: "是", value: "未读" };
      case "STARRED":
        return { key: "是", value: "已加星标" };
      case "FROM":
        return { key: "来自", value: condition.sender };
      case "LABEL":
        return { key: "标签", value: condition.labelName };
      case "CATEGORY":
        return { key: "分类", value: condition.categoryName };
    }
  });
}

export function findLibrarySplit(
  entry: SplitLibraryEntry,
  filters: MailSplitFilterDraft[],
  splits: {
    id: string;
    name: string;
    matchAll: boolean;
    filters: MailSplitFilterDraft[];
  }[],
) {
  if (entry.createsSystemType) {
    return splits.find(
      (split) => split.name.toLowerCase() === entry.name.toLowerCase(),
    );
  }
  return splits.find(
    (split) =>
      split.name.toLowerCase() === entry.name.toLowerCase() &&
      split.matchAll === (entry.matchAll ?? true) &&
      split.filters.length === filters.length &&
      JSON.stringify(
        split.filters
          .map((filter) => [filter.kind, filter.value ?? null])
          .sort(),
      ) ===
        JSON.stringify(
          filters.map((filter) => [filter.kind, filter.value ?? null]).sort(),
        ),
  );
}
