"use client";

import { useCallback, useEffect, useRef } from "react";
import { format } from "date-fns";
import groupBy from "lodash/groupBy";
import { toast } from "sonner";
import { toastUndo } from "@/components/Toast";
import { getShortcutHint } from "@/lib/shortcuts/registry";
import { randomUuid } from "@/utils/uuid";
import {
  getListThreadEmailAccountId,
  getListThreadKey,
  getListThreadMessageIds,
  type ListThread,
} from "./types";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import {
  mutationPayloadToChange,
  type ThreadMutationPayload,
} from "@/utils/mail-engine/mutation-change";
import { submitConversationChanges } from "@/utils/mail-engine/submit-conversations";
import { admissionRejectionCopy } from "@/utils/mail-engine/admission-notice";

type UndoableAction = "archive" | "unarchive" | "trash";

type ThreadSnapshot = {
  emailAccountId: string;
  key: string;
  messageIds: string[];
  mutationId: string;
  threadId: string;
};

export type ThreadActionTarget = Omit<ThreadSnapshot, "mutationId">;

type UndoableBatch = {
  action: UndoableAction;
  snapshots: ThreadSnapshot[];
  undone: boolean;
};

export function useThreadActions({
  emailAccountId,
  onRestore,
  readerTarget,
  threads,
}: {
  emailAccountId: string;
  onRestore?: (targets: ThreadActionTarget[]) => void;
  readerTarget?: ThreadActionTarget;
  threads: ListThread[];
}) {
  const lastAction = useRef<UndoableBatch | null>(null);
  const retainedEmailAccountId = useRef(emailAccountId);
  const listTargetsByKey = useRef(new Map<string, ThreadActionTarget>());
  const activeReaderTarget = useRef<ThreadActionTarget | undefined>(undefined);
  const client = useOptionalMailClient();
  useEffect(() => {
    if (retainedEmailAccountId.current !== emailAccountId) {
      retainedEmailAccountId.current = emailAccountId;
      listTargetsByKey.current.clear();
      lastAction.current = null;
    }
    activeReaderTarget.current = readerTarget?.messageIds.length
      ? readerTarget
      : undefined;
    for (const thread of threads) {
      const messageIds = [...new Set(getListThreadMessageIds(thread))];
      if (!messageIds.length) continue;
      const key = getListThreadKey(thread);
      listTargetsByKey.current.set(key, {
        emailAccountId: getListThreadEmailAccountId(thread, emailAccountId),
        key,
        messageIds,
        threadId: thread.id,
      });
    }
  }, [emailAccountId, readerTarget, threads]);

  const resolveTargets = useCallback(
    (threadKeys: string[]) =>
      threadKeys
        .map((key) => {
          const listTarget = listTargetsByKey.current.get(key);
          if (listTarget) return listTarget;
          return activeReaderTarget.current?.key === key
            ? activeReaderTarget.current
            : undefined;
        })
        .filter((target): target is ThreadActionTarget => Boolean(target)),
    [],
  );

  const enqueueTargets = useCallback(
    async (
      targets: ReturnType<typeof resolveTargets>,
      payload: ThreadMutationPayload,
    ) => {
      if (!targets.length || !client) {
        return { snapshots: [], rejectionCodes: [] };
      }
      const change = mutationPayloadToChange(payload);
      if (!change) return { snapshots: [], rejectionCodes: [] };
      const snapshots: ThreadSnapshot[] = [];
      const rejectionCodes: string[] = [];
      for (const [accountId, accountTargets] of Object.entries(
        groupBy(targets, (target) => target.emailAccountId),
      )) {
        const result = await submitConversationChanges({
          accountId,
          change,
          client,
          conversationIds: accountTargets.map((target) => target.threadId),
        });
        rejectionCodes.push(...result.rejectionCodes);
        const commandIds = new Map(
          result.accepted.map((item) => [item.conversationId, item.commandId]),
        );
        for (const target of accountTargets) {
          const mutationId = commandIds.get(target.threadId);
          if (mutationId) snapshots.push({ ...target, mutationId });
        }
      }
      return { snapshots, rejectionCodes };
    },
    [client],
  );

  const undoBatch = useCallback(
    async (batch: UndoableBatch) => {
      if (batch.undone || !client) return [];
      batch.undone = true;
      if (lastAction.current === batch) lastAction.current = null;

      const compensation = mutationPayloadToChange({
        kind: UNDOABLE_COPY[batch.action].compensation,
      });
      if (!compensation) return [];
      const results = await Promise.allSettled(
        Object.values(
          groupBy(batch.snapshots, (snapshot) => snapshot.mutationId),
        ).map(async (snapshots) => {
          const { emailAccountId, mutationId } = snapshots[0];
          const cancelled =
            (
              await client.cancelOperation({
                accountId: emailAccountId,
                operationId: mutationId,
              })
            ).status === "cancelled";
          if (!cancelled) {
            const diagnostics = await client.getDiagnostics(emailAccountId);
            const admission = await client.submitConversations({
              accountId: emailAccountId,
              commandId: randomUuid(),
              conversations: snapshots.map((snapshot) => ({
                accountId: emailAccountId,
                conversationId: snapshot.threadId,
              })),
              change: compensation,
              observedRevision: diagnostics.revision,
            });
            if (admission.status === "rejected") {
              throw new Error(admission.code);
            }
          }
          return snapshots.map((snapshot) => snapshot.key);
        }),
      );
      const restoredKeys = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const failedCount = batch.snapshots.length - restoredKeys.length;

      if (restoredKeys.length) {
        toast.success(
          restoredKeys.length === 1
            ? "已恢复 1 个会话"
            : `已恢复 ${restoredKeys.length} 个会话`,
        );
        const restored = new Set(restoredKeys);
        onRestore?.(
          batch.snapshots.filter((snapshot) => restored.has(snapshot.key)),
        );
      }
      if (failedCount) {
        toast.error(
          failedCount === batch.snapshots.length
            ? "无法恢复"
            : `无法恢复 ${batch.snapshots.length} 个会话中的 ${failedCount} 个`,
        );
      }
      if (!restoredKeys.length) {
        batch.undone = false;
        lastAction.current = batch;
      }
      return restoredKeys;
    },
    [client, onRestore],
  );

  const undo = useCallback(async () => {
    const batch = lastAction.current;
    return batch ? undoBatch(batch) : [];
  }, [undoBatch]);

  const runUndoable = useCallback(
    async (action: UndoableAction, threadKeys: string[]) => {
      const targets = resolveTargets(threadKeys);
      const { snapshots, rejectionCodes } = await enqueueTargets(targets, {
        kind: action,
      });
      if (!snapshots.length) {
        if (threadKeys.length) {
          toast.error(
            enqueueFailureCopy(
              `无法排队${UNDOABLE_COPY[action].noun}`,
              rejectionCodes,
            ),
          );
        }
        return [];
      }

      const batch: UndoableBatch = { action, snapshots, undone: false };
      lastAction.current = batch;
      const failedCount = threadKeys.length - snapshots.length;
      toastUndo({
        message: UNDOABLE_COPY[action].done(snapshots.length),
        shortcut: getShortcutHint("undo"),
        onUndo: () => {
          undoBatch(batch);
        },
      });
      if (failedCount) {
        toast.error(
          enqueueFailureCopy(
            `无法排队${UNDOABLE_COPY[action].noun}：${threadKeys.length} 个会话中有 ${failedCount} 个失败`,
            rejectionCodes,
          ),
        );
      }
      return snapshots.map((snapshot) => snapshot.key);
    },
    [enqueueTargets, resolveTargets, undoBatch],
  );

  const setReadState = useCallback(
    async (threadKeys: string[], read: boolean, notifySuccess = true) => {
      const targets = resolveTargets(threadKeys);
      const { snapshots, rejectionCodes } = await enqueueTargets(targets, {
        kind: "set_read_state",
        read,
      });
      const failedCount = threadKeys.length - snapshots.length;
      if (snapshots.length && notifySuccess) {
        toast.success(
          snapshots.length === 1
            ? `已标记为${read ? "已读" : "未读"}`
            : `已将 ${snapshots.length} 个会话标记为${read ? "已读" : "未读"}`,
        );
      }
      if (failedCount) {
        toast.error(
          enqueueFailureCopy(
            failedCount === threadKeys.length
              ? `无法排队标记为${read ? "已读" : "未读"}`
              : `无法将 ${threadKeys.length} 个会话中的 ${failedCount} 个标记为${read ? "已读" : "未读"}`,
            rejectionCodes,
          ),
        );
      }
      return snapshots.map((snapshot) => snapshot.key);
    },
    [enqueueTargets, resolveTargets],
  );

  const setStarredState = useCallback(
    async (threadKeys: string[], starred: boolean) => {
      const { snapshots, rejectionCodes } = await enqueueTargets(
        resolveTargets(threadKeys),
        {
          kind: "set_starred_state",
          starred,
        },
      );
      if (snapshots.length < threadKeys.length) {
        toast.error(
          enqueueFailureCopy("无法更新所有会话的星标", rejectionCodes),
        );
      }
      return snapshots.map((snapshot) => snapshot.key);
    },
    [enqueueTargets, resolveTargets],
  );

  const snooze = useCallback(
    async (threadKeys: string[], snoozedUntil: Date) => {
      const targets = resolveTargets(threadKeys);
      const { snapshots, rejectionCodes } = await enqueueTargets(targets, {
        kind: "snooze",
        scheduledFor: snoozedUntil.toISOString(),
      });
      const failedCount = threadKeys.length - snapshots.length;
      if (snapshots.length) {
        toast.success(
          snapshots.length === 1
            ? `已推迟至 ${format(snoozedUntil, "EEE, MMM d 'at' p")}`
            : `已推迟 ${snapshots.length} 个会话`,
        );
      }
      if (failedCount) {
        toast.error(
          enqueueFailureCopy(
            failedCount === threadKeys.length
              ? threadKeys.length === 1
                ? "无法排队推迟"
                : "无法排队推迟会话"
              : `无法排队推迟：${threadKeys.length} 个会话中有 ${failedCount} 个失败`,
            rejectionCodes,
          ),
        );
      }
      return snapshots.map((snapshot) => snapshot.key);
    },
    [enqueueTargets, resolveTargets],
  );

  const markSpam = useCallback(
    async (threadKeys: string[]) => {
      const targets = resolveTargets(threadKeys);
      const { snapshots, rejectionCodes } = await enqueueTargets(targets, {
        kind: "spam",
      });
      const failedCount = threadKeys.length - snapshots.length;
      if (snapshots.length) {
        toast.success(
          snapshots.length === 1
            ? "已标记为垃圾邮件"
            : `已将 ${snapshots.length} 个会话标记为垃圾邮件`,
        );
      }
      if (failedCount) {
        toast.error(
          enqueueFailureCopy(
            failedCount === threadKeys.length
              ? "无法排队标记为垃圾邮件"
              : `无法将 ${threadKeys.length} 个会话中的 ${failedCount} 个标记为垃圾邮件`,
            rejectionCodes,
          ),
        );
      }
      return snapshots.map((snapshot) => snapshot.key);
    },
    [enqueueTargets, resolveTargets],
  );

  return {
    archive: useCallback(
      (threadKeys: string[]) => runUndoable("archive", threadKeys),
      [runUndoable],
    ),
    moveToInbox: useCallback(
      (threadKeys: string[]) => runUndoable("unarchive", threadKeys),
      [runUndoable],
    ),
    trash: useCallback(
      (threadKeys: string[]) => runUndoable("trash", threadKeys),
      [runUndoable],
    ),
    markRead: useCallback(
      (threadKeys: string[]) => setReadState(threadKeys, true, false),
      [setReadState],
    ),
    markSpam,
    setReadState,
    setStarredState,
    snooze,
    undo,
  };
}

const UNDOABLE_COPY: Record<
  UndoableAction,
  {
    compensation: "archive" | "unarchive" | "untrash";
    done: (count: number) => string;
    noun: string;
  }
> = {
  archive: {
    compensation: "unarchive",
    done: (count) =>
      count === 1 ? "已归档 1 个会话" : `已归档 ${count} 个会话`,
    noun: "归档",
  },
  unarchive: {
    compensation: "archive",
    done: (count) =>
      count === 1 ? "已移至收件箱" : `已将 ${count} 个会话移至收件箱`,
    noun: "移至收件箱",
  },
  trash: {
    compensation: "untrash",
    done: (count) =>
      count === 1 ? "已删除 1 个会话" : `已删除 ${count} 个会话`,
    noun: "删除",
  },
};

function enqueueFailureCopy(generic: string, rejectionCodes: string[]) {
  return admissionRejectionCopy(rejectionCodes[0]) ?? generic;
}
