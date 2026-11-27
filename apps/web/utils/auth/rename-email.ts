import { APIError, type Account } from "better-auth";
import prisma from "@/utils/prisma";
import { isDuplicateError, isNotFoundError } from "@/utils/prisma-helpers";
import { assertAllowedAuthSignupEmail } from "@/utils/auth-signup-policy";
import { invalidateAccountValidation } from "@/utils/redis/account-validation";
import { fetchGoogleOpenIdProfile } from "@/utils/gmail/oauth";

// Gmail 推送通知仅通过邮箱当前地址来识别它，
// 因此改名的地址在存储的邮箱更新之前将无法匹配。
export async function syncGoogleEmailFromProfile({
  account,
  mailbox,
  userEmail,
  accessToken,
}: {
  account: Pick<Account, "id" | "userId" | "providerId" | "accountId">;
  mailbox: { id: string; email: string };
  userEmail: string;
  accessToken: string;
}) {
  const profile = await fetchGoogleOpenIdProfile(accessToken);
  return renameGoogleEmail({
    account,
    mailbox,
    userEmail,
    profile: {
      email: profile.email,
      sub: profile.sub,
      emailVerified: profile.email_verified,
      hostedDomain: profile.hd,
      name: profile.name,
      image: profile.picture ?? null,
    },
  });
}

export async function renameGoogleEmail({
  account,
  mailbox,
  userEmail,
  profile,
}: {
  account: Pick<Account, "id" | "userId" | "providerId" | "accountId">;
  mailbox: { id: string; email: string };
  userEmail: string;
  profile: {
    email: string;
    sub?: string;
    emailVerified?: boolean;
    hostedDomain?: string;
    name?: string | null;
    image?: string | null;
  };
}) {
  const email = profile.email.trim().toLowerCase();
  if (email === mailbox.email) return;

  // Google 对第三方邮箱地址并不具备权威性，即便
  // email_verified 为 true。Microsoft 资料邮箱也不能作为身份证明。
  if (
    account.providerId !== "google" ||
    profile.sub !== account.accountId ||
    profile.emailVerified !== true ||
    !(email.endsWith("@gmail.com") || profile.hostedDomain)
  ) {
    return;
  }
  assertAllowedAuthSignupEmail(email);

  const isPrimary = userEmail === mailbox.email;
  // 次要邮箱更新不会触及 User.email，因此其唯一
  // 约束无法捕获归属于其他用户的冲突登录。
  if (!isPrimary) {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser && existingUser.id !== account.userId) {
      throw APIError.from("BAD_REQUEST", {
        code: "email_already_linked",
        message: "email_already_linked",
      });
    }
  }

  try {
    await prisma.$transaction([
      prisma.emailAccount.update({
        where: {
          id: mailbox.id,
          email: mailbox.email,
          userId: account.userId,
          accountId: account.id,
          account: {
            userId: account.userId,
            provider: "google",
            providerAccountId: account.accountId,
          },
        },
        data: { email, name: profile.name, image: profile.image },
      }),
      prisma.account.update({
        where: {
          id: account.id,
          userId: account.userId,
          provider: "google",
          providerAccountId: account.accountId,
        },
        data: { disconnectedAt: null },
      }),
      ...(isPrimary
        ? [
            prisma.user.update({
              where: { id: account.userId, email: userEmail },
              data: { email, emailVerified: true },
            }),
          ]
        : []),
    ]);
  } catch (error) {
    if (isDuplicateError(error) || isNotFoundError(error)) {
      throw APIError.from("BAD_REQUEST", {
        code: "email_already_linked",
        message: "email_already_linked",
      });
    }
    throw error;
  }

  await invalidateAccountValidation({
    userId: account.userId,
    emailAccountId: mailbox.id,
  });
  return {
    id: mailbox.id,
    renamedUser: isPrimary ? { userId: account.userId, email } : undefined,
  };
}
