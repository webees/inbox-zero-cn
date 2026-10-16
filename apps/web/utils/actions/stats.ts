"use server";

import { actionClient } from "@/utils/actions/safe-action";
import { z } from "zod";
import { createEmailProvider } from "@/utils/email/provider";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { loadEmails } from "@/utils/actions/stats-loading";

export const loadEmailStatsAction = actionClient
  .metadata({ name: "loadEmailStats" })
  .inputSchema(z.object({ loadBefore: z.boolean() }))
  .action(
    async ({
      parsedInput: { loadBefore },
      ctx: { emailAccountId, logger },
    }) => {
      // 获取带服务商信息的邮箱账号
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          account: {
            select: { provider: true },
          },
        },
      });

      if (!emailAccount?.account?.provider) {
        throw new SafeError("未找到邮箱账号或服务商");
      }

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider: emailAccount.account.provider,
        logger,
      });

      await loadEmails(
        {
          emailAccountId,
          emailProvider,
          logger,
        },
        {
          loadBefore,
        },
      );
    },
  );
