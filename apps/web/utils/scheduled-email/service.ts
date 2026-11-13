import { createHash } from "node:crypto";
import { mapWithConcurrency } from "@/utils/async";
import type { z } from "zod";
import type { ScheduledEmail } from "@/generated/prisma/client";
import prisma from "@/utils/prisma";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { SafeError } from "@/utils/error";
import { scheduleEmailBody } from "@/utils/actions/scheduled-email.validation";
import { executeDurableEmailSend } from "@/utils/email/durable-email-send";
import { createEmailProvider } from "@/utils/email/provider";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { isSameEmailAddress } from "@/utils/email";
import { getMessageTimestamp } from "@/utils/email/message-timestamp";
import { publishToQstashAt } from "@/utils/upstash";

const LEASE_MS = 5 * 60 * 1000;
const HELD_EMAIL_EXECUTE_PATH = "/api/scheduled-emails/execute";

export async function scheduleEmail(
  emailAccountId: string,
  input: z.infer<typeof scheduleEmailBody>,
  now = new Date(),
) {
  const payloadHash = hashPayload(input);
  const existing = await findScheduledEmail(
    emailAccountId,
    input.clientMutationId,
  );
  if (existing) {
    assertReusableRequest(existing, payloadHash);
    return existing;
  }
  const sendAt = input.sendAt ? new Date(input.sendAt) : now;
  const remindAt = input.remindAt ? new Date(input.remindAt) : null;
  if (input.sendAt && sendAt <= now)
    throw new SafeError("请选择未来的发送时间。");
  if (remindAt && remindAt <= sendAt)
    throw new SafeError("提醒时间必须晚于发送时间。");
  if (
    input.email.replyToEmail &&
    input.email.replyToEmail.threadId !== input.threadId
  )
    throw new SafeError("该回复属于另一个会话。");
  try {
    return await prisma.scheduledEmail.create({
      data: {
        emailAccountId,
        clientMutationId: input.clientMutationId,
        payloadHash,
        payload: input,
        draftMessageIds: input.draftMessageIds ?? [],
        threadId: input.threadId,
        sendAt,
        remindAt,
        reminderStatus: remindAt ? "PENDING" : "NONE",
      },
    });
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
    const duplicate = await prisma.scheduledEmail.findUniqueOrThrow({
      where: {
        emailAccountId_clientMutationId: {
          emailAccountId,
          clientMutationId: input.clientMutationId,
        },
      },
    });
    assertReusableRequest(duplicate, payloadHash);
    return duplicate;
  }
}

/**
 * 在服务器上保留刚发送的邮件以度过其撤销窗口，因此即使
 * 发送它的客户端离开，它仍会发出。重复调用返回同一个保留项。
 */
export async function holdEmailForUndo({
  emailAccountId,
  input,
  sendAt,
  logger,
}: {
  emailAccountId: string;
  input: z.infer<typeof scheduleEmailBody>;
  sendAt: Date;
  logger: Logger;
}) {
  const existing = await findScheduledEmail(
    emailAccountId,
    input.clientMutationId,
  );
  if (existing) {
    if (existing.status !== "CANCELLED")
      assertReusableRequest(existing, hashPayload(input));
    return existing;
  }
  let row: ScheduledEmail;
  try {
    row = await prisma.scheduledEmail.create({
      data: {
        emailAccountId,
        clientMutationId: input.clientMutationId,
        payloadHash: hashPayload(input),
        payload: input,
        threadId: input.threadId,
        sendAt,
        heldForUndo: true,
      },
    });
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
    const duplicate = await prisma.scheduledEmail.findUniqueOrThrow({
      where: {
        emailAccountId_clientMutationId: {
          emailAccountId,
          clientMutationId: input.clientMutationId,
        },
      },
    });
    if (duplicate.status !== "CANCELLED")
      assertReusableRequest(duplicate, hashPayload(input));
    return duplicate;
  }
  if (row.status === "CANCELLED") return row;
  try {
    await publishToQstashAt({
      path: HELD_EMAIL_EXECUTE_PATH,
      body: { scheduledEmailId: row.id },
      notBefore: row.sendAt,
      deduplicationId: `held-email-${row.id}`,
    });
  } catch (error) {
    logger.error("Could not schedule held email delivery; cron will send it", {
      error,
      scheduledEmailId: row.id,
    });
  }
  return row;
}

