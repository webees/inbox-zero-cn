import { mcpOAuthPlugins } from "@/utils/mcp/oauth-provider";
import { INITIAL_MAIL_SPLITS } from "@/utils/split-inbox/initial-splits";
import { adminSso } from "@/utils/auth/sso";
import { scim } from "@better-auth/scim";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { oAuthProxy } from "better-auth/plugins";
import { createContact as createLoopsContact } from "@inboxzero/loops";
import { createContact as createResendContact } from "@inboxzero/transactional-email";
import type { Account } from "better-auth";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { renameGoogleEmail } from "@/utils/auth/rename-email";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { env } from "@/env";
import {
  assertAllowedAuthSignupEmail,
  isAllowedAuthSignupEmail,
} from "@/utils/auth-signup-policy";
import { trackDubSignUp } from "@/utils/dub";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { ensureEmailAccountsWatched } from "@/utils/email/watch-manager";
import { captureException } from "@/utils/error";
import { SCOPES as GMAIL_SCOPES } from "@/utils/gmail/scopes";
import {
  fetchGoogleOpenIdProfile,
  getGoogleOauthDiscoveryUrl,
  isGoogleOauthEmulationEnabled,
} from "@/utils/gmail/oauth";
import { createScopedLogger } from "@/utils/logger";
import {
  getMicrosoftOauthDiscoveryUrl,
  isMicrosoftEmulationEnabled,
} from "@/utils/outlook/oauth";
import { createOutlookClient } from "@/utils/outlook/client";
import { SCOPES as OUTLOOK_SCOPES } from "@/utils/outlook/scopes";
import {
  claimPendingPremiumInvite,
  updateAccountSeats,
} from "@/utils/premium/seats";
import { applyPendingPremiumGrant } from "@/utils/premium/server";
import { mobileAuthProviderCompletion } from "@/utils/mobile-auth/provider-completion";
import { safeExpo } from "@/utils/mobile-auth/expo";
import { clearAccountDisconnectedErrorIfResolved } from "@/utils/error-messages";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";
import { getAppleClientSecret } from "@/utils/auth/apple-client-secret";
import { reconcileMicrosoftAccountSubject } from "@/utils/auth/microsoft-account-subject";
import { getScimOptions, assertScimUserActive } from "@/utils/auth/scim";
import prisma from "@/utils/prisma";
import {
  getAuthProviderFromContext,
  isNewUserAuthContext,
  markAuthContextAsNewUser,
  trackAuthenticationCompleted,
} from "@/utils/analytics/auth-funnel.server";

import {
  emailOtpPlugin,
  emailOtpBeforeHook,
  emailOtpAfterHook,
  emailOtpSessionCreationHook,
} from "@/utils/auth/email-otp";

const logger = createScopedLogger("auth");
const renamedAuthUsers = new WeakMap<
  object,
  { userId: string; email: string }
>();
const EMAIL_ALREADY_LINKED_ERROR = "email_already_linked";
const useGoogleOauthEmulator = isGoogleOauthEmulationEnabled();
const useMicrosoftOauthEmulator = isMicrosoftEmulationEnabled();

// 仅注册已配置的 OAuth 服务商，避免客户端通过直接
// POST 到 `/api/auth/sign-in/social` 来启动已禁用的服务商。
const enabledLoginProviders = getEnabledLoginProviders();
const googleLoginEnabled = enabledLoginProviders.has("google");
const microsoftLoginEnabled = enabledLoginProviders.has("microsoft");
const appleLoginEnabled = enabledLoginProviders.has("apple");

type AppleProfile = {
  email?: string;
  sub: string;
};

type MicrosoftProfile = {
  oid?: unknown;
  sub?: unknown;
};

const mobileAuthOrigins = env.MOBILE_AUTH_ORIGIN
  ? [env.MOBILE_AUTH_ORIGIN]
  : [];
const desktopAuthOrigins = env.DESKTOP_AUTH_ORIGIN
  ? [env.DESKTOP_AUTH_ORIGIN]
  : [];
