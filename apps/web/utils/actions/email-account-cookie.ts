"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import prisma from "@/utils/prisma";
import {
  LAST_EMAIL_ACCOUNT_COOKIE,
  type LastEmailAccountCookieValue,
} from "@/utils/cookies";
import { clearLastEmailAccountCookie } from "@/utils/cookies.server";
import { actionClientUser } from "@/utils/actions/safe-action";

/**
 * 设置一个记录最近所选邮箱账号 ID 的 cookie。
 * 当 URL 中未提供 emailAccountId 时使用。
 */
export const setLastEmailAccountAction = actionClientUser
  .metadata({ name: "setLastEmailAccount" })
  .inputSchema(z.object({ emailAccountId: z.string() }))
  .action(async ({ ctx: { userId }, parsedInput: { emailAccountId } }) => {
    const emailAccount = await prisma.emailAccount.findFirst({
      where: { id: emailAccountId, userId },
      select: { id: true },
    });
    if (!emailAccount) return;

    const cookieStore = await cookies();

    const cookieValue: LastEmailAccountCookieValue = {
      userId,
      emailAccountId: emailAccount.id,
    };
    const value = JSON.stringify(cookieValue);

    cookieStore.set(LAST_EMAIL_ACCOUNT_COOKIE, value, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 年
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  });

/**
 * 清除最近邮箱账号 cookie。
 * 在退出登录时调用，避免切换用户时残留旧账号 ID。
 */
export const clearLastEmailAccountAction = actionClientUser
  .metadata({ name: "clearLastEmailAccount" })
  .action(async () => {
    await clearLastEmailAccountCookie();
  });
