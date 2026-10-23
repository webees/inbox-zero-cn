import type { MailSplit } from "@/utils/split-inbox/split-query";
import { MailSplitFilterKind } from "@/generated/prisma/enums";

export const INITIAL_MAIL_SPLITS = [
  { name: "全部", matchAll: true, filters: { create: [] } },
  {
    name: "未读",
    matchAll: true,
    filters: {
      create: [{ kind: MailSplitFilterKind.UNREAD, value: null, order: 0 }],
    },
  },
];

export function ensureAllMailSplit(splits: (MailSplit & { order: number })[]) {
  if (splits.some((split) => split.filters.length === 0)) return splits;

  // 较旧的账号可能在默认标签页受到保护之前删除了 All。
  return [
    { id: "all", name: "全部", order: -1, matchAll: true, filters: [] },
    ...splits,
  ];
}
