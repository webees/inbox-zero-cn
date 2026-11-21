import type { EmailEditorHandle } from "@inboxzero/email-editor/web";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { MailClient } from "@inboxzero/mail-core/engine";
import { type RefObject, useCallback, useRef, useState } from "react";
import type { SubmitHandler } from "react-hook-form";
import { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";
import type { ScheduledEmailsResponse } from "@/app/api/user/scheduled-emails/route";
import {
  threadScheduledEmailsKey,
  UNCONFIRMED_SCHEDULED_EMAIL_PREFIX,
} from "@/components/email-list/ThreadDeliveryStatus";
import { toastError, toastSuccess } from "@/components/Toast";
import { useDisplayedEmail } from "@/hooks/useDisplayedEmail";
import {
  hideSendingDraftMessages,
  upcomingScheduledEmailsKey,
} from "@/hooks/useHiddenDraftMessageIds";
import { useAccount } from "@/providers/EmailAccountProvider";
import { scheduleEmailAction } from "@/utils/actions/scheduled-email";
import { publishOutgoingInlineImages } from "@/utils/email/outgoing-inline-images";
import { getActionErrorMessage } from "@/utils/error";
import {
  getDraftSessionMessageIds,
  getReplyDraft,
  type ReplyDraftIdentity,
} from "@/utils/mail-engine/reply-drafts";
import {
  type SendEmailBody,
  validateSendEmailPayloadSize,
} from "@/utils/types/mail";
import type { ComposeFormValues, ReplyingToEmail } from "./ComposeEmailForm";
import { toAttachmentReference } from "./compose-attachments";
import { buildComposeMessageHtml } from "./compose-message-html";
import {
  type ComposeRecipientField,
  resolveComposeRecipientFields,
} from "./compose-recipients";
import { parseDeliveryTimes } from "./delivery-times";
import {
  hasPendingDraftOperations,
  waitForDraftOperations,
} from "./draft-operation-queue";
import type { createInitialComposeContent } from "./initial-compose-content";
import {
  queueReaderEmail,
  READER_EMAIL_SETTLEMENT_TIMEOUT_MS,
  waitForReaderEmailSettlement,
} from "./queued-reply";
import { getReplyToEmailPayload } from "./reply-to-email-payload";
import { resolveSendDraftId } from "./send-draft-reference";
import { getComposeErrorMessage } from "./compose-error-messages";
import {
  getEditableText,
  getSendWarnings,
  type SendWarning,
} from "./send-warnings";
import {
  beginUndoSend,
  finishUndoSendToast,
  UNDO_SEND_DELAY_MS,
} from "./undo-send";
import type { useComposeDraft } from "./useComposeDraft";

export function useComposeSend({
  draft,
  initialComposer,
  emailAccountId: selectedEmailAccountId,
  client,
  editorRef,
  formRef,
  sendAndMarkDoneButtonRef,
  pendingRecipientsRef,
  forwardedAttachmentCount,
  sendAt,
  remindAt,
  setSubmissionError,
  isInlineReply,
  canScheduleDelivery,
  replyingToEmail,
  draftKeyMessageId,
  providerDraftMessageId,
  localDraftIdentity,
  refetch,
  onSuccess,
  onMarkDone,
  onSubmitting,
  onClose,
  onRestore,
}: {
  draft: ReturnType<typeof useComposeDraft>;
  initialComposer: ReturnType<typeof createInitialComposeContent>;
  emailAccountId: string;
  client: MailClient | null;
  editorRef: RefObject<EmailEditorHandle | null>;
  formRef: RefObject<HTMLFormElement | null>;
  sendAndMarkDoneButtonRef: RefObject<HTMLButtonElement | null>;
  pendingRecipientsRef: RefObject<Record<ComposeRecipientField, string>>;
  forwardedAttachmentCount: number;
  sendAt: string;
  remindAt: string;
  setSubmissionError: (error: string) => void;
  isInlineReply: boolean;
  canScheduleDelivery: boolean;
  replyingToEmail?: ReplyingToEmail;
  draftKeyMessageId?: string;
  providerDraftMessageId?: string;
  localDraftIdentity?: ReplyDraftIdentity;
  refetch?: () => void;
  onSuccess?: (messageId: string, threadId: string) => void;
  onMarkDone?: () => void;
  onSubmitting?: (operationId: string) => () => void;
  /** Given the send's operation id when the email was queued to the outbox. */
  onClose?: (queuedOperationId?: string) => void;
  onRestore?: () => void;
}) {
  const { t, i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const { showEmail } = useDisplayedEmail();
  const { mutate } = useSWRConfig();
  const {
    requestId,
    deliveryPath,
    providerDraftId,
    draftQueueKey,
    attachmentsRef,
    captureDraft,
    flushDraft,
    clearLocalDraft,
    stopProviderAutosave,
    resumeProviderAutosave,
    forgetAttachedComposeFiles,
  } = draft;
  const { draft: initialDraft, preservedBlocks } = initialComposer;
  const isNewCompose = !replyingToEmail && !providerDraftMessageId;
  const [sendWarnings, setSendWarnings] = useState<SendWarning[]>([]);
  const skipSendWarningsRef = useRef(false);
  const warnedSubmitterRef = useRef<HTMLElement | null>(null);

  // An inline reply is already on screen, the side panel only reads the
  // current account's mail, and a send without a stored copy has nothing to show.
  const getViewSentEmail = useCallback(
    (messageId: string, threadId: string) =>
      isInlineReply || selectedEmailAccountId !== emailAccountId || !messageId
        ? null
        : () => showEmail({ threadId, messageId }),
    [emailAccountId, isInlineReply, selectedEmailAccountId, showEmail],
  );

  const onSubmit: SubmitHandler<ComposeFormValues> = useCallback(
    async (data, event) => {
      const submitter = (event?.nativeEvent as SubmitEvent | undefined)
        ?.submitter;
      const markDoneAfterSend = submitter === sendAndMarkDoneButtonRef.current;
      const skipSendWarnings = skipSendWarningsRef.current;
      skipSendWarningsRef.current = false;
      const recipients = resolveComposeRecipientFields({
        selectedRecipients: {
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
        },
        pendingRecipients: pendingRecipientsRef.current,
      });
      if (!recipients.to) {
        toastError({ description: t`请输入有效的收件人邮箱地址。` });
        return;
      }

      // 附件在添加时会进入邮箱草稿，因此发送需要等待它们完成，
      // 自身不会携带这些文件内容。
      if (attachmentsRef.current.length)
        await waitForDraftOperations(draftQueueKey);
      const failedAttachment = attachmentsRef.current.find(
        (attachment) => attachment.status !== "uploaded",
      );
      if (failedAttachment) {
        toastError({
          description: t`${failedAttachment.filename} 尚未附加。发送前请移除它或重新附加。`,
        });
        return;
      }

      const editorValue = editorRef.current?.getValue() ?? {
        editableHtml: initialDraft.editableHtml,
        inlineContentIds: [],
        mode: initialDraft.mode,
        preservedBlockIds: preservedBlocks.map((block) => block.id),
      };
      const { editableHtml, messageHtml } = buildComposeMessageHtml({
        draft: {
          ...initialDraft,
          editableHtml: editorValue.editableHtml,
          mode: editorValue.mode,
        },
        preservedBlockIds: editorValue.preservedBlockIds,
        attachments: attachmentsRef.current,
      });
      const enrichedData: SendEmailBody = {
        ...data,
        subject: data.subject ?? "",
        ...recipients,
        replyToEmail: getReplyToEmailPayload(data.replyToEmail),
        messageHtml,
      };
      const payloadValidation = validateSendEmailPayloadSize(enrichedData);
      if (!payloadValidation.valid) {
        toastError({ description: payloadValidation.error });
        return;
      }

      const deliveryTimes = parseDeliveryTimes(sendAt, remindAt);
      if (!deliveryTimes.valid) {
        setSubmissionError(i18n._(deliveryTimes.error));
        return;
      }

      if (!skipSendWarnings) {
        const warnings = getSendWarnings({
          text: getEditableText(editableHtml),
          hasAttachments:
            attachmentsRef.current.length > 0 || forwardedAttachmentCount > 0,
        });
        if (warnings.length) {
          warnedSubmitterRef.current = submitter ?? null;
          setSendWarnings(warnings);
          return;
        }
      }
      setSubmissionError("");
      // 只读取一次：是否等待草稿与是否暂留以便撤销必须保持一致。
      const online = navigator.onLine;
      // 已经发往邮箱的草稿保存会让发送多等一个往返。因此发送会携带自己的内容，
      // 送达后服务器会移除该会话的草稿，包括保存随后新建的草稿。若通过草稿发送，
      // 迟到的保存可能覆盖最终正文（specs/compose-send.qnt）。
      const replacesSavingDraft =
        hasPendingDraftOperations(draftQueueKey) &&
        attachmentsRef.current.length === 0 &&
        !providerDraftMessageId &&
        Boolean(localDraftIdentity) &&
        online &&
        !sendAt &&
        !remindAt &&
        deliveryPath.current !== "scheduled";
      const draftSaveSettled = stopProviderAutosave().then(() =>
        waitForDraftOperations(draftQueueKey),
      );
      // 定时发送由服务器确认，因此编辑器会立即关闭并在会话中显示正在定时发送；
      // 若被拒绝则会重新打开编辑器。
      const schedulesAtOnce =
        Boolean(deliveryTimes.sendAt) &&
        (isInlineReply
          ? deliveryPath.current !== "outbox"
          : canScheduleDelivery);
      const scheduledThreadId = replyingToEmail?.threadId ?? null;
      let withdrawSchedule = () => {};
      let sessionDraftIds: string[] = [];
      if (schedulesAtOnce) {
        // 否则回复的邮箱草稿会在服务器确认前显示在会话中；这些 ID 从本设备读取。
        sessionDraftIds = providerDraftMessageId
          ? getDraftSessionMessageIds(
              selectedEmailAccountId,
              providerDraftMessageId,
            )
          : localDraftIdentity
            ? ((await getReplyDraft(localDraftIdentity))?.content
                ?.providerDraftMessageIds ?? [])
            : [];
        const showSessionDrafts = hideSendingDraftMessages(
          selectedEmailAccountId,
          sessionDraftIds,
        );
        const withdrawRow = showScheduledEmail(
          mutate,
          selectedEmailAccountId,
          scheduledThreadId,
          {
            id: `${UNCONFIRMED_SCHEDULED_EMAIL_PREFIX}${requestId}`,
            sendAt: deliveryTimes.sendAt,
            remindAt: deliveryTimes.remindAt,
          },
        );
        withdrawSchedule = () => {
          withdrawRow();
          showSessionDrafts();
        };
        if (!scheduledThreadId)
          toastSuccess({ description: t`邮件已定时发送。` });
        onClose?.();
      }
      const failSchedule = (description: string) => {
        withdrawSchedule();
        setSubmissionError(description);
        if (!schedulesAtOnce) return;
        toastError({ description });
        onRestore?.();
      };
      if (!replacesSavingDraft) await draftSaveSettled;
      let deliveryAccepted = false;
      try {
        // 自动保存可能替换草稿的消息 ID；其服务商草稿 ID 会保留。
        if (replacesSavingDraft)
          enrichedData.replacesDraftOfSession = requestId;
        enrichedData.providerDraftId = replacesSavingDraft
          ? undefined
          : await resolveSendDraftId(
              providerDraftId.current,
              localDraftIdentity,
            );
        // 邮箱草稿负责将文件送达收件人。
        if (attachmentsRef.current.length && !enrichedData.providerDraftId) {
          const description = t`无法在邮箱中找到此草稿以发送其附件。请重新打开后重试。`;
          if (schedulesAtOnce) failSchedule(description);
          else toastError({ description });
          return;
        }
        if (isInlineReply) {
          if (deliveryPath.current === "outbox" && (sendAt || remindAt)) {
            setSubmissionError(
              t`此回复已提交到发件箱。安排新的回复前请检查其发送状态。`,
            );
            return;
          }
          deliveryPath.current ??= sendAt || remindAt ? "scheduled" : "outbox";
        }
        captureDraft();
        await flushDraft();
        const draftMessageIds = providerDraftMessageId
          ? getDraftSessionMessageIds(
              selectedEmailAccountId,
              providerDraftMessageId,
            )
          : localDraftIdentity
            ? ((await getReplyDraft(localDraftIdentity))?.content
                ?.providerDraftMessageIds ?? [])
            : [];
        const isScheduled = isInlineReply
          ? deliveryPath.current === "scheduled"
          : canScheduleDelivery && Boolean(sendAt || remindAt);
        if (schedulesAtOnce) {
          // 期间完成的保存可能已添加草稿消息。
          const showLaterDrafts = hideSendingDraftMessages(
            selectedEmailAccountId,
            draftMessageIds.filter((id) => !sessionDraftIds.includes(id)),
          );
          const withdrawEarlier = withdrawSchedule;
          withdrawSchedule = () => {
            withdrawEarlier();
            showLaterDrafts();
          };
        }
        if (isScheduled) {
          const result = await scheduleEmailAction(selectedEmailAccountId, {
            clientMutationId: requestId,
            threadId: scheduledThreadId,
            messageIds: draftKeyMessageId ? [draftKeyMessageId] : [],
            email: enrichedData,
            draftMessageIds: draftMessageIds.slice(-50),
            sendAt: deliveryTimes.sendAt,
            remindAt: deliveryTimes.remindAt,
          });
          if (!result?.data) {
            failSchedule(
              getActionErrorMessage(result ?? {}, {
                prefix: scheduledThreadId
                  ? t`无法安排此回复的定时发送`
                  : t`无法安排此邮件的定时发送`,
              }),
            );
            return;
          }
          deliveryAccepted = true;
          forgetAttachedComposeFiles();
          try {
            await clearLocalDraft();
          } catch {
            toastError({
              description: t`回复已定时发送，但无法清除其本地草稿副本。`,
            });
          }
          if (markDoneAfterSend) onMarkDone?.();
          // 定时发送视图在没有待处理项后会停止轮询，因此需要主动推送新的发送，
          // 而不是等待刷新。此时邮件已定时发送，刷新失败不能进入下方的 catch
          // 并把发送本身报告为失败。
          await refreshScheduledEmails(
            mutate,
            selectedEmailAccountId,
            scheduledThreadId,
          );
          if (!schedulesAtOnce) {
            if (!scheduledThreadId)
              toastSuccess({ description: t`邮件已定时发送。` });
            onClose?.();
          }
          refetch?.();
          return;
        }
        const readerThreadId =
          replyingToEmail?.threadId?.trim() ||
          localDraftIdentity?.threadId ||
          requestId;
        const readerMessageId =
          (isInlineReply ? draftKeyMessageId : replyingToEmail?.messageId) ??
          localDraftIdentity?.messageId ??
          requestId;
        if (!client) {
          setSubmissionError(t`邮件服务仍在启动中。请稍后重试发送。`);
          toastError({
            description: t`邮件服务仍在启动中。请稍后重试发送。`,
          });
          return;
        }
        let outcome: Awaited<ReturnType<typeof queueReaderEmail>>;
        let showSentDrafts = () => {};
        let showSavedDraft = () => {};
        let draftShownAgain = false;
        const showDraftAgain = () => {
          draftShownAgain = true;
          showSentDrafts();
          showSavedDraft();
        };
        try {
          const attachments = attachmentsRef.current;
          outcome = await queueReaderEmail({
            client,
            email: enrichedData,
            mutationId: requestId,
            emailAccountId: selectedEmailAccountId,
            holdForUndo: online,
            messageIds: isNewCompose ? [] : [readerMessageId],
            providerDraftMessageIds: draftMessageIds,
            attachments: attachments.flatMap(toAttachmentReference),
            online,
            threadId: readerThreadId,
            onSubmitting: (operationId) => {
              publishOutgoingInlineImages(
                selectedEmailAccountId,
                operationId,
                attachments,
              );
              return onSubmitting?.(operationId) ?? (() => {});
            },
            onQueued: async (operationId) => {
              deliveryAccepted = true;
              showSentDrafts = hideSendingDraftMessages(
                selectedEmailAccountId,
                draftMessageIds,
              );
              if (replacesSavingDraft && localDraftIdentity) {
                // 保存可能为草稿添加发送尚未看到的消息。
                draftSaveSettled
                  .then(() => getReplyDraft(localDraftIdentity))
                  .then((saved) => {
                    // 保存完成前的撤销操作已将其交还。
                    if (draftShownAgain) return;
                    showSavedDraft = hideSendingDraftMessages(
                      selectedEmailAccountId,
                      (saved?.content?.providerDraftMessageIds ?? []).filter(
                        (id) => !draftMessageIds.includes(id),
                      ),
                    );
                  })
                  .catch(() => {});
              }
              if (replyingToEmail?.threadId?.trim()) {
                mutate([
                  "thread-deliveries",
                  selectedEmailAccountId,
                  readerThreadId,
                ]).catch(() => {});
              }
              onClose?.(operationId);
            },
          });
        } catch (error) {
          // biome-ignore lint/suspicious/noConsole: send failures stay visible in the browser console
          console.error(error);
          const description = getComposeErrorMessage(
            error,
            i18n,
            t`无法确认此回复已加入队列。重试前请检查会话的发送状态。`,
          );
          showDraftAgain();
          setSubmissionError(description);
          toastError({ description });
          return;
        }
        const discardLocalDraft = async () => {
          forgetAttachedComposeFiles();
          try {
            await clearLocalDraft();
          } catch {
            toastError({
              description: isInlineReply
                ? t`回复已加入队列，但无法清除其本地草稿副本。`
                : t`邮件已加入队列，但无法清除其本地草稿副本。`,
            });
          }
        };
        if (outcome.status === "held") {
          beginUndoSend({
            i18n,
            client,
            operationId: outcome.mutationId,
            emailAccountId: selectedEmailAccountId,
            holdUntil: outcome.holdUntil,
            restoreComposer: () => onRestore?.(),
          });
          waitForReaderEmailSettlement({
            client,
            accountId: selectedEmailAccountId,
            mutationId: outcome.mutationId,
            settlementTimeoutMs:
              UNDO_SEND_DELAY_MS + READER_EMAIL_SETTLEMENT_TIMEOUT_MS,
            threadId: outcome.threadId,
          })
            .then(async (settled) => {
              finishUndoSendToast(
                outcome.mutationId,
                settled.status === "sent"
                  ? {
                      sent: true,
                      onView: getViewSentEmail(
                        settled.messageId,
                        settled.threadId,
                      ),
                    }
                  : { sent: false },
                i18n,
              );
              if (settled.status === "cancelled" || settled.status === "failed")
                showDraftAgain();
              if (settled.status === "cancelled") return;
              await discardLocalDraft();
              if (settled.status === "sent") {
                if (markDoneAfterSend) onMarkDone?.();
                onSuccess?.(settled.messageId, settled.threadId);
                refetch?.();
                return;
              }
              if (settled.status === "failed" && settled.ownsNotification) {
                toastError({
                  description: getComposeErrorMessage(settled.error, i18n),
                });
              } else if (
                settled.status === "uncertain" &&
                settled.ownsNotification
              ) {
                toastError({
                  description: t`This reply may have been sent. Check Sent before retrying.`,
                });
              }
            })
            .catch(() =>
              finishUndoSendToast(outcome.mutationId, { sent: false }, i18n),
            );
          return;
        }
        if (outcome.status === "failed" || outcome.status === "cancelled")
          showDraftAgain();
        await discardLocalDraft();
        if (outcome.status === "sent") {
          if (!isInlineReply) {
            const viewSentEmail = getViewSentEmail(
              outcome.messageId,
              outcome.threadId,
            );
            toastSuccess({
              description: t`Email sent!`,
              action: viewSentEmail
                ? { label: t`View`, onClick: viewSentEmail }
                : undefined,
            });
          }
          if (markDoneAfterSend) onMarkDone?.();
          onSuccess?.(outcome.messageId, outcome.threadId);
          refetch?.();
        } else if (outcome.status === "queued") {
          if (!isInlineReply)
            toastSuccess({
              description: i18n._(getQueuedEmailDescription(outcome.reason)),
            });
          if (markDoneAfterSend) onMarkDone?.();
          onClose?.();
        } else if (outcome.status === "uncertain") {
          if (outcome.ownsNotification) {
            toastError({
              description: t`This reply may have been sent. Check Sent before retrying.`,
            });
          }
          onClose?.();
        } else if (outcome.status === "failed" && outcome.ownsNotification) {
          toastError({
            description: getComposeErrorMessage(outcome.error, i18n),
          });
        }
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: send failures stay visible in the browser console
        console.error(error);
        if (schedulesAtOnce) {
          failSchedule(
            t`Could not schedule this email. Check the thread status before trying again.`,
          );
          return;
        }
        setSubmissionError(
          t`Could not confirm delivery. Check the thread status before trying again.`,
        );
        toastError({ description: t`There was an error sending the email :(` });
      } finally {
        if (!deliveryAccepted) resumeProviderAutosave();
      }

      refetch?.();
    },
    [
      attachmentsRef,
      deliveryPath,
      providerDraftId,
      stopProviderAutosave,
      resumeProviderAutosave,
      canScheduleDelivery,
      initialDraft,
      isInlineReply,
      isNewCompose,
      localDraftIdentity,
      sendAt,
      remindAt,
      requestId,
      draftKeyMessageId,
      draftQueueKey,
      captureDraft,
      clearLocalDraft,
      client,
      flushDraft,
      forgetAttachedComposeFiles,
      forwardedAttachmentCount,
      getViewSentEmail,
      mutate,
      onClose,
      onRestore,
      onMarkDone,
      onSubmitting,
      onSuccess,
      preservedBlocks,
      providerDraftMessageId,
      refetch,
      replyingToEmail,
      selectedEmailAccountId,
      editorRef,
      pendingRecipientsRef,
      sendAndMarkDoneButtonRef,
      setSubmissionError,
      t,
      i18n,
    ],
  );

  const sendDespiteWarnings = useCallback(() => {
    skipSendWarningsRef.current = true;
    setSendWarnings([]);
    formRef.current?.requestSubmit(warnedSubmitterRef.current);
  }, [formRef]);

  return {
    onSubmit,
    sendWarnings,
    dismissSendWarnings: () => setSendWarnings([]),
    sendDespiteWarnings,
  };
}

function getQueuedEmailDescription(
  reason: "offline" | "pending" | "blocked_auth",
) {
  if (reason === "offline") {
    return msg`Email queued. It will send when you're back online.`;
  }
  if (reason === "blocked_auth") {
    return msg`Email queued. Reconnect this account to send it.`;
  }
  return msg`Email queued and will keep sending in the background.`;
}

/**
 * SWR's `mutate` rejects when the revalidation request fails. These refreshes
 * run after the send is already scheduled, so a failure is stale data, not a
 * failed send, and must never surface as one.
 */
async function refreshScheduledEmails(
  mutate: ScopedMutator,
  emailAccountId: string,
  threadId: string | null,
) {
  const keys = [
    upcomingScheduledEmailsKey(emailAccountId),
    ...(threadId ? [threadScheduledEmailsKey(emailAccountId, threadId)] : []),
  ];
  await Promise.all(keys.map((key) => mutate(key).catch(() => {})));
}

/**
 * Shows a scheduled email in its thread before the server confirms it. The
 * server's row replaces it on the next refresh; the returned function takes
 * it back out if scheduling fails.
 */
function showScheduledEmail(
  mutate: ScopedMutator,
  emailAccountId: string,
  threadId: string | null,
  pending: { id: string; sendAt: string | null; remindAt: string | null },
) {
  if (!threadId || !pending.sendAt) return () => {};
  const key = threadScheduledEmailsKey(emailAccountId, threadId);
  const row: ScheduledEmailsResponse["scheduledEmails"][number] = {
    id: pending.id,
    status: "PENDING",
    sendAt: new Date(pending.sendAt),
    remindAt: pending.remindAt ? new Date(pending.remindAt) : null,
    reminderStatus: pending.remindAt ? "PENDING" : "NONE",
    sentAt: null,
    error: null,
    draftMessageIds: [],
  };
  mutate<ScheduledEmailsResponse>(
    key,
    (current) => ({
      scheduledEmails: [row, ...(current?.scheduledEmails ?? [])],
    }),
    { revalidate: false },
  );
  return () => {
    mutate<ScheduledEmailsResponse>(
      key,
      (current) => ({
        scheduledEmails: (current?.scheduledEmails ?? []).filter(
          (scheduled) => scheduled.id !== row.id,
        ),
      }),
      { revalidate: false },
    );
  };
}
