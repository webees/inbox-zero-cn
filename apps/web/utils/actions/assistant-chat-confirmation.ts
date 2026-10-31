import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import { getFormattedSenderAddress } from "@/utils/email/get-formatted-sender-address";
import { forwardMessage } from "@/utils/email/forward-message";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { sleep } from "@/utils/sleep";
import { convertNewlinesToBr, escapeHtml, truncate } from "@/utils/string";
import { isDuplicateError } from "@/utils/prisma-helpers";
import {
  type AssistantEmailConfirmationResult,
  type AssistantPendingEmailActionType,
  type AssistantPendingEmailToolOutput,
  pendingCreateRuleToolOutputSchema,
  pendingForwardEmailToolOutputSchema,
  pendingReplyEmailToolOutputSchema,
  pendingSaveMemoryToolOutputSchema,
  pendingSendEmailToolOutputSchema,
  type PendingForwardEmailToolOutput,
  type PendingReplyEmailToolOutput,
  type PendingSendEmailToolOutput,
} from "./assistant-chat.validation";
import {
  buildCreateRuleSchemaFromChatToolInput,
  type ChatCreateRuleToolInvocation,
} from "@/utils/ai/assistant/tools/rules/shared";
import { createRule } from "@/utils/rule/rule";

const CONFIRMATION_IN_PROGRESS_ERROR = "邮件操作确认已在进行中";
const SAVE_MEMORY_CONFIRMATION_IN_PROGRESS_ERROR = "记忆保存确认已在进行中";
const CONFIRMATION_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const CONFIRMATION_PERSIST_MAX_ATTEMPTS = 3;
const PENDING_ACTION_PERSIST_WAIT_MS = 2000;
const PENDING_ACTION_POLL_INTERVAL_MS = 250;
const SENT_MESSAGE_RESOLVE_MAX_ATTEMPTS = 5;
const SENT_MESSAGE_RESOLVE_RETRY_MS = 500;
const SENT_MESSAGE_RESOLVE_LOOKBACK_MS = 60 * 1000;
const SENT_MESSAGE_LINK_TIMEOUT_MS = 5000;

const ASSISTANT_EMAIL_ACTION_METADATA: Record<
  AssistantPendingEmailActionType,
  {
    toolType: string;
    errorMessage: string;
    parseOutput: (output: unknown) => AssistantPendingEmailToolOutput | null;
  }
> = {
  send_email: {
    toolType: "tool-sendEmail",
    errorMessage: "发送邮件失败",
    parseOutput: parsePendingSendEmailOutput,
  },
  reply_email: {
    toolType: "tool-replyEmail",
    errorMessage: "发送回复失败",
    parseOutput: parsePendingReplyEmailOutput,
  },
  forward_email: {
    toolType: "tool-forwardEmail",
    errorMessage: "转发邮件失败",
    parseOutput: parsePendingForwardEmailOutput,
  },
};

export async function confirmAssistantEmailActionForAccount({
  chatId,
  chatMessageId,
  toolCallId,
  actionType,
  contentOverride,
  waitForPersistence,
  persistenceWaitMs,
  emailAccountId,
  provider,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  actionType: AssistantPendingEmailActionType;
  contentOverride?: string;
  waitForPersistence?: boolean;
  persistenceWaitMs?: number;
  emailAccountId: string;
  provider: string;
  logger: Logger;
}) {
  const reservation = await reservePendingAssistantEmailAction({
    chatId,
    chatMessageId,
    toolCallId,
    actionType,
    emailAccountId,
    waitForPersistence,
    persistenceWaitMs,
    logger,
  });

  if (reservation.status === "confirmed") {
    return {
      success: true,
      confirmationState: "confirmed" as const,
      actionType,
      confirmationResult: reservation.confirmationResult,
    };
  }

  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider,
    logger,
  });

  let confirmationResult: AssistantEmailConfirmationResult;
  try {
    confirmationResult = await executeAssistantEmailAction({
      output: reservation.output,
      emailProvider,
      emailAccountId,
      contentOverride,
    });
  } catch (error) {
    await clearPendingPartProcessing({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      findPart: (parts) =>
        findPendingAssistantEmailPart({ parts, toolCallId, actionType }),
    }).catch((processingError) => {
      logger.error("清除邮件操作的处理状态失败", {
        error: processingError,
        actionType,
      });
    });

    logger.error("确认助手邮件操作失败", {
      error,
      actionType,
    });
    throw new SafeError(getAssistantEmailActionErrorMessage(actionType, error));
  }

  if (provider === "microsoft" && confirmationResult.messageId) {
    let linkTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // 此可选查询不得让持久化超过处理租约的时限。
      const sentMessage = await Promise.race([
        emailProvider.getMessage(confirmationResult.messageId),
        new Promise<never>((_, reject) => {
          linkTimeout = setTimeout(
            () => reject(new Error("解析已发送邮件链接超时")),
            SENT_MESSAGE_LINK_TIMEOUT_MS,
          );
        }),
      ]);
      confirmationResult.externalUrl = sentMessage.externalUrl;
    } catch (error) {
      logger.warn("解析已发送邮件链接失败", { error });
    } finally {
      clearTimeout(linkTimeout);
    }
  }

  try {
    await persistConfirmedAssistantEmailActionPart({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      toolCallId,
      actionType,
      confirmationResult,
      contentOverride,
      logger,
    });
  } catch (error) {
    logger.error("持久化已确认的助手邮件操作失败", {
      error,
      actionType,
    });
    throw new SafeError("邮件已发送，但确认状态无法保存。请刷新后重试。");
  }

  return {
    success: true,
    confirmationState: "confirmed" as const,
    actionType,
    confirmationResult,
  };
}

