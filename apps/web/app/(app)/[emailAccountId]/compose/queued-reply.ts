import type { MailClient } from "@inboxzero/mail-core/engine";
import {
  OFFLINE_DISPATCH_HOLD_MS,
  type OperationState,
  type OperationStatus,
} from "@inboxzero/mail-core/operations";
import type { QueryHandle } from "@inboxzero/mail-core/queries";
import type { SendEmailBody } from "@/utils/types/mail";
import { sendEmailToDraftContent } from "@/utils/mail-engine/draft-content";
import type { ComposeAttachmentReference } from "@/utils/mail-engine/reply-drafts";
import { admissionRejectionCopy } from "@/utils/mail-engine/admission-notice";
import { getUndoSendHoldUntil } from "./undo-send";

export const READER_EMAIL_SETTLEMENT_TIMEOUT_MS = 15_000;

export type ReaderEmailOutcome =
  | { status: "sent"; messageId: string; threadId: string }
  | {
      status: "queued";
      reason: "offline" | "pending" | "blocked_auth";
      threadId: string;
    }
  | {
      status: "held";
      holdUntil: number;
      mutationId: string;
      threadId: string;
    }
  | { status: "uncertain"; ownsNotification: boolean; threadId: string }
  | { status: "failed"; error: string; ownsNotification: boolean }
  | { status: "cancelled" };

const UNDONE_SEND_LOOKUP_TIMEOUT_MS = 2000;
const MAX_RESEND_ATTEMPTS = 20;

type QueueReaderEmailOptions = {
  client: MailClient;
  email: SendEmailBody;
  emailAccountId: string;
  messageIds: string[];
  online: boolean;
  /**
   * 在发送可能出现在会话中之前，用该发送的操作 ID 调用。
   * 如果发送未被接纳，则调用其返回值。
   */
  onSubmitting?: (operationId: string) => () => void;
  onQueued?: (operationId: string) => Promise<void>;
  mutationId?: string;
  holdForUndo?: boolean;
  /** 邮箱草稿已保存的副本，排队发送会将其替换 */
  providerDraftMessageIds?: string[];
  /** 邮箱草稿上的文件，保留以便撤销的发送能够列出它们 */
  attachments?: ComposeAttachmentReference[];
  settlementTimeoutMs?: number;
  threadId: string;
};

export async function queueReaderEmail(
  options: QueueReaderEmailOptions,
): Promise<ReaderEmailOutcome> {
  const { client, emailAccountId, mutationId } = options;
  if (!mutationId) {
    return queueReaderEmailOnce(options, crypto.randomUUID());
  }
  // 已撤销的发送会保留其命令 ID，因此重新发送恢复的草稿会移动到链中的下一个 ID。
  // 推导 ID 可以让链中任何位置仍处于待处理的发送阻止重复。
  for (let attempt = 0; ; attempt += 1) {
    const commandId = sendCommandId(mutationId, attempt);
    try {
      return await queueReaderEmailOnce(options, commandId);
    } catch (error) {
      if (
        !(error instanceof ConflictingSendError) ||
        attempt >= MAX_RESEND_ATTEMPTS ||
        !(await wasSendUndone(client, emailAccountId, commandId))
      ) {
        throw error;
      }
    }
  }
}

async function queueReaderEmailOnce(
  {
    client,
    email,
    emailAccountId,
    messageIds,
    online,
    onSubmitting,
    onQueued,
    holdForUndo,
    providerDraftMessageIds,
    attachments,
    settlementTimeoutMs = READER_EMAIL_SETTLEMENT_TIMEOUT_MS,
    threadId,
  }: QueueReaderEmailOptions,
  commandId: string,
): Promise<ReaderEmailOutcome> {
  const draftId = commandId;
  const content = sendEmailToDraftContent(
    email,
    threadId,
    providerDraftMessageIds,
    attachments,
  );
  const draftRevision = await saveSendableDraft(client, {
    accountId: emailAccountId,
    draftId,
    content,
  });
  const nowMs = Date.now();
  const undoHoldUntil = holdForUndo
    ? getUndoSendHoldUntil(online, nowMs)
    : undefined;
  const revertSubmitting = onSubmitting?.(commandId);
  const admission = await client
    .submitSend({
      commandId,
      conversationId: threadId,
      draft: { accountId: emailAccountId, draftId },
      draftRevision,
      notBeforeMs: !online ? nowMs + OFFLINE_DISPATCH_HOLD_MS : undoHoldUntil,
      replyTo: messageIds[0]
        ? { accountId: emailAccountId, messageId: messageIds[0] }
        : null,
    })
    .catch((error: unknown) => {
      revertSubmitting?.();
      throw error;
    });
  if (admission.status === "rejected") {
    revertSubmitting?.();
    const copy = admissionRejectionCopy(admission.code);
    if (!copy && admission.code === "invalid") {
      throw new ConflictingSendError();
    }
    throw new Error(copy ?? "无法将此邮件加入发送队列，请重试。");
  }
  await onQueued?.(commandId);
  if (undoHoldUntil !== undefined) {
    return {
      status: "held",
      holdUntil: undoHoldUntil,
      mutationId: commandId,
      threadId,
    };
  }
  if (!online) {
    return {
      status: "queued",
      reason: "offline",
      threadId,
    };
  }

  return waitForSettlement({
    accountId: emailAccountId,
    client,
    operationId: commandId,
    settlementTimeoutMs,
    threadId,
  });
}

