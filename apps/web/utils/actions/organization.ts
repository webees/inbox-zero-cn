"use server";

import { after } from "next/server";
import { actionClient, actionClientUser } from "@/utils/actions/safe-action";
import {
  createOrganizationBody,
  inviteMembersBody,
  removeMemberBody,
  updateMemberRoleBody,
  transferOwnershipBody,
  cancelInvitationBody,
  handleInvitationBody,
  updateAnalyticsConsentBody,
  createOrganizationAndInviteBody,
} from "@/utils/actions/organization.validation";
import prisma from "@/utils/prisma";
import { captureException, SafeError } from "@/utils/error";
import { getAuthorizedOrganizationAdminMembership } from "@/utils/organizations/access";
import { sendOrganizationInvitation } from "@/utils/organizations/invitations";
import {
  claimPendingPremiumInvite,
  removeFromPendingInvites,
  removeUserFromPremium,
} from "@/utils/premium/seats";
import { env } from "@/env";
import { slugify } from "@/utils/string";
import { posthogCaptureEvent } from "@/utils/posthog";
import { createScopedLogger } from "@/utils/logger";
import { prepareMemberRemovalNotifications } from "@/utils/team-comments/member-removal";
import {
  deleteMemberOrganizationRuleCopies,
  syncOrganizationRulesForNewMember,
} from "@/utils/organizations/rules";

export const createOrganizationAction = actionClient
  .metadata({ name: "createOrganization" })
  .inputSchema(createOrganizationBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { name, slug } }) => {
    const existingMembership = await prisma.member.findFirst({
      where: { emailAccountId },
      select: { id: true },
    });

    if (existingMembership) {
      throw new SafeError("你已经是某个组织的成员。你一次只能属于一个组织。");
    }

    const existingOrganization = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingOrganization) {
      throw new SafeError("已存在使用此 slug 的组织。请选择其他 slug。");
    }

    const organization = await prisma.organization.create({
      data: { name, slug },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    await prisma.member.create({
      data: {
        organizationId: organization.id,
        emailAccountId,
        role: "owner",
        allowOrgAdminAnalytics: env.AUTO_ENABLE_ORG_ANALYTICS,
      },
    });

    return organization;
  });

export const inviteMembersAction = actionClientUser
  .metadata({ name: "inviteMembers" })
  .inputSchema(inviteMembersBody)
  .action(
    async ({
      ctx: { userId },
      parsedInput: { invitations, organizationId },
    }) => {
      const inviterMember = await getAuthorizedOrganizationAdminMembership({
        organizationId,
        userId,
        unauthorizedMessage: "只有组织所有者或管理员可以邀请成员。",
      });

      const [inviterEmailAccount, org] = await Promise.all([
        prisma.emailAccount.findUnique({
          where: { id: inviterMember.emailAccountId },
          select: { name: true, email: true },
        }),
        prisma.organization.findUnique({
          where: { id: inviterMember.organizationId },
          select: { name: true },
        }),
      ]);

      if (!inviterEmailAccount) {
        throw new SafeError("未找到邮箱账号。");
      }

      const inviterName = inviterEmailAccount.name || inviterEmailAccount.email;
      const organizationName = org?.name || "你的组织";

      const pendingInvitations = await prisma.invitation.findMany({
        where: {
          organizationId: inviterMember.organizationId,
          email: { in: invitations.map((i) => i.email) },
          status: "pending",
        },
        select: { id: true, email: true, expiresAt: true },
      });

      // 已过期的邀请不会显示在成员列表中，因此无法在那里
      // 取消。清除它们，以便管理员重新发送一份。
      const now = new Date();
      const expiredInvitationIds = pendingInvitations
        .filter((i) => i.expiresAt <= now)
        .map((i) => i.id);
      if (expiredInvitationIds.length) {
        await prisma.invitation.deleteMany({
          where: { id: { in: expiredInvitationIds }, status: "pending" },
        });
      }

      const alreadyInvited = new Set(
        pendingInvitations.filter((i) => i.expiresAt > now).map((i) => i.email),
      );

      const results: { email: string; success: boolean; error?: string }[] = [];
      const seen = new Set<string>();

      for (const { email, role } of invitations) {
        if (seen.has(email)) {
          results.push({ email, success: false, error: "邮箱重复" });
          continue;
        }
        seen.add(email);

        if (role === "owner" && inviterMember.role !== "owner") {
          results.push({
            email,
            success: false,
            error: "只有所有者可以分配所有者角色。",
          });
          continue;
        }

        if (alreadyInvited.has(email)) {
          results.push({ email, success: false, error: "已邀请" });
          continue;
        }

        const invitation = await prisma.invitation.create({
          data: {
            organizationId: inviterMember.organizationId,
            email,
            role,
            status: "pending",
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14), // 14 days
            inviterId: inviterMember.emailAccountId,
          },
          select: { id: true },
        });

        try {
          await sendOrganizationInvitation({
            email,
            organizationName,
            inviterName,
            invitationId: invitation.id,
          });
          results.push({ email, success: true });
        } catch {
          await prisma.invitation.delete({ where: { id: invitation.id } });
          results.push({
            email,
            success: false,
            error: "邮件发送失败",
          });
        }
      }

      return { results };
    },
  );