export async function confirmAssistantCreateRuleForAccount({
  chatId,
  chatMessageId,
  toolCallId,
  waitForPersistence,
  emailAccountId,
  provider,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  waitForPersistence?: boolean;
  emailAccountId: string;
  provider: string;
  logger: Logger;
}) {
  const reservation = await reservePendingAssistantCreateRule({
    chatId,
    chatMessageId,
    toolCallId,
    emailAccountId,
    waitForPersistence,
    logger,
  });

  if (reservation.status === "confirmed") {
    return {
      success: true,
      confirmationState: "confirmed" as const,
      ruleId: reservation.ruleId,
    };
  }

  const toolInput = reservation.toolInput;
  if (!isRecord(toolInput)) {
    throw new SafeError("创建规则工具输入无效");
  }

  let rule: Awaited<ReturnType<typeof createRule>>;
  try {
    rule = await createRule({
      result: buildCreateRuleSchemaFromChatToolInput(
        toolInput as ChatCreateRuleToolInvocation,
        provider,
      ),
      emailAccountId,
      provider,
      runOnThreads: true,
      logger,
    });
  } catch (error) {
    if (
      reservation.output.confirmationState === "processing" &&
      isDuplicateError(error, "name")
    ) {
      const existingRule = await findRuleForPendingAssistantCreateRule({
        toolInput,
        emailAccountId,
      });

      if (existingRule) {
        const confirmedAt = new Date().toISOString();
        try {
          await persistConfirmedAssistantCreateRulePart({
            chatMessageId: reservation.chatMessageId,
            emailAccountId,
            toolCallId,
            riskMessages: reservation.output.riskMessages,
            ruleId: existingRule.id,
            confirmedAt,
            logger,
          });
        } catch (persistError) {
          logger.error("持久化已确认的助手创建规则失败", {
            error: persistError,
            ruleId: existingRule.id,
          });
          throw new SafeError("规则已创建，但确认状态无法保存。请刷新后重试。");
        }

        return {
          success: true,
          confirmationState: "confirmed" as const,
          ruleId: existingRule.id,
          confirmationResult: { ruleId: existingRule.id, confirmedAt },
        };
      }
    }

    await clearPendingPartProcessing({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      findPart: (parts) =>
        findPendingAssistantCreateRulePart({ parts, toolCallId }),
    }).catch((processingError) => {
      logger.error("清除创建规则的处理状态失败", {
        error: processingError,
      });
    });
    logger.error("确认助手创建规则失败", { error });
    throw new SafeError(
      error instanceof Error ? error.message : "创建规则失败",
    );
  }

  const confirmedAt = new Date().toISOString();
  try {
    await persistConfirmedAssistantCreateRulePart({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      toolCallId,
      riskMessages: reservation.output.riskMessages,
      ruleId: rule.id,
      confirmedAt,
      logger,
    });
  } catch (persistError) {
    logger.error("持久化已确认的助手创建规则失败", {
      error: persistError,
      ruleId: rule.id,
    });
    throw new SafeError("规则已创建，但确认状态无法保存。请刷新后重试。");
  }

  return {
    success: true,
    confirmationState: "confirmed" as const,
    ruleId: rule.id,
    confirmationResult: { ruleId: rule.id, confirmedAt },
  };
}

export async function confirmAssistantSaveMemoryForAccount({
  chatId,
  chatMessageId,
  toolCallId,
  waitForPersistence,
  emailAccountId,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  waitForPersistence?: boolean;
  emailAccountId: string;
  logger: Logger;
}) {
  const reservation = await reservePendingAssistantSaveMemory({
    chatId,
    chatMessageId,
    toolCallId,
    emailAccountId,
    waitForPersistence,
    logger,
  });

  if (reservation.status === "confirmed") {
    return {
      success: true,
      confirmationState: "confirmed" as const,
      content: reservation.content,
      confirmationResult: reservation.confirmationResult,
    };
  }

  const content = reservation.output.content;
  const existing = await prisma.chatMemory.findFirst({
    where: { emailAccountId, content },
    select: { id: true },
  });

  const confirmedAt = new Date().toISOString();

  try {
    if (!existing) {
      await prisma.chatMemory.create({
        data: {
          content,
          chatId,
          emailAccountId,
        },
      });
    }
  } catch (error) {
    await clearPendingPartProcessing({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      findPart: (parts) =>
        findPendingAssistantSaveMemoryPart({ parts, toolCallId }),
    }).catch((processingError) => {
      logger.error("清除保存记忆的处理状态失败", {
        error: processingError,
      });
    });
    logger.error("确认助手保存记忆失败", { error, content });
    throw new SafeError("保存记忆失败");
  }

  const confirmationResult = {
    content,
    confirmedAt,
    ...(existing ? { deduplicated: true } : {}),
  };

  try {
    await persistConfirmedAssistantSaveMemoryPart({
      chatMessageId: reservation.chatMessageId,
      emailAccountId,
      toolCallId,
      content,
      confirmedAt,
      deduplicated: Boolean(existing),
      logger,
    });
  } catch (persistError) {
    logger.error("持久化已确认的助手保存记忆失败", {
      error: persistError,
      content,
    });
    throw new SafeError("记忆已保存，但确认状态无法保存。请刷新后重试。");
  }

  return {
    success: true,
    confirmationState: "confirmed" as const,
    content,
    confirmationResult,
  };
}