/** 在保留邮件的撤销窗口结束后发送该邮件。 */
export async function releaseHeldEmail(
  row: ScheduledEmail,
  logger: Logger,
  now = new Date(),
) {
  // 用户计划发送的邮件保留自己的时间和显式重试。
  if (!row.heldForUndo) return row;
  if (row.status === "BLOCKED_AUTH") {
    // 客户端再次发起请求，因此账号此时可能已重新连接。
    await prisma.scheduledEmail.updateMany({
      where: { id: row.id, status: "BLOCKED_AUTH" },
      data: {
        status: "PENDING",
        sendAt: now,
        processingStartedAt: null,
        error: null,
      },
    });
  } else if (row.status !== "PENDING" || row.sendAt > now) {
    return row;
  }
  await processScheduledEmail(row.id, logger, now);
  return prisma.scheduledEmail.findUniqueOrThrow({ where: { id: row.id } });
}

/**
 * 停止保留的邮件，除非它已开始发送。撤销可能先于发送
 * 到达服务器，因此未知邮件会被记录为已取消，
 * 之后不再被保留。
 */
export async function cancelHeldEmail(
  emailAccountId: string,
  clientMutationId: string,
): Promise<"cancelled" | "too_late"> {
  const cancelled = await prisma.scheduledEmail.updateMany({
    where: {
      emailAccountId,
      clientMutationId,
      heldForUndo: true,
      status: { in: ["PENDING", "BLOCKED_AUTH"] },
    },
    data: { status: "CANCELLED", error: null, payload: {} },
  });
  if (cancelled.count) return "cancelled";
  const existing = await findScheduledEmail(emailAccountId, clientMutationId);
  if (existing) {
    return existing.heldForUndo && existing.status === "CANCELLED"
      ? "cancelled"
      : "too_late";
  }
  try {
    await prisma.scheduledEmail.create({
      data: {
        emailAccountId,
        clientMutationId,
        payloadHash: "",
        payload: {},
        threadId: null,
        sendAt: new Date(),
        status: "CANCELLED",
        heldForUndo: true,
      },
    });
    return "cancelled";
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
    return cancelHeldEmail(emailAccountId, clientMutationId);
  }
}

export function findScheduledEmail(
  emailAccountId: string,
  clientMutationId: string,
) {
  return prisma.scheduledEmail.findUnique({
    where: {
      emailAccountId_clientMutationId: { emailAccountId, clientMutationId },
    },
  });
}

export async function cancelScheduledEmail(emailAccountId: string, id: string) {
  const result = await prisma.scheduledEmail.updateMany({
    where: {
      id,
      emailAccountId,
      status: { in: ["PENDING", "BLOCKED_AUTH", "FAILED"] },
    },
    data: { status: "CANCELLED", reminderStatus: "CANCELLED", error: null },
  });
  if (result.count) return;
  const existing = await prisma.scheduledEmail.findUnique({
    where: { id, emailAccountId },
    select: { status: true },
  });
  if (existing?.status !== "CANCELLED")
    throw new SafeError("此邮件已开始发送，或不再处于计划发送状态。");
}

export async function cancelEmailReminder(emailAccountId: string, id: string) {
  const result = await prisma.scheduledEmail.updateMany({
    where: { id, emailAccountId, reminderStatus: "PENDING" },
    data: { reminderStatus: "CANCELLED" },
  });
  if (!result.count)
    throw new SafeError("此提醒已开始，或不再处于待处理状态。");
}

