import type { MailSplit } from "@/utils/split-inbox/split-query";
import { MailSplitFilterKind } from "@/generated/prisma/enums";

const ALL_MAIL_SPLIT_NAME = "全部";

export const INITIAL_MAIL_SPLITS = [
  { name: ALL_MAIL_SPLIT_NAME, matchAll: true, filters: { create: [] } },
  {
    name: "未读",
    matchAll: true,
    filters: {
      create: [{ kind: MailSplitFilterKind.UNREAD, value: null, order: 0 }],
    },
  },
];

export function ensureAllMailSplit(
  splits: (MailSplit & {
    order: number;
    bundleInInbox: boolean;
    hideFromAll: boolean;
  })[],
) {
  if (splits.some((split) => split.filters.length === 0)) return splits;

  // 旧账号可能在默认标签页受到保护之前删除了“全部”。
  return [
    {
      id: "all",
      name: ALL_MAIL_SPLIT_NAME,
      order: -1,
      matchAll: true,
      bundleInInbox: false,
      hideFromAll: false,
      filters: [],
    },
    ...splits,
  ];
}

// 应用自带的“全部”标签页，仍使用创建时的名称。用户重命名过的标签页保留其名称。
export function isDefaultAllMailSplit(
  split: Pick<MailSplit, "name" | "filters">,
) {
  return !split.filters.length && split.name === ALL_MAIL_SPLIT_NAME;
}