export const handleInvitationAction = actionClientUser
  .metadata({ name: "handleInvitation" })
  .inputSchema(handleInvitationBody)
  .action(async ({ ctx: { userId }, parsedInput: { invitationId } }) => {
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new SafeError("未找到邀请", 404);
    }

    assertInvitationCanBeAccepted(invitation);

    const emailAccount = await prisma.emailAccount.findFirst({
      where: {
        user: { id: userId },
        email: { equals: invitation.email.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });

    if (!emailAccount) {
      throw new SafeError("你不是该邀请的接收者", 400);
    }

    const emailAccountId = emailAccount.id;

    await acceptInvitation({ emailAccountId, invitationId });

    after(() =>
      posthogCaptureEvent(
        invitation.email,
        "organization_invitation_accepted",
        {
          organizationId: invitation.organizationId,
          role: invitation.role,
          inviterId: invitation.inviterId,
        },
      ),
    );

    return { organizationId: invitation.organizationId };
  });

async function getInvitation({
  emailAccountId,
  invitationId,
}: {
  emailAccountId: string;
  invitationId: string;
}): Promise<{
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
}> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    throw new SafeError("未找到邀请", 404);
  }

  assertInvitationCanBeAccepted(invitation);

  const email = invitation.email.trim();

  const hasMatchingEmail = await prisma.emailAccount.findFirst({
    where: {
      id: emailAccountId,
      email: { equals: email, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (!hasMatchingEmail) {
    throw new SafeError("你不是该邀请的接收者", 400);
  }

  return invitation;
}

async function acceptInvitation({
  emailAccountId,
  invitationId,
}: {
  emailAccountId: string;
  invitationId: string;
}): Promise<{ organizationId: string; memberId: string }> {
  const invitation = await getInvitation({ emailAccountId, invitationId });

  const existingMembership = await prisma.member.findFirst({
    where: { emailAccountId },
    select: { id: true, organizationId: true },
  });

  if (existingMembership) {
    if (existingMembership.organizationId === invitation.organizationId) {
      await prisma.invitation.update({
        where: { id: invitationId },
        data: { status: "accepted" },
      });
      return {
        organizationId: invitation.organizationId,
        memberId: existingMembership.id,
      };
    }
    throw new SafeError("你已经是某个组织的成员。你一次只能属于一个组织。");
  }

  const createdMember = await prisma.member.create({
    data: {
      emailAccountId,
      organizationId: invitation.organizationId,
      role: invitation.role ?? "member",
      allowOrgAdminAnalytics: env.AUTO_ENABLE_ORG_ANALYTICS,
    },
    select: { id: true },
  });

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "accepted" },
  });

  // 同步失败不得阻止加入组织，但会被暴露出来
  // （记录并捕获），以便团队恢复该成员缺失的规则副本。
  const syncLogger = createScopedLogger("organizations/rules").with({
    emailAccountId,
    organizationId: invitation.organizationId,
  });
  try {
    await syncOrganizationRulesForNewMember({
      organizationId: invitation.organizationId,
      emailAccountId,
      logger: syncLogger,
    });
  } catch (error) {
    syncLogger.error("为新成员生成组织规则失败", {
      error,
    });
    captureException(error, {
      emailAccountId,
      extra: {
        organizationId: invitation.organizationId,
        context: "syncOrganizationRulesForNewMember",
      },
    });
  }

  const premium = await getOrganizationPremium(invitation.organizationId);
  if (premium) {
    const emailAccount = await getUserFromEmailAccount(emailAccountId);
    if (emailAccount?.user) {
      await claimPendingPremiumInvite({
        premiumId: premium.id,
        visitorId: emailAccount.user.id,
        email: emailAccount.email,
      });
    }
  }

  return {
    organizationId: invitation.organizationId,
    memberId: createdMember.id,
  };
}