async function executeAssistantEmailAction({
  output,
  emailProvider,
  emailAccountId,
  contentOverride,
}: {
  output: AssistantPendingEmailToolOutput;
  emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  emailAccountId: string;
  contentOverride?: string;
}): Promise<AssistantEmailConfirmationResult> {
  const confirmedAt = new Date().toISOString();

  switch (output.actionType) {
    case "send_email":
      return confirmPendingSendEmailAction({
        output,
        emailProvider,
        emailAccountId,
        confirmedAt,
        contentOverride,
      });
    case "reply_email":
      return confirmPendingReplyEmailAction({
        output,
        emailProvider,
        emailAccountId,
        confirmedAt,
        contentOverride,
      });
    case "forward_email":
      return confirmPendingForwardEmailAction({
        output,
        emailProvider,
        emailAccountId,
        confirmedAt,
        contentOverride,
      });
  }
}

async function confirmPendingSendEmailAction({
  output,
  emailProvider,
  emailAccountId,
  confirmedAt,
  contentOverride,
}: {
  output: PendingSendEmailToolOutput;
  emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  emailAccountId: string;
  confirmedAt: string;
  contentOverride?: string;
}) {
  const from =
    output.pendingAction.from ||
    (await getFormattedSenderAddress({ emailAccountId }));

  const messageHtml = contentOverride
    ? convertNewlinesToBr(escapeHtml(contentOverride))
    : output.pendingAction.messageHtml;
  const sentAfter = new Date();

  const result = await emailProvider.sendEmailWithHtml({
    to: output.pendingAction.to,
    cc: output.pendingAction.cc || undefined,
    bcc: output.pendingAction.bcc || undefined,
    subject: output.pendingAction.subject,
    messageHtml,
    ...(from ? { from } : {}),
  });
  const messageId = await resolveSentMessageId({
    emailProvider,
    messageId: result.messageId,
    threadId: result.threadId,
    sentAfter,
  });

  return {
    actionType: output.actionType,
    messageId,
    threadId: result.threadId || null,
    to: output.pendingAction.to,
    subject: output.pendingAction.subject,
    confirmedAt,
  };
}

async function confirmPendingReplyEmailAction({
  output,
  emailProvider,
  emailAccountId,
  confirmedAt,
  contentOverride,
}: {
  output: PendingReplyEmailToolOutput;
  emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  emailAccountId: string;
  confirmedAt: string;
  contentOverride?: string;
}) {
  const sourceMessage = await emailProvider.getMessage(
    output.pendingAction.messageId,
  );
  const message = applyReferenceThreadIdFallback(
    sourceMessage,
    output.reference?.threadId,
  );
  const from = await getFormattedSenderAddress({ emailAccountId });
  const replyOptions = from ? { from } : undefined;
  const sentAfter = new Date();
  await emailProvider.replyToEmail(
    message,
    escapeHtml(contentOverride || output.pendingAction.content),
    replyOptions,
  );

  const messageId = await resolveSentMessageId({
    emailProvider,
    threadId: message.threadId,
    sentAfter,
  });

  return {
    actionType: output.actionType,
    messageId,
    threadId: message.threadId || null,
    to: message.headers["reply-to"] || message.headers.from || null,
    subject: message.subject || message.headers.subject || null,
    confirmedAt,
  };
}

async function confirmPendingForwardEmailAction({
  output,
  emailProvider,
  emailAccountId,
  confirmedAt,
  contentOverride,
}: {
  output: PendingForwardEmailToolOutput;
  emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  emailAccountId: string;
  confirmedAt: string;
  contentOverride?: string;
}) {
  const sourceMessage = await emailProvider.getMessage(
    output.pendingAction.messageId,
  );
  const message = applyReferenceThreadIdFallback(
    sourceMessage,
    output.reference?.threadId,
  );
  const sentAfter = new Date();
  await forwardMessage({
    emailProvider,
    emailAccountId,
    message,
    to: output.pendingAction.to,
    cc: output.pendingAction.cc,
    bcc: output.pendingAction.bcc,
    content: contentOverride || output.pendingAction.content,
  });

  const messageId = await resolveSentMessageId({
    emailProvider,
    threadId: message.threadId,
    sentAfter,
  });

  return {
    actionType: output.actionType,
    messageId,
    threadId: message.threadId || null,
    to: output.pendingAction.to,
    subject: message.subject || message.headers.subject || null,
    confirmedAt,
  };
}

const ASSISTANT_CREATE_RULE_TOOL_TYPE = "tool-createRule";

function findPendingAssistantCreateRulePart({
  parts,
  toolCallId,
}: {
  parts: unknown;
  toolCallId: string;
}) {
  if (!Array.isArray(parts)) return null;

  for (const [index, part] of parts.entries()) {
    if (
      !isRecord(part) ||
      part.type !== ASSISTANT_CREATE_RULE_TOOL_TYPE ||
      part.toolCallId !== toolCallId
    ) {
      continue;
    }

    const parsed = pendingCreateRuleToolOutputSchema.safeParse(part.output);
    if (!parsed.success) continue;

    const out = parsed.data;
    if (!out.requiresConfirmation || out.actionType !== "create_rule") {
      continue;
    }

    return {
      index,
      output: out,
      parts,
      toolInput: part.input,
    };
  }

  return null;
}

function findPendingAssistantSaveMemoryPart({
  parts,
  toolCallId,
}: {
  parts: unknown;
  toolCallId: string;
}) {
  if (!Array.isArray(parts)) return null;

  for (const [index, part] of parts.entries()) {
    if (
      !isRecord(part) ||
      part.type !== "tool-saveMemory" ||
      part.toolCallId !== toolCallId
    ) {
      continue;
    }

    const parsed = pendingSaveMemoryToolOutputSchema.safeParse(part.output);
    if (!parsed.success) continue;

    const out = parsed.data;
    if (!out.requiresConfirmation || out.actionType !== "save_memory") {
      continue;
    }

    return {
      index,
      output: out,
      parts,
      toolInput: part.input,
    };
  }

  return null;
}