const googleSocialProvider =
  googleLoginEnabled && !useGoogleOauthEmulator
    ? {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: [...GMAIL_SCOPES],
        accessType: "offline" as const,
        prompt: "select_account consent" as const,
        disableIdTokenSignIn: true,
        // 对于预览部署，通过 staging 重定向（它会代理回预览 URL）
        ...(env.OAUTH_PROXY_URL && {
          redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/google`,
        }),
      }
    : null;
const microsoftSocialProvider =
  microsoftLoginEnabled && !useMicrosoftOauthEmulator
    ? {
        clientId: env.MICROSOFT_CLIENT_ID!,
        clientSecret: env.MICROSOFT_CLIENT_SECRET!,
        scope: [...OUTLOOK_SCOPES],
        tenantId: env.MICROSOFT_TENANT_ID,
        disableIdTokenSignIn: true,
        // 以内联 data URI 形式存放在用户行上；handleLinkAccount 已经持有它。
        disableProfilePhoto: true,
        // 这是 better-auth 查找账号之前唯一能看到解码后 id_token 的钩子，
        // 因此也是唯一同时知晓两个账号键的地方。
        mapProfileToUser: async (profile: MicrosoftProfile) => {
          await reconcileMicrosoftAccountSubject({
            oid: typeof profile.oid === "string" ? profile.oid : null,
            sub: typeof profile.sub === "string" ? profile.sub : null,
          });
          return {};
        },
        ...(env.OAUTH_PROXY_URL && {
          redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/microsoft`,
        }),
      }
    : null;
