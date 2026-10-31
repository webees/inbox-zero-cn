import { z } from "zod";
import { MAX_MAIL_SPLITS } from "@/utils/split-inbox/split-constants";
import { MailLayout } from "@/generated/prisma/enums";
import {
  mailSplitFiltersSchema,
  mailSplitNameSchema,
} from "@/utils/split-inbox/split-filters";

export const createMailSplitBody = z
  .object({
    name: mailSplitNameSchema,
    filters: mailSplitFiltersSchema,
    /** 为 false 时显示匹配任意一个条件的邮件，而不是全部条件。 */
    matchAll: z.boolean().default(true),
  })
  .refine(validConjunction, {
    message: "多个发件人或收件箱分区时请使用“匹配任意一个”",
    path: ["filters"],
  });
export type CreateMailSplitBody = z.infer<typeof createMailSplitBody>;

export const updateMailSplitBody = z
  .object({
    id: z.string(),
    name: mailSplitNameSchema,
    filters: mailSplitFiltersSchema,
    matchAll: z.boolean().default(true),
  })
  .refine(validConjunction, {
    message: "多个发件人或收件箱分区时请使用“匹配任意一个”",
    path: ["filters"],
  });
export type UpdateMailSplitBody = z.infer<typeof updateMailSplitBody>;

// 客户端会发送账号可用的标签和分类，这样服务器无需从服务商重新获取；
// AI 只会从这些选项中选择，因此不会凭空创造不存在的标签。
const splitPromptOption = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["LABEL", "CATEGORY"]),
  value: z.string().trim().min(1),
});
export type SplitPromptOptionInput = z.infer<typeof splitPromptOption>;

export const buildMailSplitFromPromptBody = z.object({
  prompt: z.string().trim().min(1).max(300),
  options: z.array(splitPromptOption).max(500),
  senders: z.array(z.string().trim().max(320).pipe(z.email())).max(200),
});
export type BuildMailSplitFromPromptBody = z.infer<
  typeof buildMailSplitFromPromptBody
>;

export const reorderMailSplitsBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_MAIL_SPLITS)
    .refine((ids) => new Set(ids).size === ids.length, "拆分 ID 必须唯一"),
});

export const deleteMailSplitBody = z.object({ id: z.string() });
export type DeleteMailSplitBody = z.infer<typeof deleteMailSplitBody>;

export const updateMailPreferencesBody = z
  .object({
    layout: z.nativeEnum(MailLayout).optional(),
    expandedPreview: z.boolean().optional(),
  })
  // 每个字段都是可选的，这样调用方可以只更新一项偏好而无需重复其他项，
  // 否则也会接受空更新。
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "请至少提供一项偏好设置",
  });
export type UpdateMailPreferencesBody = z.infer<
  typeof updateMailPreferencesBody
>;

function validConjunction(split: {
  matchAll: boolean;
  filters: { kind: string; value?: string | null }[];
}) {
  if (!split.matchAll) return true;
  const senders = new Set(
    split.filters
      .filter((filter) => filter.kind === "FROM")
      .map((filter) => filter.value),
  );
  const sections = new Set(
    split.filters
      .filter(
        (filter) =>
          filter.kind === "CATEGORY" &&
          (filter.value === "focused" || filter.value === "other"),
      )
      .map((filter) => filter.value),
  );
  return senders.size <= 1 && sections.size <= 1;
}