async function findChatMessageForPendingAction({
  chatId,
  chatMessageId,
  emailAccountId,
  logger,
  matchParts,
  logPrefix,
  waitForPersistenceMs,
}: {
  chatId: string;
  chatMessageId?: string;
  emailAccountId: string;
  logger: Logger;
  matchParts: (parts: unknown) => boolean;
  logPrefix: string;
  waitForPersistenceMs?: number;
}) {
  const startedAt = Date.now();
  let attemptCount = 0;

  while (true) {
    attemptCount += 1;

    const hintedChatMessage = chatMessageId
      ? await prisma.chatMessage.findFirst({
          where: {
            id: chatMessageId,
            chat: { id: chatId, emailAccountId },
          },
          select: {
            id: true,
            chatId: true,
            updatedAt: true,
            parts: true,
          },
        })
      : null;

    if (hintedChatMessage && matchParts(hintedChatMessage.parts)) {
      if (attemptCount > 1) {
        logger.info(`${logPrefix} 持久化等待后已解析`, {
          chatId,
          requestedChatMessageId: chatMessageId,
          resolvedChatMessageId: hintedChatMessage.id,
          waitedMs: Date.now() - startedAt,
          lookupAttempts: attemptCount,
        });
      }
      return hintedChatMessage;
    }

    const assistantMessages = await prisma.chatMessage.findMany({
      where: {
        role: "assistant",
        chat: { id: chatId, emailAccountId },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        chatId: true,
        updatedAt: true,
        parts: true,
      },
    });

    const matchingMessages = assistantMessages.filter((message) =>
      matchParts(message.parts),
    );

    if (matchingMessages.length === 1) {
      if (attemptCount > 1) {
        logger.info(`${logPrefix} 持久化等待后已解析`, {
          chatId,
          requestedChatMessageId: chatMessageId,
          resolvedChatMessageId: matchingMessages[0].id,
          waitedMs: Date.now() - startedAt,
          lookupAttempts: attemptCount,
        });
      } else if (chatMessageId && matchingMessages[0].id !== chatMessageId) {
        logger.warn(`${logPrefix} 通过工具查找解析到待处理操作`, {
          chatId,
          requestedChatMessageId: chatMessageId,
          resolvedChatMessageId: matchingMessages[0].id,
        });
      }
      return matchingMessages[0];
    }

    if (matchingMessages.length > 1) {
      logger.warn(`${logPrefix} 找到多个待处理操作匹配`, {
        chatId,
        requestedChatMessageId: chatMessageId,
        matchedChatMessageIds: matchingMessages.map((message) => message.id),
      });
      return matchingMessages[0];
    }

    const waitedMs = Date.now() - startedAt;
    if (waitForPersistenceMs && waitedMs < waitForPersistenceMs) {
      await sleep(
        Math.min(
          PENDING_ACTION_POLL_INTERVAL_MS,
          waitForPersistenceMs - waitedMs,
        ),
      );
      continue;
    }

    logger.warn(`${logPrefix} 未找到待处理操作`, {
      chatId,
      requestedChatMessageId: chatMessageId,
      hintedMessageFound: Boolean(hintedChatMessage),
      assistantMessageCount: assistantMessages.length,
      waitedMs,
      lookupAttempts: attemptCount,
    });

    return null;
  }
}

function findPendingAssistantEmailPart({
  parts,
  toolCallId,
  actionType,
}: {
  parts: unknown;
  toolCallId: string;
  actionType: AssistantPendingEmailActionType;
}) {
  if (!Array.isArray(parts)) return null;

  const expectedToolType = getAssistantToolTypeForAction(actionType);
  for (const [index, part] of parts.entries()) {
    if (
      !isRecord(part) ||
      part.type !== expectedToolType ||
      part.toolCallId !== toolCallId
    ) {
      continue;
    }

    const parsedOutput = parsePendingAssistantEmailOutput({
      actionType,
      output: part.output,
    });
    if (!parsedOutput) return null;

    return {
      index,
      output: parsedOutput,
      parts,
    };
  }

  return null;
}

function updateAssistantEmailPartWithConfirmation({
  parts,
  partIndex,
  confirmationResult,
  contentOverride,
}: {
  parts: unknown[];
  partIndex: number;
  confirmationResult: AssistantEmailConfirmationResult;
  contentOverride?: string;
}) {
  return updateAssistantEmailPartOutput({
    parts,
    partIndex,
    outputPatch: {
      success: true,
      confirmationState: "confirmed",
      confirmationResult,
    },
    pendingActionPatch: contentOverride
      ? getPendingActionContentPatch(
          confirmationResult.actionType,
          contentOverride,
        )
      : undefined,
  });
}

function updateAssistantEmailPartWithProcessing({
  parts,
  partIndex,
  processingAt,
}: {
  parts: unknown[];
  partIndex: number;
  processingAt: string;
}) {
  return updateAssistantEmailPartOutput({
    parts,
    partIndex,
    outputPatch: {
      confirmationState: "processing",
      confirmationProcessingAt: processingAt,
    },
  });
}

function updateAssistantEmailPartWithPending({
  parts,
  partIndex,
}: {
  parts: unknown[];
  partIndex: number;
}) {
  return updateAssistantEmailPartOutput({
    parts,
    partIndex,
    outputPatch: {
      confirmationState: "pending",
    },
  });
}

