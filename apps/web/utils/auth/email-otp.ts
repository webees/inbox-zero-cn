import { createHash } from "node:crypto";
import { APIError } from "better-auth";
import { deleteSessionCookie } from "better-auth/cookies";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { after } from "next/server";
import { deliverTransactionalEmail } from "@inboxzero/transactional-email/src/delivery";
import { env } from "@/env";
import prisma from "@/utils/prisma";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("auth/email-otp");

export const emailOtpPlugin = emailOTP({
  disableSignUp: true,
  // VerificationToken.token 全局唯一；随机化加密可避免
  // 两个账号收到相同短验证码时的冲突。
  storeOTP: "encrypted",
  expiresIn: 300,
  allowedAttempts: 5,
  rateLimit: { window: 60, max: 5 },
  async sendVerificationOTP({ email, otp, type }) {
    if (type !== "sign-in") return;
    after(async () => {
      try {
        if (!(await isEmailOtpEnabled(email))) return;
        const result = await deliverTransactionalEmail({
          from: env.RESEND_FROM_EMAIL,
          to: email,
          subject: "你的 Inbox Zero 登录验证码",
          html: `<p>你的 Inbox Zero 登录验证码是 <strong>${otp}</strong>。</p><p>它将在 5 分钟后过期，并可访问你的整个 Inbox Zero 账号，包括所有已连接的邮箱和日历。</p><p>如果这不是你本人发起的请求，请忽略此邮件。</p>`,
          text: `你的 Inbox Zero 登录验证码是 ${otp}。\n\n此验证码将在 5 分钟后过期，且只能使用一次。它可访问你的整个 Inbox Zero 账号，包括所有已连接的邮箱和日历。\n\n如果这不是你本人发起的请求，请忽略此邮件。`,
        });
        if (!result) {
          logger.error("发送登录验证码失败");
        }
      } catch {
        // 服务商错误可能包含邮件正文及其登录验证码。
        logger.error("发送登录验证码失败");
      }
    });
  },
});

export const emailOtpBeforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/email-otp/send-verification-otp") {
    if (ctx.body?.type !== "sign-in") throw invalidCode();
    const email = normalizeEmail(ctx.body?.email);
    if (!(await isEmailOtpEnabled(email)) || !(await claimDelivery(email))) {
      return ctx.json({ success: true });
    }
    return;
  }
  if (ctx.path === "/sign-in/email-otp") {
    if (!(await isEmailOtpEnabled(normalizeEmail(ctx.body?.email)))) {
      throw invalidCode();
    }
    return;
  }
  // 该插件还会暴露密码重置和邮箱变更端点。此
  // 功能仅授权登录到已存在且显式启用的账号。
  if (
    ctx.path?.startsWith("/email-otp/") ||
    ctx.path === "/forget-password/email-otp"
  ) {
    throw invalidCode();
  }

  if (ctx.path === "/sign-out" || ctx.path === "/get-session") return;

  const current = await getSessionFromCtx(ctx);
  const session = current?.session as EmailOtpSession | undefined;
  if (!session?.emailOtp) return;
  await assertEmailOtpSession(session);
  throw new APIError("FORBIDDEN", {
    message: "请使用已连接的服务商登录以管理认证。",
  });
});

export async function emailOtpAfterHook(
  ctx: Parameters<typeof deleteSessionCookie>[0],
) {
  if (ctx.path !== "/get-session") return;
  const session = ctx.context.session?.session as EmailOtpSession | undefined;
  if (!session?.emailOtp) return;
  try {
    await assertEmailOtpSession(session);
  } catch (error) {
    if (!(error instanceof APIError) || error.statusCode !== 401) throw error;
    deleteSessionCookie(ctx);
    ctx.context.session = null;
    throw error;
  }
}

type EmailOtpSession = {
  id: string;
  userId: string;
  emailOtp?: boolean;
  emailOtpVersion?: number;
};

export async function emailOtpSessionCreationHook<T extends { userId: string }>(
  session: T,
  context?: { path?: string } | null,
) {
  if (context?.path !== "/sign-in/email-otp") return;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { emailOtpEnabled: true, emailOtpVersion: true },
  });
  if (!user?.emailOtpEnabled) throw invalidCode();
  return {
    data: { ...session, emailOtp: true, emailOtpVersion: user.emailOtpVersion },
  };
}

async function isEmailOtpEnabled(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailOtpEnabled: true },
  });
  return user?.emailOtpEnabled === true;
}

async function assertEmailOtpSession(session: EmailOtpSession) {
  const active = await prisma.session.findFirst({
    where: {
      id: session.id,
      userId: session.userId,
      emailOtp: true,
      expires: { gt: new Date() },
      user: {
        emailOtpEnabled: true,
        emailOtpVersion: session.emailOtpVersion ?? 0,
      },
    },
    select: { id: true },
  });
  if (!active)
    throw new APIError("UNAUTHORIZED", {
      message: "会话已过期。请重新登录。",
    });
}

async function claimDelivery(email: string) {
  const token = `email-otp-cooldown:${createHash("sha256").update(email).digest("hex")}`;
  await prisma.verificationToken.deleteMany({
    where: { token, expires: { lte: new Date() } },
  });
  try {
    await prisma.verificationToken.create({
      data: {
        token,
        identifier: "email-otp-cooldown",
        expires: new Date(Date.now() + 60_000),
      },
    });
    return true;
  } catch (error) {
    if (isDuplicateError(error)) return false;
    throw error;
  }
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function invalidCode() {
  return new APIError("BAD_REQUEST", {
    message: "登录验证码无效或已过期。",
  });
}