const appleSocialProvider = appleLoginEnabled
  ? {
      clientId: env.APPLE_CLIENT_ID!,
      get clientSecret() {
        const clientSecret = getAppleClientSecret();
        if (!clientSecret) throw new Error("Apple OAuth 未配置");
        return clientSecret;
      },
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
      mapProfileToUser: async (profile: AppleProfile) => {
        if (profile.email) return {};

        const existingAppleAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "apple",
              providerAccountId: profile.sub,
            },
          },
          select: {
            user: {
              select: {
                email: true,
              },
            },
          },
        });

        return existingAppleAccount?.user.email
          ? { email: existingAppleAccount.user.email }
          : {};
      },
      ...(env.OAUTH_PROXY_URL && {
        redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/apple`,
      }),
    }
  : null;
const genericOauthConfig: GenericOAuthConfig[] = [
  ...(googleLoginEnabled && useGoogleOauthEmulator
    ? [
        {
          providerId: "google",
          discoveryUrl: getGoogleOauthDiscoveryUrl(),
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          scopes: [...GMAIL_SCOPES],
          pkce: true,
          accessType: "offline" as const,
          prompt: "select_account consent" as const,
          ...(env.OAUTH_PROXY_URL && {
            redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/google`,
          }),
        },
      ]
    : []),
  ...(microsoftLoginEnabled && useMicrosoftOauthEmulator
    ? [
        {
          providerId: "microsoft",
          discoveryUrl: getMicrosoftOauthDiscoveryUrl(),
          clientId: env.MICROSOFT_CLIENT_ID!,
          clientSecret: env.MICROSOFT_CLIENT_SECRET!,
          scopes: [...OUTLOOK_SCOPES],
          pkce: true,
          prompt: "consent" as const,
          ...(env.OAUTH_PROXY_URL && {
            redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/microsoft`,
          }),
        },
      ]
    : []),
];
const genericOauthPlugin =
  genericOauthConfig.length > 0
    ? genericOAuth({
        config: genericOauthConfig,
      })
    : null;

const socialProviders = {
  ...(googleSocialProvider ? { google: googleSocialProvider } : {}),
  ...(microsoftSocialProvider ? { microsoft: microsoftSocialProvider } : {}),
  ...(appleSocialProvider ? { apple: appleSocialProvider } : {}),
};

export const betterAuthConfig = betterAuth({
  advanced: {
    database: {
      generateId: false,
    },
  },
  logger: {
    level: "info",
    log: (level, message, ...args) => {
      switch (level) {
        case "info":
          logger.info(message, { args });
          break;
        case "error":
          logger.error(message, { args });
          break;
      }
    },
  },
  baseURL: env.NEXT_PUBLIC_BASE_URL,
  disabledPaths: ["/token"],
  trustedOrigins: [
    env.NEXT_PUBLIC_BASE_URL,
    "https://appleid.apple.com",
    ...(env.OAUTH_PROXY_URL ? [env.OAUTH_PROXY_URL] : []),
    ...(env.ADDITIONAL_TRUSTED_ORIGINS ?? []),
    ...mobileAuthOrigins,
    ...desktopAuthOrigins,
  ],
  secret: env.AUTH_SECRET || env.NEXTAUTH_SECRET,
  emailAndPassword: {
    enabled: false,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  plugins: [
    emailOtpPlugin,
    adminSso({
      disableImplicitSignUp: false,
      organizationProvisioning: { disabled: true },
    }),
    ...(env.SCIM_CREDENTIAL_HASH_SECRET ? [scim(getScimOptions())] : []),
    ...(genericOauthPlugin ? [genericOauthPlugin] : []),
    ...(mobileAuthOrigins.length > 0 ? [safeExpo()] : []),
    // 用于预览部署的 OAuth 代理（Google 不允许通配符重定向 URI）
    ...(env.OAUTH_PROXY_URL || env.IS_OAUTH_PROXY_SERVER
      ? [
          oAuthProxy({
            productionURL: env.OAUTH_PROXY_URL || env.NEXT_PUBLIC_BASE_URL,
          }),
        ]
      : []),
    ...mcpOAuthPlugins(),
    nextCookies(), // 必须放在最后
  ],
  session: {
    additionalFields: {
      emailOtp: { type: "boolean", defaultValue: false, input: false },
      emailOtpVersion: { type: "number", defaultValue: 0, input: false },
    },
    modelName: "session",
    fields: {
      token: "sessionToken",
      expiresAt: "expires",
    },
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes — normal sign-out clears the cache cookie immediately;
      // 该 TTL 仅用于限制令牌被盗场景下的暴露时长
    },
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24 * 3, // 1 day (every 1 day the session expiration is updated)
  },
  account: {
    modelName: "account",
    fields: {
      accountId: "providerAccountId",
      providerId: "provider",
      refreshToken: "refresh_token",
      refreshTokenExpiresAt: "refreshTokenExpiresAt",
      accessToken: "access_token",
      accessTokenExpiresAt: "expires_at",
      idToken: "id_token",
    },
    storeStateStrategy: "cookie", // oAuthProxy 加密 state 所必需
    accountLinking: {
      enabled: true,
      // Microsoft Entra 的邮箱声明可能可变/未验证，因此在社交登录期间
      // Microsoft 不得按邮箱隐式关联用户。
      trustedProviders: ["google", "apple"],
    },
  },
  verification: {
    modelName: "verificationToken",
    fields: {
      value: "token",
      expiresAt: "expires",
    },
  },
  user: {
    additionalFields: {
      scimAccessDisabled: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  socialProviders,
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          await assertScimUserActive(session.userId);
          return emailOtpSessionCreationHook(session, context);
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedAuthSignupEmail(user.email)) {
            logger.warn("已阻止不在配置允许列表内的注册", {
              emailDomain: user.email.split("@")[1]?.toLowerCase(),
            });
            assertAllowedAuthSignupEmail(user.email);
          }

          return dropInlineImage(user);
        },
        after: async (user, context) => {
          markAuthContextAsNewUser(context?.context);
          await postSignUp({
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          }).catch((error) => {
            logger.error("提交注册失败", { error, user });
            captureException(error, { extra: { user } });
          });
        },
      },
      update: {
        before: async (user) => dropInlineImage(user),
      },
    },
    account: {
      create: {
        after: async (account: Account) => {
          await handleLinkAccount(account);
        },
      },
      update: {
        after: async (account: Account, context) => {
          const isGoogleCallback =
            !!(
              context?.path?.startsWith("/callback/") ||
              context?.path?.startsWith("/oauth2/callback/")
            ) && getAuthProviderFromContext(context) === "google";
          const renamedUser = await handleLinkAccount(
            account,
            isGoogleCallback,
          );
          if (renamedUser && context?.context)
            renamedAuthUsers.set(context.context, renamedUser);
        },
      },
    },
  },
  hooks: {
    before: emailOtpBeforeHook,
    after: createAuthMiddleware(async (context) => {
      const renamedUser = renamedAuthUsers.get(context.context);
      const newSession = context.context.newSession;
      if (renamedUser && newSession?.user.id === renamedUser.userId) {
        newSession.user.email = renamedUser.email;
        newSession.user.emailVerified = true;
        await setSessionCookie(context, newSession);
      }
      await emailOtpAfterHook(context);
      await mobileAuthProviderCompletion(context);
      try {
        const authenticatedSession = context.context.newSession;
        if (!authenticatedSession) return;

        const provider = getAuthProviderFromContext(context);
        if (provider === "unknown") return;

        const email = authenticatedSession.user.email;
        const isNewUser = isNewUserAuthContext(context.context);

        after(() =>
          trackAuthenticationCompleted({ email, provider, isNewUser }),
        );
      } catch (error) {
        logger.error("安排认证分析失败", { error });
      }
    }),
  },
  onAPIError: {
    throw: true,
    onError: (error: unknown) => {
      logger.error("认证 API 发生错误", { error });
    },
    errorURL: "/login/error",
  },
});

async function postSignUp({
  id: userId,
  email,
  name,
  image,
}: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}) {
  const loops = async () => {
    const account = await prisma.account
      .findFirst({
        where: { userId },
        select: { provider: true },
      })
      .catch((error) => {
        logger.error("查找账号失败", {
          userId,
          error,
        });
        captureException(error, { userEmail: email });
      });

    await createLoopsContact(
      email,
      name?.split(" ")?.[0],
      account?.provider,
    ).catch((error) => {
      const alreadyExists =
        error instanceof Error && error.message.includes("409");
      if (!alreadyExists) {
        logger.error("创建 Loops 联系人失败", {
          email,
          error,
        });
        captureException(error, { userEmail: email });
      }
    });
  };

  const resend = createResendContact({ email }).catch((error) => {
    logger.error("创建 Resend 联系人失败", {
      email,
      error,
    });
    captureException(error, { userEmail: email });
  });

  const dub = trackDubSignUp({ id: userId, email, name, image }, logger).catch(
    (error) => {
      logger.error("跟踪 Dub 注册失败", {
        email,
        error,
      });
      captureException(error, { userEmail: email });
    },
  );

  await Promise.all([
    loops(),
    resend,
    dub,
    // 按顺序执行，确保管理员授予落在邀请所分配的套餐上。
    handlePendingPremiumInvite({ email }).then(() =>
      applyPendingPremiumGrant({ userId, email }).catch((error) => {
        logger.error("应用待处理的高级版授予失败", { email, error });
        captureException(error, { userEmail: email });
      }),
    ),
    handleReferralOnSignUp({ userId, email }),
  ]);
}

async function handlePendingPremiumInvite({ email }: { email: string }) {
  try {
    logger.info("正在处理待处理的高级版邀请", { email });

    // 检查待处理的邀请
    const premium = await prisma.premium.findFirst({
      where: { pendingInvites: { has: email } },
      select: {
        id: true,
        lemonSqueezySubscriptionItemId: true,
        stripeSubscriptionId: true,
      },
    });

    if (
      premium?.lemonSqueezySubscriptionItemId ||
      premium?.stripeSubscriptionId
    ) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (user) {
        await claimPendingPremiumInvite({
          visitorId: user.id,
          premiumId: premium.id,
          email,
        });
        logger.info("已通过邀请将用户加入高级版", { email });
      }
    }
  } catch (error) {
    logger.error("处理待处理的高级版邀请失败", { error, email });
    captureException(error, {
      extra: { email, location: "handlePendingPremiumInvite" },
    });
  }
}

export async function handleReferralOnSignUp({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  try {
    const cookieStore = await cookies();
    const referralCookie = cookieStore.get("referral_code");

    if (!referralCookie?.value) {
      logger.info("cookie 中未找到推荐码", { email });
      return;
    }

    let referralCode = referralCookie.value;
    try {
      referralCode = decodeURIComponent(referralCode);
    } catch {
      // 如果解码失败，则使用原始值
    }
    logger.info("正在为新用户处理推荐", {
      email,
      referralCode,
    });

    // 导入 createReferral 函数
    const { createReferral } = await import("@/utils/referral/referral-code");
    await createReferral(userId, referralCode);
    logger.info("成功创建推荐", {
      email,
      referralCode,
    });
  } catch (error) {
    logger.error("注册时处理推荐失败", {
      error,
      userId,
      email,
    });
    // 不要抛出错误 - 推荐失败不应阻止注册
    captureException(error, {
      extra: { userId, email, location: "handleReferralOnSignUp" },
    });
  }
}

// TODO: 移入邮件服务商，而不是检查服务商类型
async function getProfileData(providerId: string, accessToken: string) {
  if (isGoogleProvider(providerId)) {
    const profile = await fetchGoogleOpenIdProfile(accessToken);
    return {
      email: profile.email.toLowerCase(),
      name: profile.name,
      image: profile.picture ?? null,
      sub: profile.sub,
      emailVerified: profile.email_verified,
      hostedDomain: profile.hd,
    };
  }

  if (isMicrosoftProvider(providerId)) {
    const client = createOutlookClient(accessToken, logger);
    try {
      const profileResponse = await client.getUserProfile();

      // 单独获取照片，因为它需要不同的端点
      let photoUrl = null;
      try {
        const photo = await client.getUserPhoto();
        if (photo) {
          photoUrl = photo;
        }
      } catch (error) {
        logger.info("用户没有头像照片", { error });
      }

      return {
        email:
          profileResponse.mail?.toLowerCase() ||
          profileResponse.userPrincipalName?.toLowerCase(),
        name: profileResponse.displayName,
        image: photoUrl,
      };
    } catch (error) {
      logger.error("获取 Microsoft 个人资料数据失败", { error });
      throw error;
    }
  }
}

function shouldLinkEmailAccount(providerId: string) {
  return isGoogleProvider(providerId) || isMicrosoftProvider(providerId);
}

export async function handleLinkAccount(
  account: Account,
  allowEmailRename = false,
) {
  let primaryEmail: string | null | undefined;
  let primaryName: string | null | undefined;
  let primaryPhotoUrl: string | null | undefined;

  try {
    if (!shouldLinkEmailAccount(account.providerId)) {
      logger.info("[linkAccount] 跳过邮箱账号关联", {
        userId: account.userId,
        accountId: account.id,
      });
      return;
    }

    if (!account.accessToken) {
      logger.error(
        "[linkAccount] 数据中未找到 access_token，无法获取个人资料。",
      );
      throw new Error("账号关联期间缺少访问令牌。");
    }
    const profileData = await getProfileData(
      account.providerId,
      account.accessToken,
    );

    if (!profileData?.email) {
      logger.error("[handleLinkAccount] 个人资料数据中未找到邮箱");
    }

    primaryEmail = profileData?.email;
    primaryName = profileData?.name;
    primaryPhotoUrl = profileData?.image;

    if (!primaryEmail) {
      logger.error("[linkAccount] 无法从个人资料确定主邮箱。");
      throw new Error("未找到关联账号的主邮箱。");
    }

    const normalizedEmail = primaryEmail.trim().toLowerCase();

    // 个人资料中的邮箱可能变化，而服务商账号保持不变。
    const linkedEmailAccount = await prisma.emailAccount.findUnique({
      where: { accountId: account.id },
      select: {
        id: true,
        email: true,
        userId: true,
        accountId: true,
        account: { select: { provider: true } },
      },
    });
    const existingEmailAccount =
      linkedEmailAccount ??
      (await prisma.emailAccount.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          userId: true,
          accountId: true,
          account: { select: { provider: true } },
        },
      }));

    if (
      existingEmailAccount &&
      existingEmailAccount.userId !== account.userId
    ) {
      logger.error("[linkAccount] 邮箱已关联到其他用户", {
        email: primaryEmail,
        existingUserId: existingEmailAccount.userId,
        newUserId: account.userId,
      });
      throw APIError.from("BAD_REQUEST", {
        message: EMAIL_ALREADY_LINKED_ERROR,
        code: EMAIL_ALREADY_LINKED_ERROR,
      });
    }

    const crossProviderRelink =
      existingEmailAccount &&
      existingEmailAccount.userId === account.userId &&
      existingEmailAccount.accountId !== account.id &&
      existingEmailAccount.account.provider !== account.providerId;

    if (crossProviderRelink) {
      logger.warn("[linkAccount] 跳过跨服务商重新分配 EmailAccount", {
        userId: account.userId,
        accountId: account.id,
        currentProvider: existingEmailAccount.account.provider,
        attemptedProvider: account.providerId,
      });

      await prisma.$transaction([
        prisma.emailAccount.update({
          where: { id: existingEmailAccount.id },
          data: {
            name: primaryName,
            image: primaryPhotoUrl,
          },
        }),
        prisma.account.update({
          where: { id: account.id },
          data: { disconnectedAt: null },
        }),
      ]);

      await clearAccountDisconnectedErrorIfResolved({
        userId: account.userId,
        logger,
      });

      scheduleEmailWatchesAfterLink(account.userId);
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: account.userId },
      select: { email: true, name: true, image: true },
    });

    if (!user?.email) {
      logger.error("[linkAccount] 未找到用户邮箱", {
        userId: account.userId,
      });
      return;
    }

    const renamedMailbox =
      allowEmailRename && linkedEmailAccount && profileData
        ? await renameGoogleEmail({
            account,
            mailbox: linkedEmailAccount,
            userEmail: user.email,
            profile: { ...profileData, email: normalizedEmail },
          })
        : undefined;

    const data = {
      userId: account.userId,
      accountId: account.id,
      name: primaryName,
      image: primaryPhotoUrl,
    };

    const upsertedEmailAccount =
      renamedMailbox ??
      (
        await prisma.$transaction([
          linkedEmailAccount
            ? prisma.emailAccount.update({
                where: {
                  id: linkedEmailAccount.id,
                  userId: account.userId,
                  accountId: account.id,
                  account: {
                    userId: account.userId,
                    provider: account.providerId,
                    providerAccountId: account.accountId,
                  },
                },
                data: { name: primaryName, image: primaryPhotoUrl },
                select: { id: true },
              })
            : prisma.emailAccount.upsert({
                where: { email: normalizedEmail },
                update: data,
                create: {
                  ...data,
                  email: normalizedEmail,
                  mailSplits: {
                    create: INITIAL_MAIL_SPLITS.map((split, order) => ({
                      ...split,
                      order,
                    })),
                  },
                },
                select: { id: true },
              }),
          prisma.account.update({
            where: {
              id: account.id,
              userId: account.userId,
              providerAccountId: account.accountId,
            },
            data: { disconnectedAt: null },
          }),
        ])
      )[0];

    await clearAccountDisconnectedErrorIfResolved({
      userId: account.userId,
      logger,
    });

    if (env.AUTO_JOIN_ORGANIZATION_ENABLED) {
      await autoJoinOrganization(upsertedEmailAccount.id).catch((error) => {
        logger.error("[linkAccount] 自动加入组织失败", {
          error,
        });
        captureException(error, { extra: { userId: account.userId } });
      });
    }

    // 处理高级版账号席位
    await updateAccountSeats({ userId: account.userId }).catch((error) => {
      logger.error("[linkAccount] 更新高级版账号席位失败：", {
        userId: account.userId,
        error,
      });
      captureException(error, { extra: { userId: account.userId } });
    });

    scheduleEmailWatchesAfterLink(account.userId);

    logger.info("[linkAccount] 成功关联账号", {
      email: user.email,
      userId: account.userId,
      accountId: account.id,
    });
    return renamedMailbox?.renamedUser;
  } catch (error) {
    logger.error("[linkAccount] 关联过程中出错：", {
      userId: account.userId,
      error,
    });
    captureException(error, {
      extra: { userId: account.userId, location: "linkAccount" },
    });
    throw error;
  }
}

export const auth = async (
  requestHeaders?: Headers | Awaited<ReturnType<typeof headers>>,
) => {
  try {
    return await betterAuthConfig.api.getSession({
      headers: requestHeaders ?? (await headers()),
    });
  } catch (error) {
    if (error instanceof APIError && error.statusCode === 401) return null;
    throw error;
  }
};

async function autoJoinOrganization(emailAccountId: string) {
  const orgs = await prisma.organization.findMany({
    select: { id: true },
    take: 2,
  });

  if (orgs.length !== 1) {
    if (orgs.length === 0) {
      logger.warn("[autoJoinOrganization] 未找到可自动加入的组织");
    } else {
      logger.warn("[autoJoinOrganization] 找到多个组织，跳过自动加入");
    }
    return;
  }

  const organizationId = orgs[0].id;

  const member = await prisma.member.upsert({
    where: { emailAccountId },
    update: {},
    create: {
      organizationId,
      emailAccountId,
      role: "member",
      allowOrgAdminAnalytics: env.AUTO_ENABLE_ORG_ANALYTICS,
    },
    select: { id: true, createdAt: true },
  });

  logger.info("[autoJoinOrganization] 已自动将用户加入组织", {
    emailAccountId,
    organizationId,
    memberId: member.id,
  });
}

function scheduleEmailWatchesAfterLink(userId: string) {
  after(() =>
    ensureEmailAccountsWatched({
      userIds: [userId],
      logger,
    }).catch((error) => {
      logger.error("[linkAccount] 重新注册邮件监听失败", {
        userId,
        error,
      });
      captureException(error, {
        extra: { userId, location: "linkAccountWatch" },
      });
    }),
  );
}

// Better Auth 会在会话 cookie 内重放用户行，因此内联照片
// 会使请求头超出边缘限制并导致账号被锁定。
function dropInlineImage(user: { image?: string | null }) {
  if (typeof user.image !== "string" || !/^data:/i.test(user.image)) return;
  return { data: { image: null } };
}
