import { createHash } from "node:crypto";
import { EmailSendOperationStatus } from "@/generated/prisma/enums";
import { classifyEmailAccountProviderIssue } from "@/utils/email/provider-health";
import { isEmailProviderRateLimitError } from "@/utils/email/is-provider-rate-limit-error";
import type { EmailProvider } from "@/utils/email/types";
import { MAIL_MUTATION_RETRY_WINDOW_MS } from "@/utils/email/send-operation-policy";
import { SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { sendHtmlEmailWithOpenTracking } from "@/utils/email/sent-message-open/sent-message-open.server";
import type { DurableEmailSendBody } from "./durable-email-send.validation";

const PROCESSING_LEASE_MS = 2 * 60 * 1000;

export async function executeDurableEmailSend({
  emailAccountId,
  getEmailProvider,
  input,
  logger,
  provider,
}: {
  emailAccountId: string;
  getEmailProvider: () => Promise<EmailProvider>;
  // 计划发送的新邮件在服务商接受发送之前没有会话。
  input: Omit<DurableEmailSendBody, "threadId"> & { threadId: string | null };
  logger: Logger;
  provider: string;
}) {
  logger = logger.with({ mutationId: input.mutationId });
  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        threadId: input.threadId,
        messageIds: input.messageIds,
        email: input.email,
        queuedAt: input.queuedAt,
      }),
    )
    .digest("hex");
  const found = await findEmailSendOperation(emailAccountId, input.mutationId);
  if (!found && input.queuedAt < Date.now() - MAIL_MUTATION_RETRY_WINDOW_MS) {
    return {
      status: "rejected" as const,
      error: "排队的邮件过于陈旧，无法安全发送",
    };
  }
  const existing = found
    ? { ...found, created: false }
    : await createEmailSendOperation({
        emailAccountId,
        mutationId: input.mutationId,
        payloadHash,
      });
  if (existing.payloadHash !== payloadHash) {
    return { status: "rejected" as const, error: "变更 ID 已被重复使用" };
  }
  if (existing.status === EmailSendOperationStatus.SENT) {
    return { status: "already_applied" as const, result: existing.result };
  }
  if (existing.status === EmailSendOperationStatus.UNCERTAIN) {
    return { status: "uncertain" as const };
  }
  if (!existing.created) {
    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    const stale = await prisma.emailSendOperation.updateMany({
      where: {
        id: existing.id,
        status: EmailSendOperationStatus.PROCESSING,
        processingStartedAt: { lte: staleBefore },
      },
      data: { status: EmailSendOperationStatus.UNCERTAIN },
    });
    if (stale.count) logger.warn("邮件发送处理租约已过期");
    return stale.count
      ? { status: "uncertain" as const }
      : { status: "retry" as const };
  }

  let stage: "provider_setup" | "send" | "persist_result" = "provider_setup";
  try {
    const emailProvider = await getEmailProvider();
    stage = "send";
    const result = await sendHtmlEmailWithOpenTracking({
      emailAccountId,
      threadId: input.threadId,
      email: input.email,
      emailProvider,
      logger,
    });
    stage = "persist_result";
    await prisma.emailSendOperation.update({
      where: { id: existing.id },
      data: { result, status: EmailSendOperationStatus.SENT },
    });
    return { status: "applied" as const, result };
  } catch (error) {
    logger.error("邮件发送操作失败", { error, stage });
    if (
      stage !== "persist_result" &&
      isEmailProviderRateLimitError({ error, provider })
    ) {
      await prisma.emailSendOperation.deleteMany({
        where: { id: existing.id },
      });
      return { status: "retry" as const };
    }
    if (
      stage !== "persist_result" &&
      classifyEmailAccountProviderIssue({
        error,
        provider: provider as "google" | "microsoft",
      })
    ) {
      await prisma.emailSendOperation.deleteMany({
        where: { id: existing.id },
      });
      return { status: "blocked_auth" as const };
    }
    // 服务商会在任何内容发送之前运行的检查中抛出 SafeError，
    // 因此结果已知，且该操作可在之后重试。
    if (
      stage === "provider_setup" ||
      (stage === "send" && error instanceof SafeError)
    ) {
      await prisma.emailSendOperation.deleteMany({
        where: { id: existing.id },
      });
      return {
        status: "rejected" as const,
        error:
          error instanceof SafeError
            ? (error.safeMessage ?? error.message)
            : "无法准备邮箱账号。请重试。",
      };
    }
    await prisma.emailSendOperation.updateMany({
      where: { id: existing.id, status: EmailSendOperationStatus.PROCESSING },
      data: { status: EmailSendOperationStatus.UNCERTAIN },
    });
    return { status: "uncertain" as const };
  }
}

async function findEmailSendOperation(
  emailAccountId: string,
  mutationId: string,
) {
  return prisma.emailSendOperation.findUnique({
    where: {
      emailAccountId_clientMutationId: {
        emailAccountId,
        clientMutationId: mutationId,
      },
    },
  });
}

async function createEmailSendOperation({
  emailAccountId,
  mutationId,
  payloadHash,
}: {
  emailAccountId: string;
  mutationId: string;
  payloadHash: string;
}) {
  try {
    const operation = await prisma.emailSendOperation.create({
      data: {
        clientMutationId: mutationId,
        emailAccountId,
        payloadHash,
      },
    });
    return { ...operation, created: true };
  } catch (error) {
    if (!isDuplicateError(error, ["emailAccountId", "clientMutationId"])) {
      throw error;
    }
    const operation = await findEmailSendOperation(emailAccountId, mutationId);
    if (!operation) throw error;
    return { ...operation, created: false };
  }
}
