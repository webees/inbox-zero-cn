import { z } from "zod";
import {
  AutomationJobRunStatus,
  MessagingRoutePurpose,
} from "@/generated/prisma/enums";
import { AutomationJobConfigurationError } from "@/utils/automation-jobs/slack";
import { isStaleAutomationJobRun } from "@/utils/automation-jobs/stale";
import { createEmailProvider } from "@/utils/email/provider";
import { getAutomationJobMessage } from "@/utils/automation-jobs/message";
import type { Logger } from "@/utils/logger";
import { isActivePremium } from "@/utils/premium";
import prisma from "@/utils/prisma";
import { getUserPremium } from "@/utils/user/get";
import { sendAutomationMessage } from "@/utils/automation-jobs/messaging";
import { getMessagingRoute } from "@/utils/messaging/routes";

export const executeAutomationJobBody = z.object({
  automationJobRunId: z.string().min(1, "自动化任务运行 ID 为必填项"),
});

export async function executeAutomationJobRun({
  automationJobRunId,
  logger,
}: {
  automationJobRunId: string;
  logger: Logger;
}) {
  const run = await prisma.automationJobRun.findUnique({
    where: { id: automationJobRunId },
    include: {
      automationJob: {
        include: {
          messagingChannel: {
            include: {
              routes: {
                select: {
                  purpose: true,
                  targetType: true,
                  targetId: true,
                },
              },
              emailAccount: {
                select: {
                  id: true,
                  userId: true,
                  email: true,
                  name: true,
                  about: true,
                  account: {
                    select: {
                      provider: true,
                    },
                  },
                  user: {
                    select: {
                      aiProvider: true,
                      aiModel: true,
                      aiApiKey: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!run) {
    logger.warn("未找到自动化任务运行记录", { automationJobRunId });
    return new Response("未找到自动化任务运行记录", { status: 404 });
  }

  const runLogger = logger.with({
    automationJobRunId,
    automationJobId: run.automationJobId,
    emailAccountId: run.automationJob.emailAccountId,
  });

  if (run.status === AutomationJobRunStatus.RUNNING) {
    runLogger.info("自动化任务运行已处于 RUNNING 状态", {
      createdAt: run.createdAt,
    });
    return new Response("运行当前正在执行", { status: 409 });
  }
  if (run.status !== AutomationJobRunStatus.PENDING) {
    runLogger.info("自动化任务运行已处理", {
      status: run.status,
    });
    return new Response("运行已处理", { status: 200 });
  }

  if (isStaleAutomationJobRun({ scheduledFor: run.scheduledFor })) {
    const skipped = await prisma.automationJobRun.updateMany({
      where: {
        id: automationJobRunId,
        status: AutomationJobRunStatus.PENDING,
      },
      data: {
        status: AutomationJobRunStatus.SKIPPED,
        processedAt: new Date(),
        error: "跳过了过期的自动化任务运行",
      },
    });

    if (skipped.count === 0) {
      runLogger.info("过期的自动化任务运行已被认领");
      return new Response("运行已被认领", { status: 409 });
    }

    runLogger.info("跳过了过期的自动化任务运行", {
      scheduledFor: run.scheduledFor,
      createdAt: run.createdAt,
    });
    return new Response("运行已跳过，因为运行已过期", { status: 200 });
  }

  const claimed = await prisma.automationJobRun.updateMany({
    where: {
      id: automationJobRunId,
      status: AutomationJobRunStatus.PENDING,
    },
    data: {
      status: AutomationJobRunStatus.RUNNING,
    },
  });

  if (claimed.count === 0) {
    runLogger.info("自动化任务运行已被另一个工作进程认领");
    return new Response("运行已被认领", { status: 409 });
  }

  try {
    if (!run.automationJob.enabled) {
      runLogger.info("跳过自动化任务运行，因为任务已禁用");
      await markAutomationJobRunSkipped({
        automationJobRunId,
        error: "自动化任务已禁用",
      });

      return new Response("自动化任务已禁用", { status: 200 });
    }

    const premium = await getUserPremium({
      userId: run.automationJob.messagingChannel.emailAccount.userId,
    });
    if (!isActivePremium(premium)) {
      runLogger.info("跳过自动化任务运行，因为所有者没有高级版");
      await markAutomationJobRunSkipped({
        automationJobRunId,
        error: "所有者不再拥有有效的高级版",
      });

      return new Response("所有者不再拥有有效的高级版", {
        status: 200,
      });
    }

    if (!run.automationJob.messagingChannel.isConnected) {
      runLogger.info("跳过自动化任务运行，因为消息渠道已断开");
      await markAutomationJobRunSkipped({
        automationJobRunId,
        error: "消息渠道未连接",
      });

      return new Response("消息渠道已断开", { status: 200 });
    }

    const route = getMessagingRoute(
      run.automationJob.messagingChannel.routes,
      MessagingRoutePurpose.SCHEDULED_CHECK_INS,
    );
    if (!route) {
      throw new AutomationJobConfigurationError("未配置定时签到目标");
    }

    const provider =
      run.automationJob.messagingChannel.emailAccount.account.provider;
    if (!provider) {
      throw new AutomationJobConfigurationError("邮箱服务商未连接");
    }

    const emailProvider = await createEmailProvider({
      emailAccountId: run.automationJob.emailAccountId,
      provider,
      logger: runLogger,
    });

    const outboundMessage = await getAutomationJobMessage({
      prompt: run.automationJob.prompt,
      emailProvider,
      emailAccount: run.automationJob.messagingChannel.emailAccount,
      logger: runLogger,
    });

    const messagingResult = await sendAutomationMessage({
      channel: run.automationJob.messagingChannel,
      route,
      text: outboundMessage,
      logger: runLogger,
    });

    await prisma.automationJobRun.update({
      where: { id: automationJobRunId },
      data: {
        status: AutomationJobRunStatus.SENT,
        processedAt: new Date(),
        outboundMessage,
        providerMessageId: messagingResult.messageId,
        error: null,
      },
    });

    return new Response("自动化任务已执行", { status: 200 });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "执行自动化任务失败";
    const isConfigurationError =
      error instanceof AutomationJobConfigurationError;

    runLogger.error("自动化任务执行失败", { error });

    await prisma.automationJobRun.update({
      where: { id: automationJobRunId },
      data: {
        status: isConfigurationError
          ? AutomationJobRunStatus.SKIPPED
          : AutomationJobRunStatus.FAILED,
        processedAt: new Date(),
        error: errorMessage,
      },
    });

    return new Response(
      isConfigurationError
        ? "自动化任务因配置问题被跳过"
        : "自动化任务执行失败",
      { status: isConfigurationError ? 200 : 500 },
    );
  }
}

async function markAutomationJobRunSkipped({
  automationJobRunId,
  error,
}: {
  automationJobRunId: string;
  error: string;
}) {
  await prisma.automationJobRun.update({
    where: { id: automationJobRunId },
    data: {
      status: AutomationJobRunStatus.SKIPPED,
      processedAt: new Date(),
      error,
    },
  });
}
