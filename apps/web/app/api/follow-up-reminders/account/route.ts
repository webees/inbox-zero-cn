import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { hasPostCronSecret } from "@/utils/cron";
import { captureException } from "@/utils/error";
import { withError } from "@/utils/middleware";
import { processFollowUpRemindersForEmailAccountId } from "@/utils/follow-up/process";

export const maxDuration = 800;

const bodySchema = z.object({
  emailAccountId: z.string().min(1),
});

export const POST = withError(
  "follow-up-reminders/account",
  async (request) => {
    if (!(await hasPostCronSecret(request))) {
      captureException(
        new Error("未授权的 cron 请求：api/follow-up-reminders/account"),
      );
      return new Response("未授权", { status: 401 });
    }

    if (!env.NEXT_PUBLIC_FOLLOW_UP_REMINDERS_ENABLED) {
      request.logger.warn("跟进提醒功能已禁用");
      return NextResponse.json({ message: "跟进提醒已禁用" });
    }

    const parseResult = bodySchema.safeParse(await request.json());
    if (!parseResult.success) {
      request.logger.error("跟进提醒账号载荷无效", {
        errors: parseResult.error.issues,
      });
      return NextResponse.json(
        { error: "载荷无效", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { emailAccountId } = parseResult.data;
    const logger = request.logger.with({ emailAccountId });
    const result = await processFollowUpRemindersForEmailAccountId({
      emailAccountId,
      logger,
    });

    logger.info("已完成跟进提醒账号任务", {
      result,
    });

    return NextResponse.json({ result });
  },
);
