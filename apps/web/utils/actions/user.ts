"use server";

import { z } from "zod";
import { after } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/utils/prisma";
import { withThreadPageBufferDeletion } from "@/utils/redis/thread-page-buffer";
import { deleteUser } from "@/utils/user/delete";
import { stopWatchingEmailAccount } from "@/utils/email/watch-manager";
import { actionClient, actionClientUser } from "@/utils/actions/safe-action";
import { captureException, SafeError } from "@/utils/error";
import { updateAccountSeats } from "@/utils/premium/seats";
import { betterAuthConfig } from "@/utils/auth";
import { cookies, headers } from "next/headers";
import {
  LAST_EMAIL_ACCOUNT_COOKIE,
  parseLastEmailAccountCookieValue,
} from "@/utils/cookies";
import {
  saveAboutBody,
  saveSignatureBody,
  saveWritingStyleBody,
  updateAIDraftCleanupSettingsBody,
} from "@/utils/actions/user.validation";
import { clearLastEmailAccountCookie } from "@/utils/cookies.server";
import { deleteTinybirdEmailData } from "@inboxzero/tinybird";
import { aliasPosthogUser } from "@/utils/posthog";
import {
  cleanupAIDraftsForAccount,
  getConfiguredDraftCleanupDays,
} from "@/utils/ai/draft-cleanup";
import { isDuplicateError, isNotFoundError } from "@/utils/prisma-helpers";
import type { Logger } from "@/utils/logger";
import { prepareMemberRemovalNotifications } from "@/utils/team-comments/member-removal";
import {
  DELETE_ACCOUNT_REQUIRES_OWNER_TRANSFER_ERROR,
  DELETE_EMAIL_ACCOUNT_REQUIRES_OWNER_TRANSFER_ERROR,
  getDeletableOrganizationIdsOrThrow,
  getDeletedAccountOwnershipImpact,
  getDeleteSoloOrganizationsOperation,
  getUserDeletionOwnershipImpact,
  isMemberEmailAccountForeignKeyError,
  isOrganizationOwnerInvariantError,
} from "@/utils/organizations/ownership";

export const saveAboutAction = actionClient
  .metadata({ name: "saveAbout" })
  .inputSchema(saveAboutBody)
  .action(async ({ parsedInput: { about }, ctx: { emailAccountId } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { about },
    });
  });

export const saveSignatureAction = actionClient
  .metadata({ name: "saveSignature" })
  .inputSchema(saveSignatureBody)
  .action(async ({ parsedInput: { signature }, ctx: { emailAccountId } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { signature },
    });
  });

export const saveWritingStyleAction = actionClient
  .metadata({ name: "saveWritingStyle" })
  .inputSchema(saveWritingStyleBody)
  .action(
    async ({ parsedInput: { writingStyle }, ctx: { emailAccountId } }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { writingStyle },
      });
    },
  );

export const resetAnalyticsAction = actionClient
  .metadata({ name: "resetAnalytics" })
  .action(async ({ ctx: { emailAccountId } }) => {
    await prisma.emailMessage.deleteMany({
      where: { emailAccountId },
    });
  });

export const deleteAccountAction = actionClientUser
  .metadata({ name: "deleteAccount" })
  .action(async ({ ctx: { userId, logger } }) => {
    await assertUserAccountCanBeDeleted(userId);

    await clearLastEmailAccountCookie().catch((error) => {
      logger.error("清除上次邮箱账号 cookie 失败", { error });
    });

    await betterAuthConfig.api
      .signOut({
        headers: await headers(),
      })
      .catch((error) => {
        logger.error("退出登录失败", { error });
      });
    await deleteUser({ userId, logger });
  });

export const cleanupAIDraftsAction = actionClient
  .metadata({ name: "cleanupAIDrafts" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    const cleanupDays = await getConfiguredDraftCleanupDays(emailAccountId);
    return cleanupAIDraftsForAccount({
      emailAccountId,
      provider,
      logger,
      cleanupDays,
    });
  });