export const removeMemberAction = actionClientUser
  .metadata({ name: "removeMember" })
  .inputSchema(removeMemberBody)
  .action(async ({ ctx: { userId, logger }, parsedInput: { memberId } }) => {
    const { targetMember } = await authorizeMemberManagement({
      memberId,
      userId,
      action: "remove",
    });

    if (targetMember.role === "owner") {
      const ownerCount = await prisma.member.count({
        where: { organizationId: targetMember.organizationId, role: "owner" },
      });
      if (ownerCount === 1) {
        throw new SafeError("无法从组织中移除最后一名所有者。");
      }
    }

    const premium = await getOrganizationPremium(targetMember.organizationId);
    if (premium) {
      const emailAccount = await getUserFromEmailAccount(
        targetMember.emailAccountId,
      );
      if (emailAccount?.user) {
        await removeUserFromPremium({
          premiumId: premium.id,
          visitorId: emailAccount.user.id,
        });
      }
    }

    await deleteMemberOrganizationRuleCopies({
      emailAccountId: targetMember.emailAccountId,
      organizationId: targetMember.organizationId,
    });

    const notifyConversations = await prepareMemberRemovalNotifications(
      { id: memberId },
      logger,
    );
    await prisma.member.delete({ where: { id: memberId } });
    await notifyConversations();
  });

export const updateMemberRoleAction = actionClientUser
  .metadata({ name: "updateMemberRole" })
  .inputSchema(updateMemberRoleBody)
  .action(async ({ ctx: { userId }, parsedInput: { memberId, role } }) => {
    const { targetMember } = await authorizeMemberManagement({
      memberId,
      userId,
      action: "updateRole",
    });

    if (targetMember.role === role) {
      return { id: targetMember.id, role: targetMember.role };
    }

    return prisma.member.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, role: true },
    });
  });

export const transferOwnershipAction = actionClientUser
  .metadata({ name: "transferOwnership" })
  .inputSchema(transferOwnershipBody)
  .action(
    async ({ ctx: { userId }, parsedInput: { organizationId, memberId } }) => {
      const targetMember = await prisma.member.findUnique({
        where: { id: memberId },
        select: {
          id: true,
          emailAccountId: true,
          organizationId: true,
          role: true,
        },
      });

      if (!targetMember || targetMember.organizationId !== organizationId) {
        throw new SafeError("未找到成员。");
      }

      const callerMembership = await prisma.member.findFirst({
        where: {
          organizationId,
          role: "owner",
          emailAccount: { userId },
        },
        select: { id: true, emailAccountId: true },
      });

      if (!callerMembership) {
        throw new SafeError("只有组织所有者可以转移所有权。");
      }

      if (targetMember.emailAccountId === callerMembership.emailAccountId) {
        throw new SafeError("你已经拥有此组织。");
      }

      if (targetMember.role === "owner") {
        return { id: targetMember.id, role: targetMember.role };
      }

      await prisma.$transaction([
        prisma.member.update({
          where: { id: targetMember.id },
          data: { role: "owner" },
        }),
        prisma.member.update({
          where: { id: callerMembership.id },
          data: { role: "admin" },
        }),
      ]);

      return { id: targetMember.id, role: "owner" };
    },
  );

export const cancelInvitationAction = actionClientUser
  .metadata({ name: "cancelInvitation" })
  .inputSchema(cancelInvitationBody)
  .action(async ({ ctx: { userId }, parsedInput: { invitationId } }) => {
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        email: true,
      },
    });

    if (!invitation) {
      throw new SafeError("未找到邀请。");
    }

    if (invitation.status !== "pending") {
      throw new SafeError("只能取消待处理的邀请。");
    }

    await getAuthorizedOrganizationAdminMembership({
      organizationId: invitation.organizationId,
      userId,
      unauthorizedMessage: "只有组织所有者或管理员可以取消邀请。",
    });

    // 从高级版待处理邀请中移除
    const premium = await getOrganizationPremium(invitation.organizationId);
    if (premium) {
      await removeFromPendingInvites({
        email: invitation.email,
        premiumId: premium.id,
      });
    }

    const result = await prisma.invitation.deleteMany({
      where: { id: invitationId, status: "pending" },
    });
    if (result.count === 0) {
      throw new SafeError("邀请不再是待处理状态。");
    }
  });

async function getOrganizationPremium(organizationId: string) {
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) return;
  const owner = await prisma.member.findFirst({
    where: { organizationId, role: "owner" },
    select: {
      emailAccount: {
        select: {
          user: {
            select: {
              premium: {
                select: {
                  id: true,
                  pendingInvites: true,
                },
              },
            },
          },
        },
      },
    },
  });
  return owner?.emailAccount.user.premium;
}

async function getUserFromEmailAccount(emailAccountId: string) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { email: true, user: { select: { id: true } } },
  });
  return emailAccount;
}

export const updateAnalyticsConsentAction = actionClient
  .metadata({ name: "updateAnalyticsConsent" })
  .inputSchema(updateAnalyticsConsentBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { allowOrgAdminAnalytics },
    }) => {
      const member = await prisma.member.findFirst({
        where: { emailAccountId },
        select: { id: true },
      });

      if (!member) {
        throw new SafeError("你不属于任何组织");
      }

      await prisma.member.update({
        where: { id: member.id },
        data: { allowOrgAdminAnalytics },
      });

      return { success: true };
    },
  );

