import type { MailPredicate } from "@inboxzero/mail-core/queries";
import { threadsQueryToPredicate } from "@/utils/mail-engine/threads-query";
import {
  OTHER_SPLIT_ID,
  mailSplitToThreadsQuery,
  otherMailSplitQuery,
  type MailSplit,
} from "@/utils/split-inbox/split-query";

/**
 * 计数使用与会话列表相同的谓词。在客户端对已加载页面
 * 进行计数会少报每个邮件超过一页的分类。
 */
export function splitCountTargets({
  splits,
  now = new Date(),
  overrides,
}: {
  splits: MailSplit[];
  now?: Date;
  /** `null` 表示该分类的谓词尚未就绪，因此不予计数。 */
  overrides?: ReadonlyMap<string, MailPredicate | null>;
}): Array<{ id: string; predicate: MailPredicate }> {
  const targets: Array<{ id: string; predicate: MailPredicate }> = [];

  for (const split of splits) {
    if (overrides?.has(split.id)) {
      const override = overrides.get(split.id);
      if (override) targets.push({ id: split.id, predicate: override });
      continue;
    }

    try {
      targets.push({
        id: split.id,
        predicate: predicateForSplit(split, splits, now),
      });
    } catch {
      // 对于缺少必需值的分类，列表查询会抛出异常。
      // 在此跳过它，这样一个不完整的分类不会让其他所有计数都变空。
    }
  }

  return targets;
}

function predicateForSplit(
  split: MailSplit,
  splits: MailSplit[],
  now: Date,
): MailPredicate {
  const query =
    split.id === OTHER_SPLIT_ID
      ? otherMailSplitQuery(splits)
      : mailSplitToThreadsQuery(split, now);
  return threadsQueryToPredicate(query);
}