export function waitForReaderEmailSettlement(options: {
  client: MailClient;
  accountId: string;
  mutationId: string;
  settlementTimeoutMs?: number;
  threadId: string;
}) {
  return waitForSettlement({
    accountId: options.accountId,
    client: options.client,
    operationId: options.mutationId,
    settlementTimeoutMs:
      options.settlementTimeoutMs ?? READER_EMAIL_SETTLEMENT_TIMEOUT_MS,
    threadId: options.threadId,
  });
}

/**
 * 发送成功送达时解析为 true；发送结束但未送达或等待超时时解析为 false。
 * 与结算不同，此函数会持续监视仍处于待处理或不确定状态的发送。
 */
export function waitForDelivery(options: {
  client: MailClient;
  accountId: string;
  operationId: string;
  timeoutMs: number;
}) {
  const handle = options.client.observeOperation({
    accountId: options.accountId,
    operationId: options.operationId,
  });
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (delivered: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      unsubscribe();
      handle.close();
      resolve(delivered);
    };
    const inspect = () => {
      const status = handle.getSnapshot().data?.status;
      if (status === "succeeded") finish(true);
      else if (status && UNDELIVERED_END_STATUSES.has(status)) finish(false);
    };
    const unsubscribe = handle.subscribe(inspect);
    const timeout = setTimeout(() => finish(false), options.timeoutMs);
    inspect();
  });
}

const UNDELIVERED_END_STATUSES = new Set<OperationStatus>([
  "failed",
  "needs_attention",
  "cancelled",
  "superseded",
]);

class ConflictingSendError extends Error {
  constructor() {
    super("此回复已以不同内容加入队列，请检查会话的发送状态。");
  }
}

function wasSendUndone(
  client: MailClient,
  accountId: string,
  operationId: string,
) {
  const handle = client.observeOperation({ accountId, operationId });
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (undone: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      handle.close();
      resolve(undone);
    };
    const inspect = () => {
      const snapshot = handle.getSnapshot();
      if (snapshot.status === "loading") return;
      const status = snapshot.data?.status;
      finish(status === "cancelled" || status === "superseded");
    };
    const unsubscribe = handle.subscribe(inspect);
    const timeout = setTimeout(
      () => finish(false),
      UNDONE_SEND_LOOKUP_TIMEOUT_MS,
    );
    inspect();
  });
}

async function saveSendableDraft(
  client: MailClient,
  input: {
    accountId: string;
    draftId: string;
    content: ReturnType<typeof sendEmailToDraftContent>;
  },
) {
  let expectedRevision: number | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const saved = await client.saveDraft({
      key: { accountId: input.accountId, draftId: input.draftId },
      expectedRevision,
      content: input.content,
    });
    if (saved.status === "saved") return saved.draftRevision;
    if (saved.status === "rejected") {
      throw new Error("无法在设备上保存此邮件。");
    }
    if (saved.currentDraftRevision == null) {
      throw new Error("无法在设备上保存此邮件。");
    }
    if (expectedRevision === saved.currentDraftRevision) {
      return saved.currentDraftRevision;
    }
    expectedRevision = saved.currentDraftRevision;
  }
  throw new Error("无法在设备上保存此邮件。");
}

async function waitForSettlement({
  client,
  accountId,
  operationId,
  settlementTimeoutMs,
  threadId,
}: {
  client: MailClient;
  accountId: string;
  operationId: string;
  settlementTimeoutMs: number;
  threadId: string;
}): Promise<ReaderEmailOutcome> {
  const handle = client.observeOperation({
    accountId,
    operationId,
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ReaderEmailOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      handle.close();
      resolve(outcome);
    };
    const inspect = () => {
      if (settled) return;
      const outcome = operationOutcome(handle, threadId);
      if (outcome) finish(outcome);
    };
    const unsubscribe = handle.subscribe(inspect);
    const timeout = setTimeout(
      () => finish({ status: "queued", reason: "pending", threadId }),
      settlementTimeoutMs,
    );
    inspect();
  });
}

function operationOutcome(
  handle: QueryHandle<OperationState>,
  threadId: string,
): ReaderEmailOutcome | undefined {
  const operation = handle.getSnapshot().data;
  if (!operation) return;
  if (operation.status === "succeeded") {
    return {
      status: "sent",
      messageId: operation.sentMessage?.messageId ?? "",
      threadId: operation.sentMessage?.conversationId ?? threadId,
    };
  }
  if (operation.status === "failed" || operation.status === "needs_attention") {
    return {
      status: "failed",
      error: operation.error?.code ?? "发送邮件时出错",
      ownsNotification: true,
    };
  }
  if (operation.status === "uncertain") {
    return { status: "uncertain", ownsNotification: true, threadId };
  }
  if (operation.status === "blocked_auth") {
    return { status: "queued", reason: "blocked_auth", threadId };
  }
  if (operation.status === "cancelled" || operation.status === "superseded") {
    return { status: "cancelled" };
  }
}

/** Whether an outbox send came from this compose, including its resends after undo. */
export function isSendCommandFor(operationId: string, mutationId: string) {
  return (
    operationId === mutationId ||
    operationId.startsWith(`${mutationId}${RESEND_SUFFIX}`)
  );
}

const RESEND_SUFFIX = "-retry-";

function sendCommandId(mutationId: string, attempt: number) {
  return attempt === 0 ? mutationId : `${mutationId}${RESEND_SUFFIX}${attempt}`;
}
