import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { createManagedOutlookSubscription } from "@/utils/outlook/subscription-manager";

export const GET = withAuth("outlook/watch", async (request) => {
  const userId = request.auth.userId;
  const results = [];

  const emailAccounts = await prisma.emailAccount.findMany({
    where: {
      userId,
      account: {
        provider: "microsoft",
      },
    },
    select: { id: true },
  });

  if (emailAccounts.length === 0) {
    return NextResponse.json(
      { message: "未找到该用户的 Microsoft 邮箱账号。" },
      { status: 404 },
    );
  }

  for (const { id: emailAccountId } of emailAccounts) {
    try {
      const account = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          account: {
            select: {
              access_token: true,
              refresh_token: true,
              expires_at: true,
            },
          },
        },
      });

      if (!account?.account.access_token || !account?.account.refresh_token) {
        request.logger.warn("账号缺少令牌", { emailAccountId });
        results.push({
          emailAccountId,
          status: "error",
          message: "缺少认证令牌。",
        });
        continue;
      }

      const result = await createManagedOutlookSubscription({
        emailAccountId,
        logger: request.logger,
      });

      if (result) {
        const { expirationDate } = result;
        results.push({
          emailAccountId,
          status: "success",
          expirationDate,
        });
      } else {
        request.logger.error("为账号监听收件箱时出错", {
          emailAccountId,
        });
        results.push({
          emailAccountId,
          status: "error",
          message: "无法为此账号设置监听。",
        });
      }
    } catch (error) {
      request.logger.error("监听账号收件箱时发生异常", {
        emailAccountId,
        error,
      });
      results.push({
        emailAccountId,
        status: "error",
        message: "为此账号设置监听时发生意外错误。",
        errorDetails: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ results });
});