export const createOrganizationAndInviteAction = actionClient
  .metadata({ name: "createOrganizationAndInvite" })
  .inputSchema(createOrganizationAndInviteBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { emails, userName } }) => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { id: true, email: true, name: true },
      });

      if (!emailAccount) {
        throw new SafeError("未找到邮箱账号");
      }

      const existingMembership = await prisma.member.findFirst({
        where: { emailAccountId },
        select: { id: true, organizationId: true, role: true },
      });

      if (existingMembership) {
        throw new SafeError("你已经是某个组织的成员。请使用标准邀请流程。");
      }

      const firstName = (userName ?? emailAccount.name)?.split(" ")[0] || "My";
      const orgName = `${firstName}'s Organization`;
      const baseSlug = slugify(orgName);
      const slug = await generateUniqueSlug(baseSlug);

      const organization = await prisma.organization.create({
        data: { name: orgName, slug },
      });

      await prisma.member.create({
        data: {
          organizationId: organization.id,
          emailAccountId,
          role: "owner",
          allowOrgAdminAnalytics: env.AUTO_ENABLE_ORG_ANALYTICS,
        },
      });

      const inviterName = emailAccount.name || emailAccount.email;
      const results: { email: string; success: boolean; error?: string }[] = [];

      for (const email of emails) {
        const existing = await prisma.invitation.findFirst({
          where: {
            organizationId: organization.id,
            email,
            status: "pending",
          },
        });

        if (existing) {
          results.push({ email, success: false, error: "已邀请" });
          continue;
        }

        const invitation = await prisma.invitation.create({
          data: {
            organizationId: organization.id,
            email,
            role: "member",
            status: "pending",
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
            inviterId: emailAccountId,
          },
        });

        try {
          await sendOrganizationInvitation({
            email,
            organizationName: orgName,
            inviterName,
            invitationId: invitation.id,
          });
          results.push({ email, success: true });
        } catch {
          await prisma.invitation.delete({ where: { id: invitation.id } });
          results.push({
            email,
            success: false,
            error: "邮件发送失败",
          });
        }
      }

      return { organizationId: organization.id, results };
    },
  );

function getRandomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function generateUniqueSlug(baseSlug: string): Promise<string> {
  const maxAttempts = 3;
  let randomSuffix = "";
  let attempts = 0;

  let existingOrg = await prisma.organization.findUnique({
    where: { slug: baseSlug + randomSuffix },
  });

  while (existingOrg && attempts < maxAttempts) {
    randomSuffix = `-${getRandomId()}`;
    existingOrg = await prisma.organization.findUnique({
      where: { slug: baseSlug + randomSuffix },
    });
    attempts++;
  }

  if (existingOrg) {
    throw new Error("无法生成唯一的组织 slug");
  }

  return baseSlug + randomSuffix;
}

async function authorizeMemberManagement({
  memberId,
  userId,
  action,
}: {
  memberId: string;
  userId: string;
  action: MemberManagementAction;
}) {
  const targetMember = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      emailAccountId: true,
      organizationId: true,
      role: true,
    },
  });

  if (!targetMember) {
    throw new SafeError("未找到成员。");
  }

  const callerMembership = await getAuthorizedOrganizationAdminMembership({
    organizationId: targetMember.organizationId,
    userId,
    unauthorizedMessage: memberManagementUnauthorizedMessages[action],
  });

  if (targetMember.emailAccountId === callerMembership.emailAccountId) {
    throw new SafeError(memberManagementSelfActionMessages[action]);
  }

  if (targetMember.role === "owner") {
    if (action === "updateRole") {
      throw new SafeError("组织所有者无法被重新分配。");
    }

    if (callerMembership.role !== "owner") {
      throw new SafeError("只有所有者可以移除其他所有者。");
    }
  }

  return { targetMember, callerMembership };
}

type MemberManagementAction = "remove" | "updateRole";

const memberManagementUnauthorizedMessages: Record<
  MemberManagementAction,
  string
> = {
  remove: "只有组织所有者或管理员可以移除成员。",
  updateRole: "只有组织所有者或管理员可以更新成员角色。",
};

const memberManagementSelfActionMessages: Record<
  MemberManagementAction,
  string
> = {
  remove: "你不能将自己从组织中移除。",
  updateRole: "你不能更改自己的角色。",
};

function assertInvitationCanBeAccepted(invitation: {
  status: string;
  expiresAt: Date;
}) {
  if (invitation.status !== "pending") {
    throw new SafeError("此邀请不再有效。", 400);
  }

  if (invitation.expiresAt < new Date()) {
    throw new SafeError("此邀请已过期。请让你的组织管理员重新发送一份。", 400);
  }
}