export const updateAIDraftCleanupSettingsAction = actionClient
  .metadata({ name: "updateAIDraftCleanupSettings" })
  .inputSchema(updateAIDraftCleanupSettingsBody)
  .action(async ({ parsedInput: { cleanupDays }, ctx: { emailAccountId } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { draftCleanupDays: cleanupDays },
    });

    return { cleanupDays };
  });

export const deleteEmailAccountAction = actionClientUser
  .metadata({ name: "deleteEmailAccount" })
  .inputSchema(z.object({ emailAccountId: z.string() }))
  .action(
    async ({
      ctx: { userId, userEmail, logger },
      parsedInput: { emailAccountId },
    }) => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId, userId },
        select: {
          email: true,
          accountId: true,
          watchEmailsSubscriptionId: true,
          account: { select: { provider: true } },
          user: { select: { email: true } },
        },
      });

      if (!emailAccount) throw new SafeError("未找到邮箱账号");
      if (!emailAccount.accountId) throw new SafeError("未找到账号 id");
      const organizationIdsToDelete =
        await assertEmailAccountCanBeDeleted(emailAccountId);
      const notifyConversations = await prepareMemberRemovalNotifications(
        { emailAccountId },
        logger,
      );

      const isPrimaryAccount = emailAccount.email === emailAccount.user.email;
      const deleteSoloOrganizationsOperation =
        getDeleteSoloOrganizationsOperation(organizationIdsToDelete, [
          emailAccountId,
        ]);
      const deleteRemainingMembershipsOperation = prisma.member.deleteMany({
        where: {
          emailAccountId,
          organizationId: { notIn: organizationIdsToDelete },
        },
      });

      if (isPrimaryAccount) {
        // 检查是否还有其他邮箱账号
        const otherEmailAccounts = await prisma.emailAccount.findMany({
          where: { userId, id: { not: emailAccountId } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
          },
        });

        if (otherEmailAccounts.length === 0) {
          throw new SafeError(
            "无法删除你唯一的邮箱账号。请前往设置页面删除整个账号。",
          );
        }

        // 将下一个邮箱账号提升为主账号
        const newPrimaryAccount = otherEmailAccounts[0];
        const oldEmail = emailAccount.user.email;

        await stopWatchingEmailAccount({
          emailAccountId,
          provider: emailAccount.account.provider,
          subscriptionId: emailAccount.watchEmailsSubscriptionId,
          logger,
        });

        await runDeleteEmailAccountTransaction(
          userId,
          [
            deleteSoloOrganizationsOperation,
            deleteRemainingMembershipsOperation,
            prisma.user.update({
              where: {
                id: userId,
                email: oldEmail,
                emailAccounts: { some: { id: newPrimaryAccount.id } },
              },
              data: {
                email: newPrimaryAccount.email,
                name: newPrimaryAccount.name,
                image: newPrimaryAccount.image,
              },
            }),
            prisma.emailAccount.delete({
              where: {
                id: emailAccountId,
                userId,
                accountId: emailAccount.accountId,
              },
            }),
            prisma.account.delete({
              where: { id: emailAccount.accountId, userId },
            }),
          ],
          { emailAccountId, logger, userEmail },
        );

        // 将旧的 PostHog 身份关联到新身份
        after(async () => {
          await aliasPosthogUser({
            oldEmail,
            newEmail: newPrimaryAccount.email,
          });
        });
      } else {
        await stopWatchingEmailAccount({
          emailAccountId,
          provider: emailAccount.account.provider,
          subscriptionId: emailAccount.watchEmailsSubscriptionId,
          logger,
        });

        await runDeleteEmailAccountTransaction(
          userId,
          [
            deleteSoloOrganizationsOperation,
            deleteRemainingMembershipsOperation,
            prisma.emailAccount.delete({
              where: {
                id: emailAccountId,
                userId,
                accountId: emailAccount.accountId,
                user: { email: emailAccount.user.email },
              },
            }),
            prisma.account.delete({
              where: { id: emailAccount.accountId, userId },
            }),
          ],
          { emailAccountId, logger, userEmail },
        );
      }

      after(() =>
        deleteTinybirdEmailData([emailAccount.email]).catch((error) => {
          logger.error("删除 Tinybird 数据时出错", { error });
          captureException(error);
        }),
      );

      await notifyConversations();

      await clearLastEmailAccountCookieIfMatching({
        userId,
        emailAccountId,
        logger,
      });

      after(async () => {
        await updateAccountSeats({ userId });
      });
    },
  );