async function reservePendingAssistantEmailAction({
  chatId,
  chatMessageId,
  toolCallId,
  actionType,
  emailAccountId,
  waitForPersistence,
  persistenceWaitMs,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  actionType: AssistantPendingEmailActionType;
  emailAccountId: string;
  waitForPersistence?: boolean;
  persistenceWaitMs?: number;
  logger: Logger;
}) {
  const waitForPersistenceMs = waitForPersistence
    ? (persistenceWaitMs ?? PENDING_ACTION_PERSIST_WAIT_MS)
    : undefined;

  const reservation = await reservePendingAssistantPart({
    chatId,
    chatMessageId,
    emailAccountId,
    logger,
    findPart: (parts) =>
      findPendingAssistantEmailPart({ parts, toolCallId, actionType }),
    getConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" &&
      lookup.output.confirmationResult
        ? lookup.output.confirmationResult
        : null,
    validateLookup: (lookup) => {
      if (lookup.output.emailAccountId !== emailAccountId) {
        throw new SafeError(
          "无法验证此草稿的发件邮箱。请在你要用于发送的账号中重新准备草稿。",
        );
      }
    },
    logPrefix: "助手邮件确认",
    waitForPersistenceMs,
    inProgressError: CONFIRMATION_IN_PROGRESS_ERROR,
    onMessageNotFound: () =>
      warnAndThrowAssistantEmailConfirmationError({
        logger,
        logMessage: "助手邮件确认失败：未找到聊天消息",
        safeMessage: "未找到聊天消息",
        chatMessageId,
        toolCallId,
        actionType,
      }),
    onPartNotFound: (resolvedChatMessageId) =>
      warnAndThrowAssistantEmailConfirmationError({
        logger,
        logMessage: "助手邮件确认失败：未找到待处理的助手操作",
        safeMessage: "未找到待处理的助手操作",
        chatMessageId: resolvedChatMessageId,
        toolCallId,
        actionType,
      }),
    onRaceMessageNotFound: (resolvedChatMessageId) =>
      warnAndThrowAssistantEmailConfirmationError({
        logger,
        logMessage: "保留竞争后助手邮件确认失败：未找到聊天消息",
        safeMessage: "未找到聊天消息",
        chatMessageId: resolvedChatMessageId,
        toolCallId,
        actionType,
      }),
  });

  if (reservation.status === "confirmed") {
    return {
      status: "confirmed" as const,
      confirmationResult: reservation.value,
    };
  }

  return {
    status: "reserved" as const,
    chatMessageId: reservation.chatMessageId,
    output: reservation.lookup.output,
  };
}

async function clearPendingPartProcessing({
  chatMessageId,
  emailAccountId,
  findPart,
}: {
  chatMessageId?: string;
  emailAccountId: string;
  findPart: (parts: unknown) => {
    index: number;
    output: { confirmationState: string };
    parts: unknown[];
  } | null;
}) {
  const chatMessage = await prisma.chatMessage.findFirst({
    where: {
      id: chatMessageId,
      chat: { emailAccountId },
    },
    select: {
      id: true,
      chatId: true,
      updatedAt: true,
      parts: true,
    },
  });

  if (!chatMessage) return;

  const lookup = findPart(chatMessage.parts);
  if (lookup?.output.confirmationState !== "processing") return;

  const pendingParts = updateAssistantEmailPartWithPending({
    parts: lookup.parts,
    partIndex: lookup.index,
  });

  await prisma.chatMessage.updateMany({
    where: {
      id: chatMessage.id,
      chatId: chatMessage.chatId,
      updatedAt: chatMessage.updatedAt,
    },
    data: { parts: pendingParts as Prisma.InputJsonValue },
  });
}

async function resolveSentMessageId({
  emailProvider,
  messageId,
  threadId,
  sentAfter,
}: {
  emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  messageId?: string | null;
  threadId?: string | null;
  sentAfter?: Date;
}) {
  if (messageId) return messageId;
  if (!threadId || !sentAfter) return null;

  const sentAfterWithLookback = new Date(
    sentAfter.getTime() - SENT_MESSAGE_RESOLVE_LOOKBACK_MS,
  );

  for (
    let attempt = 0;
    attempt < SENT_MESSAGE_RESOLVE_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const sentMessagePage = await emailProvider.getSentMessageIds({
        maxResults: 20,
        after: sentAfterWithLookback,
        before: new Date(),
      });

      const matchingThreadIds = sentMessagePage.messages.filter(
        (sentMessage) => sentMessage.threadId === threadId,
      );

      if (matchingThreadIds.length === 1) {
        return matchingThreadIds[0].id;
      }

      if (matchingThreadIds.length > 1) {
        return null;
      }
    } catch {}

    if (attempt < SENT_MESSAGE_RESOLVE_MAX_ATTEMPTS - 1) {
      await sleep(SENT_MESSAGE_RESOLVE_RETRY_MS);
    }
  }

  return null;
}

function getAssistantEmailActionErrorMessage(
  actionType: AssistantPendingEmailActionType,
  error?: unknown,
) {
  const fallback = ASSISTANT_EMAIL_ACTION_METADATA[actionType].errorMessage;
  const providerErrorMessage = getProviderErrorMessage(error);

  return providerErrorMessage
    ? `${fallback}: ${providerErrorMessage}`
    : fallback;
}

function getProviderErrorMessage(error: unknown): string | null {
  if (!isRecord(error)) return null;

  const raw = extractRawProviderErrorMessage(error);
  return raw ? sanitizeProviderErrorMessage(raw) : null;
}

function extractRawProviderErrorMessage(
  error: Record<string, unknown>,
): string | null {
  const bodyMessage = getProviderErrorBodyMessage(error.body);
  if (bodyMessage) return bodyMessage;

  const nestedError = error.error;
  if (isRecord(nestedError) && typeof nestedError.message === "string") {
    return nestedError.message;
  }

  const hasMetadata = Boolean(
    error.status ||
      error.statusCode ||
      error.code ||
      error.body ||
      error.response ||
      error.data,
  );
  if (
    hasMetadata &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return null;
}

function getProviderErrorBodyMessage(body: unknown): string | null {
  if (typeof body !== "string" || !body.trim()) return null;

  try {
    const parsed = JSON.parse(body);
    if (!isRecord(parsed)) return null;

    const error = parsed.error;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }

    if (typeof parsed.message === "string") return parsed.message;
  } catch {}

  return body;
}

