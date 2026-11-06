import { z } from "zod";
import { senderFilterSchema } from "@/utils/split-inbox/sender-filter";
import { MailSplitFilterKind } from "@/generated/prisma/enums";
import { OLDER_THAN_OPTIONS } from "@/utils/split-inbox/split-query";

/** UNREAD 和 STARRED 本身就是完整条件；其余条件需要指定目标。 */
const KINDS_REQUIRING_VALUE = new Set<MailSplitFilterKind>([
  MailSplitFilterKind.LABEL,
  MailSplitFilterKind.CATEGORY,
  MailSplitFilterKind.FROM,
  MailSplitFilterKind.OLDER_THAN,
]);

const OLDER_THAN_VALUES = OLDER_THAN_OPTIONS.map((option) => option.value);

export const mailSplitFilterSchema = z
  .object({
    kind: z.nativeEnum(MailSplitFilterKind),
    value: z.string().trim().min(1).max(320).nullish(),
  })
  .refine(
    (filter) =>
      KINDS_REQUIRING_VALUE.has(filter.kind)
        ? !!filter.value
        : filter.value == null,
    {
      message: "仅需指定目标的条件才应提供值",
      path: ["value"],
    },
  )
  .refine(
    (filter) =>
      filter.kind !== MailSplitFilterKind.FROM ||
      senderFilterSchema.safeParse(filter.value).success,
    { message: "请输入发件人邮箱地址或 @domain.com", path: ["value"] },
  )
  .refine(
    (filter) =>
      filter.kind !== MailSplitFilterKind.OLDER_THAN ||
      OLDER_THAN_VALUES.includes(filter.value ?? ""),
    { message: "未知时间范围", path: ["value"] },
  );

export type MailSplitFilterDraft = z.infer<typeof mailSplitFilterSchema>;

/** 每个筛选条件占一行，因此上限与构建器可展示的行数一致。 */
export const MAX_SPLIT_FILTERS = 25;

export const mailSplitFiltersSchema = z
  .array(mailSplitFilterSchema)
  .max(MAX_SPLIT_FILTERS);

export const mailSplitNameSchema = z.string().trim().min(1).max(60);