async function runDeleteEmailAccountTransaction(
  userId: string,
  operations: Prisma.PrismaPromise<unknown>[],
  context: {
    emailAccountId: string;
    logger: Logger;
    userEmail?: string | null;
  },
) {
  try {
    await withThreadPageBufferDeletion([context.emailAccountId], () =>
      prisma.$transaction([
        prisma.$queryRaw`
        SELECT true AS locked
        FROM (
          SELECT pg_advisory_xact_lock(539114481, hashtext(${userId}))
        ) lock
      `,
        ...operations,
      ]),
    );
  } catch (error) {
    context.logger.error("删除邮箱账号事务失败", {
      error,
      emailAccountId: context.emailAccountId,
      prismaCode: getPrismaErrorCode(error),
      prismaMeta: getPrismaErrorMeta(error),
    });

    if (isNotFoundError(error)) {
      throw new SafeError("邮箱账号已更改");
    }

    if (isDuplicateError(error, "email")) {
      throw new SafeError(
        "由于该邮箱已被使用，我们无法将剩余的邮箱账号设为主账号。",
      );
    }

    if (
      isOrganizationOwnerInvariantError(error) ||
      isMemberEmailAccountForeignKeyError(error)
    ) {
      throw new SafeError(DELETE_EMAIL_ACCOUNT_REQUIRES_OWNER_TRANSFER_ERROR);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new SafeError(
        "由于仍存在关联数据，我们无法删除此邮箱账号。请联系支持。",
      );
    }

    captureException(error, {
      userId,
      userEmail: context.userEmail ?? undefined,
      emailAccountId: context.emailAccountId,
      extra: { action: "deleteEmailAccount" },
    });

    throw new SafeError(
      "我们无法删除此邮箱账号。如果问题持续出现，请联系支持。",
    );
  }
}

function getPrismaErrorCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : undefined;
}

function getPrismaErrorMeta(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.meta
    : undefined;
}

async function assertEmailAccountCanBeDeleted(emailAccountId: string) {
  const ownershipImpact = await getDeletedAccountOwnershipImpact([
    emailAccountId,
  ]);

  return getDeletableOrganizationIdsOrThrow(
    ownershipImpact,
    DELETE_EMAIL_ACCOUNT_REQUIRES_OWNER_TRANSFER_ERROR,
  );
}

async function clearLastEmailAccountCookieIfMatching({
  userId,
  emailAccountId,
  logger,
}: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  try {
    const cookieStore = await cookies();
    const lastEmailAccountId = parseLastEmailAccountCookieValue({
      userId,
      cookieValue: cookieStore.get(LAST_EMAIL_ACCOUNT_COOKIE)?.value,
    });
    if (lastEmailAccountId !== emailAccountId) return;
    await clearLastEmailAccountCookie();
  } catch (error) {
    logger.error("清除上次邮箱账号 cookie 失败", { error });
  }
}

async function assertUserAccountCanBeDeleted(userId: string) {
  const ownershipImpact = await getUserDeletionOwnershipImpact(userId);

  getDeletableOrganizationIdsOrThrow(
    ownershipImpact,
    DELETE_ACCOUNT_REQUIRES_OWNER_TRANSFER_ERROR,
  );
}