function sanitizeProviderErrorMessage(message: string) {
  const sanitized = message
    .replace(/[\w.%+-]+@[\w.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) return null;
  return truncate(sanitized, 237);
}

function getAssistantToolTypeForAction(
  actionType: AssistantPendingEmailActionType,
) {
  return ASSISTANT_EMAIL_ACTION_METADATA[actionType].toolType;
}

function parsePendingAssistantEmailOutput({
  actionType,
  output,
}: {
  actionType: AssistantPendingEmailActionType;
  output: unknown;
}) {
  return ASSISTANT_EMAIL_ACTION_METADATA[actionType].parseOutput(output);
}

function updateAssistantEmailPartOutput({
  parts,
  partIndex,
  outputPatch,
  pendingActionPatch,
}: {
  parts: unknown[];
  partIndex: number;
  outputPatch: Record<string, unknown>;
  pendingActionPatch?: Record<string, unknown>;
}) {
  return parts.map((part, index) => {
    if (index !== partIndex || !isRecord(part)) return part;

    const existingOutput = isRecord(part.output) ? part.output : {};
    const outputWithoutProcessing =
      getOutputWithoutProcessingMetadata(existingOutput);

    const patchedOutput = {
      ...outputWithoutProcessing,
      ...outputPatch,
    };

    if (pendingActionPatch && isRecord(patchedOutput.pendingAction)) {
      patchedOutput.pendingAction = {
        ...patchedOutput.pendingAction,
        ...pendingActionPatch,
      };
    }

    return {
      ...part,
      output: patchedOutput,
    };
  });
}

async function persistConfirmedAssistantEmailActionPart({
  chatMessageId,
  emailAccountId,
  toolCallId,
  actionType,
  confirmationResult,
  contentOverride,
  logger,
}: {
  chatMessageId: string;
  emailAccountId: string;
  toolCallId: string;
  actionType: AssistantPendingEmailActionType;
  confirmationResult: AssistantEmailConfirmationResult;
  contentOverride?: string;
  logger: Logger;
}) {
  await persistConfirmedAssistantPart({
    chatMessageId,
    emailAccountId,
    logger: logger.with({ chatMessageId, toolCallId, actionType }),
    findPart: (parts) =>
      findPendingAssistantEmailPart({ parts, toolCallId, actionType }),
    isConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" &&
      !!lookup.output.confirmationResult,
    buildParts: ({ parts, partIndex }) =>
      updateAssistantEmailPartWithConfirmation({
        parts,
        partIndex,
        confirmationResult,
        contentOverride,
      }),
  });
}

function hasProcessingLeaseExpired(processingAt?: string | null) {
  if (!processingAt) return false;

  const processingTime = Date.parse(processingAt);
  if (Number.isNaN(processingTime)) return false;

  return Date.now() - processingTime >= CONFIRMATION_PROCESSING_LEASE_MS;
}

async function reservePendingAssistantSaveMemory({
  chatId,
  chatMessageId,
  toolCallId,
  emailAccountId,
  waitForPersistence,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  emailAccountId: string;
  waitForPersistence?: boolean;
  logger: Logger;
}) {
  const waitForPersistenceMs = waitForPersistence
    ? PENDING_ACTION_PERSIST_WAIT_MS
    : undefined;

  const reservation = await reservePendingAssistantPart({
    chatId,
    chatMessageId,
    emailAccountId,
    logger,
    findPart: (parts) =>
      findPendingAssistantSaveMemoryPart({ parts, toolCallId }),
    getConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" &&
      lookup.output.confirmationResult
        ? lookup.output.confirmationResult
        : null,
    logPrefix: "助手保存记忆确认",
    waitForPersistenceMs,
    inProgressError: SAVE_MEMORY_CONFIRMATION_IN_PROGRESS_ERROR,
    onMessageNotFound: () => {
      logger.warn("助手保存记忆确认：未找到聊天消息", {
        chatMessageId,
        toolCallId,
      });
      throw new SafeError("未找到聊天消息");
    },
    onPartNotFound: (resolvedChatMessageId) => {
      logger.warn("助手保存记忆确认：未找到待处理项", {
        chatMessageId: resolvedChatMessageId,
        toolCallId,
      });
      throw new SafeError("未找到待处理的记忆保存");
    },
    onRaceMessageNotFound: () => {
      throw new SafeError("未找到聊天消息");
    },
  });

  if (reservation.status === "confirmed") {
    return {
      status: "confirmed" as const,
      content: reservation.value.content,
      confirmationResult: reservation.value,
    };
  }

  return {
    status: "reserved" as const,
    chatMessageId: reservation.chatMessageId,
    output: reservation.lookup.output,
    toolInput: reservation.lookup.toolInput,
  };
}

async function reservePendingAssistantCreateRule({
  chatId,
  chatMessageId,
  toolCallId,
  emailAccountId,
  waitForPersistence,
  logger,
}: {
  chatId: string;
  chatMessageId?: string;
  toolCallId: string;
  emailAccountId: string;
  waitForPersistence?: boolean;
  logger: Logger;
}) {
  const waitForPersistenceMs = waitForPersistence
    ? PENDING_ACTION_PERSIST_WAIT_MS
    : undefined;

  const reservation = await reservePendingAssistantPart({
    chatId,
    chatMessageId,
    emailAccountId,
    logger,
    findPart: (parts) =>
      findPendingAssistantCreateRulePart({ parts, toolCallId }),
    getConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" && lookup.output.ruleId
        ? lookup.output.ruleId
        : null,
    logPrefix: "助手创建规则确认",
    waitForPersistenceMs,
    inProgressError: CONFIRMATION_IN_PROGRESS_ERROR,
    onMessageNotFound: () => {
      logger.warn("助手创建规则确认：未找到聊天消息", {
        chatMessageId,
        toolCallId,
      });
      throw new SafeError("未找到聊天消息");
    },
    onPartNotFound: (resolvedChatMessageId) => {
      logger.warn("助手创建规则确认：未找到待处理项", {
        chatMessageId: resolvedChatMessageId,
        toolCallId,
      });
      throw new SafeError("未找到待处理的规则创建");
    },
    onRaceMessageNotFound: () => {
      throw new SafeError("未找到聊天消息");
    },
  });

  if (reservation.status === "confirmed") {
    return {
      status: "confirmed" as const,
      ruleId: reservation.value,
    };
  }

  return {
    status: "reserved" as const,
    chatMessageId: reservation.chatMessageId,
    output: reservation.lookup.output,
    toolInput: reservation.lookup.toolInput,
  };
}

async function reservePendingAssistantPart<
  TLookup extends {
    index: number;
    parts: unknown[];
    output: {
      confirmationState: string;
      confirmationProcessingAt?: string | null;
    };
  },
  TConfirmed,
>({
  chatId,
  chatMessageId,
  emailAccountId,
  logger,
  findPart,
  getConfirmed,
  validateLookup,
  logPrefix,
  waitForPersistenceMs,
  inProgressError,
  onMessageNotFound,
  onPartNotFound,
  onRaceMessageNotFound,
}: {
  chatId: string;
  chatMessageId?: string;
  emailAccountId: string;
  logger: Logger;
  findPart: (parts: unknown) => TLookup | null;
  getConfirmed: (lookup: TLookup) => TConfirmed | null;
  validateLookup?: (lookup: TLookup) => void;
  logPrefix: string;
  waitForPersistenceMs?: number;
  inProgressError: string;
  onMessageNotFound: () => never;
  onPartNotFound: (chatMessageId: string) => never;
  onRaceMessageNotFound: (chatMessageId: string) => never;
}): Promise<
  | { status: "confirmed"; value: TConfirmed }
  | { status: "reserved"; chatMessageId: string; lookup: TLookup }
> {
  const findMessage = () =>
    findChatMessageForPendingAction({
      chatId,
      chatMessageId,
      emailAccountId,
      logger,
      matchParts: (parts) => !!findPart(parts),
      logPrefix,
      waitForPersistenceMs,
    });

  const chatMessage = await findMessage();
  if (!chatMessage) return onMessageNotFound();

  const lookup = findPart(chatMessage.parts);
  if (!lookup) return onPartNotFound(chatMessage.id);

  const confirmed = getConfirmed(lookup);
  if (confirmed !== null) {
    return { status: "confirmed", value: confirmed };
  }

  validateLookup?.(lookup);

  if (
    lookup.output.confirmationState === "processing" &&
    !hasProcessingLeaseExpired(lookup.output.confirmationProcessingAt)
  ) {
    throw new SafeError(inProgressError);
  }

  const processingParts = updateAssistantEmailPartWithProcessing({
    parts: lookup.parts,
    partIndex: lookup.index,
    processingAt: new Date().toISOString(),
  });

  const claim = await prisma.chatMessage.updateMany({
    where: {
      id: chatMessage.id,
      chatId: chatMessage.chatId,
      updatedAt: chatMessage.updatedAt,
    },
    data: {
      parts: processingParts as Prisma.InputJsonValue,
    },
  });

  if (claim.count === 1) {
    return {
      status: "reserved",
      chatMessageId: chatMessage.id,
      lookup,
    };
  }

  const latestMessage = await findMessage();
  if (!latestMessage) return onRaceMessageNotFound(chatMessage.id);

  const latestLookup = findPart(latestMessage.parts);
  if (latestLookup) {
    const latestConfirmed = getConfirmed(latestLookup);
    if (latestConfirmed !== null) {
      return { status: "confirmed", value: latestConfirmed };
    }
  }

  throw new SafeError(inProgressError);
}

async function persistConfirmedAssistantCreateRulePart({
  chatMessageId,
  emailAccountId,
  toolCallId,
  riskMessages,
  ruleId,
  confirmedAt,
  logger,
}: {
  chatMessageId: string;
  emailAccountId: string;
  toolCallId: string;
  riskMessages?: string[];
  ruleId: string;
  confirmedAt: string;
  logger: Logger;
}) {
  await persistConfirmedAssistantPart({
    chatMessageId,
    emailAccountId,
    logger: logger.with({ chatMessageId, toolCallId, ruleId }),
    findPart: (parts) =>
      findPendingAssistantCreateRulePart({
        parts,
        toolCallId,
      }),
    isConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" &&
      lookup.output.ruleId === ruleId,
    buildParts: ({ parts, partIndex }) =>
      buildConfirmedAssistantCreateRuleParts({
        parts,
        partIndex,
        riskMessages,
        ruleId,
        confirmedAt,
      }),
  });
}

async function persistConfirmedAssistantSaveMemoryPart({
  chatMessageId,
  emailAccountId,
  toolCallId,
  content,
  confirmedAt,
  deduplicated,
  logger,
}: {
  chatMessageId: string;
  emailAccountId: string;
  toolCallId: string;
  content: string;
  confirmedAt: string;
  deduplicated: boolean;
  logger: Logger;
}) {
  await persistConfirmedAssistantPart({
    chatMessageId,
    emailAccountId,
    logger: logger.with({ chatMessageId, toolCallId, content }),
    findPart: (parts) =>
      findPendingAssistantSaveMemoryPart({
        parts,
        toolCallId,
      }),
    isConfirmed: (lookup) =>
      lookup.output.confirmationState === "confirmed" &&
      lookup.output.confirmationResult?.content === content,
    buildParts: ({ parts, partIndex }) =>
      buildConfirmedAssistantSaveMemoryParts({
        parts,
        partIndex,
        content,
        confirmedAt,
        deduplicated,
      }),
  });
}

async function persistConfirmedAssistantPart<
  TLookup extends { index: number; parts: unknown[] },
>({
  chatMessageId,
  emailAccountId,
  logger,
  findPart,
  isConfirmed,
  buildParts,
}: {
  chatMessageId: string;
  emailAccountId: string;
  logger: Logger;
  findPart: (parts: unknown) => TLookup | null;
  isConfirmed?: (lookup: TLookup) => boolean;
  buildParts: (args: { parts: unknown[]; partIndex: number }) => unknown[];
}) {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= CONFIRMATION_PERSIST_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const chatMessage = await prisma.chatMessage.findFirst({
        where: {
          id: chatMessageId,
          chat: { emailAccountId },
        },
        select: {
          id: true,
          chatId: true,
          updatedAt: true,
          parts: true,
        },
      });

      if (!chatMessage) {
        throw new Error("未找到聊天消息");
      }

      const lookup = findPart(chatMessage.parts);

      if (!lookup) {
        throw new Error("未找到待处理的助手操作");
      }

      if (isConfirmed?.(lookup)) {
        return;
      }

      const updatedParts = buildParts({
        parts: lookup.parts,
        partIndex: lookup.index,
      });

      const persisted = await prisma.chatMessage.updateMany({
        where: {
          id: chatMessage.id,
          chatId: chatMessage.chatId,
          updatedAt: chatMessage.updatedAt,
        },
        data: { parts: updatedParts as Prisma.InputJsonValue },
      });

      if (persisted.count === 1) {
        return;
      }

      logger.warn("助手确认持久化出现更新竞争", {
        attempt,
      });
    } catch (error) {
      lastError = error;
      logger.warn("助手确认持久化尝试失败", {
        attempt,
        error,
      });
    }
  }

  throw lastError ?? new Error("持久化已确认的助手操作失败");
}

