import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { unwatchEmails } from "@/utils/email/watch-manager";

export const POST = withEmailProvider(async (request) => {
  const logger = request.logger;
  const emailAccountId = request.auth.emailAccountId;

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { watchEmailsSubscriptionId: true },
  });

  try {
    await unwatchEmails({
      emailAccountId,
      provider: request.emailProvider,
      subscriptionId: emailAccount?.watchEmailsSubscriptionId,
      logger,
    });

    return NextResponse.json({
      status: "success",
      message: "已成功取消监听此账号的邮件。",
    });
  } catch (error) {
    logger.error("取消监听邮箱时发生异常", { error });
    return NextResponse.json(
      {
        status: "error",
        message: "取消监听此账号时发生意外错误。",
        errorDetails: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});
