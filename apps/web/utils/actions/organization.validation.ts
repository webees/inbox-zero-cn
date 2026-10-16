import { z } from "zod";

export const createOrganizationBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, "组织名称为必填项")
    .max(100, "组织名称必须少于 100 个字符"),
  slug: z
    .string()
    .trim()
    .min(1, "Slug 为必填项")
    .max(50, "Slug 必须少于 50 个字符")
    .regex(/^[a-z0-9-]+$/, "Slug 只能包含小写字母、数字和连字符"),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBody>;

export const MAX_BULK_INVITES = 10;

export const inviteMembersBody = z.object({
  invitations: z
    .array(
      z.object({
        email: z
          .string()
          .trim()
          .email("请输入有效的邮箱地址")
          .transform((val) => val.trim().toLowerCase()),
        role: z.enum(["owner", "admin", "member"]),
      }),
    )
    .min(1, "至少需要一项邀请")
    .max(MAX_BULK_INVITES, `一次最多可邀请 ${MAX_BULK_INVITES} 人`),
  organizationId: z.string().min(1, "组织 ID 为必填项"),
});
export type InviteMembersBody = z.infer<typeof inviteMembersBody>;

export const handleInvitationBody = z.object({
  invitationId: z.string().trim().min(1, "邀请 ID 为必填项"),
});
export type HandleInvitationBody = z.infer<typeof handleInvitationBody>;

export const removeMemberBody = z.object({
  memberId: z.string().min(1, "成员 ID 为必填项"),
});

export type RemoveMemberBody = z.infer<typeof removeMemberBody>;

export const updateMemberRoleBody = z.object({
  memberId: z.string().min(1, "成员 ID 为必填项"),
  role: z.enum(["admin", "member"]),
});

export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBody>;

export const transferOwnershipBody = z.object({
  organizationId: z.string().min(1, "组织 ID 为必填项"),
  memberId: z.string().min(1, "成员 ID 为必填项"),
});

export type TransferOwnershipBody = z.infer<typeof transferOwnershipBody>;

export const cancelInvitationBody = z.object({
  invitationId: z.string().min(1, "邀请 ID 为必填项"),
});

export type CancelInvitationBody = z.infer<typeof cancelInvitationBody>;

export const updateAnalyticsConsentBody = z.object({
  allowOrgAdminAnalytics: z.boolean(),
});

export type UpdateAnalyticsConsentBody = z.infer<
  typeof updateAnalyticsConsentBody
>;

export const createOrganizationAndInviteBody = z.object({
  emails: z
    .array(
      z
        .string()
        .trim()
        .email()
        .transform((val) => val.toLowerCase()),
    )
    .min(1, "至少需要一个邮箱地址"),
  userName: z.string().nullable().optional(),
});
export type CreateOrganizationAndInviteBody = z.infer<
  typeof createOrganizationAndInviteBody
>;