function buildConfirmedAssistantSaveMemoryParts({
  parts,
  partIndex,
  content,
  confirmedAt,
  deduplicated,
}: {
  parts: unknown[];
  partIndex: number;
  content: string;
  confirmedAt: string;
  deduplicated: boolean;
}) {
  return updateAssistantEmailPartOutput({
    parts,
    partIndex,
    outputPatch: {
      success: true,
      saved: true,
      actionType: "save_memory",
      requiresConfirmation: true,
      confirmationState: "confirmed",
      content,
      confirmationResult: {
        content,
        confirmedAt,
        ...(deduplicated ? { deduplicated: true } : {}),
      },
    },
  });
}

function buildConfirmedAssistantCreateRuleParts({
  parts,
  partIndex,
  riskMessages,
  ruleId,
  confirmedAt,
}: {
  parts: unknown[];
  partIndex: number;
  riskMessages?: string[];
  ruleId: string;
  confirmedAt: string;
}) {
  return updateAssistantEmailPartOutput({
    parts,
    partIndex,
    outputPatch: {
      success: true,
      actionType: "create_rule",
      requiresConfirmation: true,
      confirmationState: "confirmed",
      riskMessages,
      ruleId,
      confirmationResult: { ruleId, confirmedAt },
    },
  });
}

