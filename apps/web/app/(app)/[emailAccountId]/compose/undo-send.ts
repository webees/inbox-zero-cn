import { toast } from "sonner";
import { toastError, toastSuccess, toastUndo } from "@/components/Toast";
import { getShortcutHint } from "@/lib/shortcuts/registry";
import type { MailClient } from "@inboxzero/mail-core/engine";
import type { OperationStatus } from "@inboxzero/mail-core/operations";

export const UNDO_SEND_DELAY_MS = 10_000;
const UNDO_SEND_TOAST_ID = "undo-send";
const SENT_MESSAGE = "邮件已发送！";
const SENT_TOAST_DURATION_MS = 6000;
// 服务器在发送执行或验证期间会一直持有该发送，因此撤销入口会保持可用，
// 直到发送离开该状态或时间窗口结束。
const UNDOABLE_STATUSES = new Set<OperationStatus>([
  "preparing",
  "queued",
  "executing",
  "verifying",
  "retry_wait",
]);

type PendingUndoSend = {
  client: MailClient;
  operationId: string;
  emailAccountId: string;
  restoreComposer: () => void;
  undone: boolean;
  release: () => void;
  toastId: string;
};

let pending: PendingUndoSend | null = null;

export function getUndoSendHoldUntil(online: boolean, now = Date.now()) {
  return online ? now + UNDO_SEND_DELAY_MS : undefined;
}

export function beginUndoSend({
  client,
  operationId,
  emailAccountId,
  restoreComposer,
  holdUntil,
}: {
  client: MailClient;
  operationId: string;
  emailAccountId: string;
  restoreComposer: () => void;
  holdUntil: number;
}) {
  const duration = holdUntil - Date.now();
  if (duration <= 0) return;
  releasePreviousOffer();
  const handle = client.observeOperation({
    accountId: emailAccountId,
    operationId,
  });
  let unsubscribe = () => {};
  const toastId = undoSendToastId(operationId);
  const current: PendingUndoSend = {
    client,
    operationId,
    emailAccountId,
    restoreComposer,
    undone: false,
    toastId,
    release: () => {
      clearTimeout(timeout);
      unsubscribe();
      handle.close();
    },
  };
  const timeout = setTimeout(() => clearUndoSendOffer(current), duration);
  pending = current;
  const inspect = () => {
    if (pending !== current || current.undone) return;
    const status = handle.getSnapshot().data?.status;
    if (status && !UNDOABLE_STATUSES.has(status)) clearUndoSendOffer(current);
  };
  unsubscribe = handle.subscribe(inspect);
  toastUndo({
    id: toastId,
    message: SENT_MESSAGE,
    shortcut: getShortcutHint("undo"),
    duration,
    // 一个已被关闭的 toast 仍可能在其退出动画期间触发，
    // 此时新的发送可能已经接管。
    onUndo: async () => {
      if (pending === current) await undoPendingSend();
    },
  });
  inspect();
}

/** 确认已发出的发送，在可展示时提供“查看”，否则关闭 toast。 */
export function finishUndoSendToast(
  operationId: string,
  outcome: { sent: false } | { sent: true; onView: (() => void) | null },
) {
  const toastId = undoSendToastId(operationId);
  if (!outcome.sent) {
    toast.dismiss(toastId);
    return;
  }
  toastSuccess({
    id: toastId,
    description: SENT_MESSAGE,
    duration: SENT_TOAST_DURATION_MS,
    action: outcome.onView
      ? { label: "查看", onClick: outcome.onView }
      : undefined,
  });
}

export async function undoPendingSend() {
  const current = pending;
  if (!current || current.undone) return false;
  current.undone = true;
  const result = await current.client.cancelOperation({
    accountId: current.emailAccountId,
    operationId: current.operationId,
  });
  if (result.status === "unavailable") {
    // 发送仍被持有，因此用户可以在时间窗口内重试。
    current.undone = false;
    toastError({
      description: "无法连接服务器以撤销。请重试。",
    });
    return false;
  }
  if (pending === current) {
    pending = null;
    current.release();
  }
  toast.dismiss(current.toastId);
  if (result.status !== "cancelled") {
    current.undone = false;
    toastError({
      description:
        result.status === "too_late"
          ? "撤销为时已晚。此邮件已发送。"
          : "无法撤销发送",
    });
    return false;
  }
  current.restoreComposer();
  return true;
}

function releasePreviousOffer() {
  const previous = pending;
  if (!previous) return;
  previous.undone = true;
  pending = null;
  previous.release();
  toast.dismiss(previous.toastId);
}

function clearUndoSendOffer(offer: PendingUndoSend) {
  if (pending !== offer || offer.undone) return;
  pending = null;
  offer.release();
  // Stays up without undo until finishUndoSendToast reports the outcome, so
  // the toast doesn't vanish and reappear when the send goes out.
  toastSuccess({
    id: offer.toastId,
    description: SENT_MESSAGE,
    duration: Number.POSITIVE_INFINITY,
  });
}

function undoSendToastId(operationId: string) {
  return `${UNDO_SEND_TOAST_ID}:${operationId}`;
}
