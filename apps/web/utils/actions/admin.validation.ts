import { z } from "zod";

export const hashEmailBody = z.object({
  email: z.string().min(1, "此值为必填项"),
});
export type HashEmailBody = z.infer<typeof hashEmailBody>;

export const convertGmailUrlBody = z.object({
  rfc822MessageId: z.string().trim().min(1, "RFC822 Message-ID 为必填项"),
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type ConvertGmailUrlBody = z.infer<typeof convertGmailUrlBody>;

export const getLabelsBody = z.object({
  emailAccountId: z.string().min(1, "邮箱账号 ID 为必填项"),
});
export type GetLabelsBody = z.infer<typeof getLabelsBody>;

export const watchEmailsBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type WatchEmailsBody = z.infer<typeof watchEmailsBody>;

export const syncStripeForUserBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type SyncStripeForUserBody = z.infer<typeof syncStripeForUserBody>;

export const syncAppleSubscriptionForUserBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
  transactionId: z.string().trim().min(1, "交易 ID 为必填项"),
});
export type SyncAppleSubscriptionForUserBody = z.infer<
  typeof syncAppleSubscriptionForUserBody
>;

export const getUserInfoBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type GetUserInfoBody = z.infer<typeof getUserInfoBody>;

export const loadResponseTimeDataBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
  maxSentMessages: z.coerce.number().int().min(1).max(2000).default(500),
});
export type LoadResponseTimeDataBody = z.infer<typeof loadResponseTimeDataBody>;

export const disableAllRulesBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type DisableAllRulesBody = z.infer<typeof disableAllRulesBody>;

export const cleanupDraftsBody = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
export type CleanupDraftsBody = z.infer<typeof cleanupDraftsBody>;
