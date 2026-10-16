import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { ensureEmailAccountsWatched } from "@/utils/email/watch-manager";

export const GET = withAuth("watch", async (request) => {
  const userId = request.auth.userId;
  const emailAccountCount = await prisma.emailAccount.count({
    where: { userId },
  });

  if (emailAccountCount === 0) {
    return NextResponse.json(
      { message: "未找到该用户的邮箱账号" },
      { status: 404 },
    );
  }

  const results = await ensureEmailAccountsWatched({
    userIds: [userId],
    logger: request.logger,
  });

  return NextResponse.json({ results });
});