export async function retryScheduledEmail(
  emailAccountId: string,
  id: string,
  now = new Date(),
) {
  const row = await prisma.scheduledEmail.findUnique({
    where: { id, emailAccountId },
  });
  if (!row || (row.status !== "FAILED" && row.status !== "BLOCKED_AUTH"))
    throw new SafeError("无法安全地重试此邮件。");
  const operation = await prisma.emailSendOperation.findUnique({
    where: {
      emailAccountId_clientMutationId: {
        emailAccountId,
        clientMutationId: row.clientMutationId,
      },
    },
    select: { id: true },
  });
  if (operation)
    throw new SafeError("无法安全地重试此邮件。发送前请检查「已发送」。");
  const result = await prisma.scheduledEmail.updateMany({
    where: { id, emailAccountId, updatedAt: row.updatedAt, status: row.status },
    data: {
      status: "PENDING",
      sendAt: now,
      executionQueuedAt: null,
      processingStartedAt: null,
      error: null,
    },
  });
  if (!result.count) throw new SafeError("无法安全地重试此邮件。");
}

export async function processScheduledEmail(
  id: string,
  logger: Logger,
  now = new Date(),
) {
  const row = await prisma.scheduledEmail.findUnique({ where: { id } });
  if (!row || row.sendAt > now) return;
  const claim = await prisma.scheduledEmail.updateMany({
    where: {
      id,
      updatedAt: row.updatedAt,
      OR: [
        { status: "PENDING" },
        {
          status: "PROCESSING",
          processingStartedAt: { lte: new Date(now.getTime() - LEASE_MS) },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      processingStartedAt: now,
      executionQueuedAt: row.executionQueuedAt ?? now,
    },
  });
  if (!claim.count) return;
  const claimedWhere = {
    id,
    status: "PROCESSING" as const,
    processingStartedAt: now,
  };
  try {
    const input = scheduleEmailBody.parse(row.payload);
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: row.emailAccountId },
      include: { account: true },
    });
    const outcome = await executeDurableEmailSend({
      logger,
      emailAccountId: row.emailAccountId,
      provider: account.account.provider,
      getEmailProvider: () =>
        createEmailProvider({
          emailAccountId: row.emailAccountId,
          provider: account.account.provider,
          logger,
        }),
      input: {
        mutationId: row.clientMutationId,
        threadId: row.threadId,
        messageIds: input.messageIds,
        email: input.email,
        queuedAt: (row.executionQueuedAt ?? now).getTime(),
      },
    });
    if (outcome.status === "applied" || outcome.status === "already_applied") {
      const sentOperation = await prisma.emailSendOperation.findUniqueOrThrow({
        where: {
          emailAccountId_clientMutationId: {
            emailAccountId: row.emailAccountId,
            clientMutationId: row.clientMutationId,
          },
        },
        select: { processingStartedAt: true },
      });
      await prisma.scheduledEmail.updateMany({
        where: claimedWhere,
        data: {
          status: "SENT",
          sentAt: sentOperation.processingStartedAt,
          // 提醒需要发送实际落入的会话。
          threadId: row.threadId ?? getSentThreadId(outcome.result),
          error: null,
          // 没有任何地方会列出已发送的撤销保留项，因此其正文和文件可以释放。
          ...(row.heldForUndo ? { payload: {} } : {}),
        },
      });
    } else if (outcome.status === "retry") {
      const operation = await prisma.emailSendOperation.findUnique({
        where: {
          emailAccountId_clientMutationId: {
            emailAccountId: row.emailAccountId,
            clientMutationId: row.clientMutationId,
          },
        },
        select: { id: true },
      });
      // 持久化工作进程可能仍在发送。只有不存在的操作才被确认为未发送。
      if (operation) return;
      await prisma.scheduledEmail.updateMany({
        where: claimedWhere,
        data: {
          status: "PENDING",
          sendAt: new Date(now.getTime() + 60_000),
          error: "Delivery delayed. Retrying shortly.",
        },
      });
    } else {
      await prisma.scheduledEmail.updateMany({
        where: claimedWhere,
        data: {
          status:
            outcome.status === "blocked_auth"
              ? "BLOCKED_AUTH"
              : outcome.status === "uncertain"
                ? "UNCERTAIN"
                : "FAILED",
          error:
            outcome.status === "blocked_auth"
              ? "请重新连接邮箱账号以发送此回复。"
              : outcome.status === "uncertain"
                ? "此邮件可能已发送。发送前请检查「已发送」。"
                : outcome.error,
        },
      });
    }
  } catch (error) {
    // 保留租约：持久化操作可能在数据库故障之前已经发送。
    // 后续的 cron 会对同一个不可变操作进行核对，而绝不会是新的发送。
    logger.error("计划邮件执行失败", {
      error,
      scheduledEmailId: id,
    });
  }
}