async function findRuleForPendingAssistantCreateRule({
  toolInput,
  emailAccountId,
}: {
  toolInput: unknown;
  emailAccountId: string;
}) {
  if (!isRecord(toolInput) || typeof toolInput.name !== "string") return null;

  const ruleName = toolInput.name.trim();
  if (!ruleName) return null;

  return prisma.rule.findUnique({
    where: {
      name_emailAccountId: {
        name: ruleName,
        emailAccountId,
      },
    },
    select: { id: true },
  });
}

function warnAndThrowAssistantEmailConfirmationError({
  logger,
  logMessage,
  safeMessage,
  chatMessageId,
  toolCallId,
  actionType,
}: {
  logger: Logger;
  logMessage: string;
  safeMessage: string;
  chatMessageId?: string;
  toolCallId: string;
  actionType: AssistantPendingEmailActionType;
}): never {
  logger.warn(logMessage, {
    chatMessageId,
    toolCallId,
    actionType,
  });

  throw new SafeError(safeMessage);
}

function parsePendingSendEmailOutput(output: unknown) {
  const parsed = pendingSendEmailToolOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

function parsePendingReplyEmailOutput(output: unknown) {
  const parsed = pendingReplyEmailToolOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

function parsePendingForwardEmailOutput(output: unknown) {
  const parsed = pendingForwardEmailToolOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

function getOutputWithoutProcessingMetadata(output: Record<string, unknown>) {
  const { confirmationProcessingAt: _, ...rest } = output;
  return rest;
}

function applyReferenceThreadIdFallback<T extends { threadId?: string | null }>(
  message: T,
  fallbackThreadId?: string | null,
) {
  if (message.threadId || !fallbackThreadId) return message;

  return {
    ...message,
    threadId: fallbackThreadId,
  };
}

function getPendingActionContentPatch(
  actionType: AssistantPendingEmailActionType,
  contentOverride: string,
): Record<string, string> {
  if (actionType === "send_email") {
    return { messageHtml: convertNewlinesToBr(escapeHtml(contentOverride)) };
  }
  return { content: contentOverride };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