export function hasReplySince(
  messages: Awaited<ReturnType<EmailProvider["getThreadMessages"]>>,
  ownerEmail: string,
  sentAt: Date,
) {
  return messages.some(
    (message) =>
      !message.labelIds?.includes("DRAFT") &&
      !message.labelIds?.includes("SENT") &&
      !isSameEmailAddress(message.headers.from, ownerEmail) &&
      getMessageTimestamp({
        ...message,
        date: message.date || message.headers.date,
      }) > sentAt.getTime(),
  );
}

async function processReminder(row: ScheduledEmail, logger: Logger, now: Date) {
  if (!row.sentAt) return;
  const claim = await prisma.scheduledEmail.updateMany({
    where: {
      id: row.id,
      status: "SENT",
      OR: [
        { reminderStatus: "PENDING" },
        {
          reminderStatus: "PROCESSING",
          reminderStartedAt: { lte: new Date(now.getTime() - LEASE_MS) },
        },
      ],
    },
    data: { reminderStatus: "PROCESSING", reminderStartedAt: now },
  });
  if (!claim.count) return;
  const where = {
    id: row.id,
    reminderStatus: "PROCESSING" as const,
    reminderStartedAt: now,
  };
  try {
    if (!row.threadId) {
      await prisma.scheduledEmail.updateMany({
        where,
        data: { reminderStatus: "COMPLETED" },
      });
      return;
    }
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: row.emailAccountId },
      include: { account: true },
    });
    const provider = await createEmailProvider({
      emailAccountId: row.emailAccountId,
      provider: account.account.provider,
      logger,
    });
    const messages = await provider.getThreadMessages(row.threadId);
    if (!hasReplySince(messages, account.email, row.sentAt))
      await provider.unarchiveThread(row.threadId);
    await prisma.scheduledEmail.updateMany({
      where,
      data: { reminderStatus: "COMPLETED" },
    });
  } catch (error) {
    logger.error("邮件提醒失败", { error, scheduledEmailId: row.id });
    // 保留租约以避免密集重试，并在下一次过期扫描时恢复。
  }
}

export async function processDueScheduledEmails(
  logger: Logger,
  now = new Date(),
) {
  const stale = new Date(now.getTime() - LEASE_MS);
  const rows = await prisma.scheduledEmail.findMany({
    where: {
      OR: [
        { status: "PENDING", sendAt: { lte: now } },
        { status: "PROCESSING", processingStartedAt: { lte: stale } },
        { status: "SENT", remindAt: { lte: now }, reminderStatus: "PENDING" },
        {
          status: "SENT",
          remindAt: { lte: now },
          reminderStatus: "PROCESSING",
          reminderStartedAt: { lte: stale },
        },
      ],
    },
    orderBy: { sendAt: "asc" },
    take: 100,
  });
  await mapWithConcurrency(rows, 5, async (row) => {
    const scopedLogger = logger.with({
      emailAccountId: row.emailAccountId,
      scheduledEmailId: row.id,
    });
    try {
      if (row.status === "SENT") await processReminder(row, scopedLogger, now);
      else await processScheduledEmail(row.id, scopedLogger, now);
    } catch (error) {
      scopedLogger.error("处理计划邮件失败", { error });
    }
  });
  return { processed: rows.length };
}

function getSentThreadId(result: unknown) {
  if (result && typeof result === "object" && "threadId" in result) {
    const { threadId } = result as { threadId?: unknown };
    if (typeof threadId === "string" && threadId) return threadId;
  }
  return null;
}

function hashPayload(input: z.infer<typeof scheduleEmailBody>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function assertReusableRequest(
  row: Pick<ScheduledEmail, "payloadHash" | "status">,
  payloadHash: string,
) {
  if (row.payloadHash !== payloadHash)
    throw new SafeError("此发送请求已用于另一封邮件。");
  if (row.status === "CANCELLED")
    throw new SafeError("此计划回复已取消。请新建回复以发送此消息。");
}
