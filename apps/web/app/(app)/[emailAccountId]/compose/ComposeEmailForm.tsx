"use client";

import {
  type EmailAttachmentMetadata,
  EMAIL_INLINE_IMAGE_MIME_TYPES,
  combineEmailHtml,
  detectInlineImageMimeType,
  finalizeEditableEmailHtml,
  prepareEmailDraft,
  validateEmailAttachmentMetadata,
} from "@inboxzero/email-editor/core";
import {
  EmailEditor,
  type EmailEditorHandle,
  type EmailEditorState,
} from "@inboxzero/email-editor/web";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  PictureInPicture2Icon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import useSWR, { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import type { GetSignatureResponse } from "@/app/api/user/signature/route";
import type { GetSendAsResponse } from "@/app/api/user/send-as/route";
import {
  findReplySendAsAddress,
  formatSendAsAddress,
  type SendAsAddress,
} from "@/utils/email/send-as";
import { ComposeContactRecipientField } from "./ComposeContactRecipientField";
import { Input } from "@/components/Input";
import { ButtonLoader } from "@/components/Loading";
import { LoadingContent } from "@/components/LoadingContent";
import { Tooltip } from "@/components/Tooltip";
import { threadScheduledEmailsKey } from "@/components/email-list/ThreadDeliveryStatus";
import {
  hideSendingDraftMessages,
  upcomingScheduledEmailsKey,
} from "@/hooks/useHiddenDraftMessageIds";
import { VoiceInput } from "@/components/voice/VoiceInput";
import { toastError, toastSuccess } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { env } from "@/env";
import { getAccountScopedKey } from "@/utils/swr";
import { useDisplayedEmail } from "@/hooks/useDisplayedEmail";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useLocalReplyDraft } from "@/hooks/useLocalReplyDraft";
import {
  DraftAutosaveHaltedError,
  useProviderDraftAutosave,
} from "@/hooks/useProviderDraftAutosave";
import {
  MailCoverageGate,
  useMailEngineDemand,
} from "@/utils/mail-engine/MailEngineHost";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import { getActiveMailClient } from "@/utils/mail-engine/active-client";
import { useReplyDraftPersistence } from "@/hooks/useReplyDraftPersistence";
import { MAIL_SHORTCUT_SCOPES } from "@/lib/shortcuts/registry";
import { ShortcutsProvider } from "@/lib/shortcuts/ShortcutsProvider";
import { useShortcuts } from "@/lib/shortcuts/useShortcuts";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import {
  updateDraftAction,
  saveComposeDraftAction,
  discardComposeDraftAction,
} from "@/utils/actions/mail";
import { scheduleEmailAction } from "@/utils/actions/scheduled-email";
import { formatRecipientNames, splitRecipientList } from "@/utils/email";
import type { StoredReplyDraft } from "@/utils/mail-engine/reply-drafts";
import {
  getDraftSessionMessageIds,
  forgetReplyDraftProvider,
  getReplyDraft,
  updateReplyDraftProviderState,
  type ReplyDraftContent,
  type ReplyDraftIdentity,
  type ReplyDraftMode,
} from "@/utils/mail-engine/reply-drafts";
import { createPreservedEmailBlocks } from "@/utils/email/preserved-blocks";
import { resolveSendDraftId } from "@/app/(app)/[emailAccountId]/compose/send-draft-reference";
import { followProviderDraftMessage } from "@/app/(app)/[emailAccountId]/compose/follow-provider-draft-message";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { stripBrandingSignatures } from "@/utils/referral/signature";
import {
  getActionErrorMessage,
  UNEXPECTED_ACTION_ERROR_MESSAGE,
} from "@/utils/error";
import { redirectToSafeUrl } from "@/utils/redirect";
import {
  type SendEmailBody,
  validateSendEmailPayloadSize,
} from "@/utils/types/mail";
import { randomUuid } from "@/utils/uuid";
import type { DraftAttachment } from "@/utils/email/types";
import { cn } from "@/utils";
import {
  type ComposeRecipientField,
  resolveComposeRecipientFields,
} from "./compose-recipients";
import { DeliveryOptions, type DeliveryOptionsHandle } from "./DeliveryOptions";
import { resolveRemoteImages } from "./resolve-remote-images";
import { useComposeSnippets } from "./useComposeSnippets";
import {
  getReminderAfterSendTimeChange,
  parseDeliveryTimes,
} from "./delivery-times";
import {
  queueReaderEmail,
  READER_EMAIL_SETTLEMENT_TIMEOUT_MS,
  waitForReaderEmailSettlement,
} from "./queued-reply";
import {
  beginUndoSend,
  finishUndoSendToast,
  UNDO_SEND_DELAY_MS,
} from "./undo-send";
import { getReplyToEmailPayload } from "./reply-to-email-payload";
import {
  enqueueDraftOperation,
  waitForDraftOperations,
} from "./draft-operation-queue";
import {
  forgetAttachedFiles,
  removeDraftAttachment,
  resolveDraftId,
  uploadDraftAttachment,
} from "./upload-draft-attachment";
import { useComposeDraftAttachments } from "./useComposeDraftAttachments";
import {
  type ComposeAttachment,
  getEditorInlineAttachments,
  mergeDraftAttachments,
  toAttachmentMetadata,
  toAttachmentReference,
} from "./compose-attachments";

export type ReplyingToEmail = {
  threadId?: string;
  headerMessageId?: string;
  messageId?: string;
  forwardedMessageId?: string;
  /**
   * 随转发一起发送的文件。它们会保留在服务商处直到发送，
   * 因此编辑器只是展示它们，并不会保存其内容。
   */
  /** 一个已打开的、已持有文件的邮箱草稿。 */
  draftHasAttachments?: boolean;
  forwardedAttachments?: Pick<
    EmailAttachmentMetadata,
    "id" | "filename" | "mimeType" | "size"
  >[];
  references?: string;
  subject: string;
  to: string;
  /**
   * 回复时使用的发件地址，按优先级排列。第一个属于用户 send-as 地址的会被使用，
   * 因此发往别名的邮件会从该别名回复。
   */
  fromHint?: string;
  cc?: string;
  bcc?: string;
  draftHtml?: string;
  quotedContentHtml?: string;
  signatureHtml?: string;
  date?: string;
};

type ComposeEmailFormProps = {
  fromAccounts?: GetEmailAccountsResponse["emailAccounts"];
  layout?: "default" | "window";
  providerDraftMessageId?: string;
  draftKeyMessageId?: string;
  draftMode?: ReplyDraftMode;
  draftSessionId?: string;
  replyingToEmail?: ReplyingToEmail;
  refetch?: () => void;
  onSuccess?: (messageId: string, threadId: string) => void;
  onMarkDone?: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onDiscard?: (draftId?: string) => boolean | Promise<boolean>;
  onPopOut?: () => void;
};

type ComposeFormValues = Omit<SendEmailBody, "attachments" | "messageHtml">;

export function ComposeEmailForm(props: ComposeEmailFormProps) {
  useMailEngineDemand();
  return (
    <MailCoverageGate>
      <ComposeEmailFormWithEngine {...props} />
    </MailCoverageGate>
  );
}

function ComposeEmailFormWithEngine(props: ComposeEmailFormProps) {
  const { emailAccountId, provider, userEmail } = useAccount();
  const [selectedEmailAccountId, setSelectedEmailAccountId] =
    useState(emailAccountId);
  const selectedAccountOverride =
    selectedEmailAccountId === emailAccountId
      ? undefined
      : selectedEmailAccountId;
  const {
    data: emailAccount,
    error,
    isLoading,
  } = useEmailAccountFull(selectedAccountOverride);
  const selectedFromAccount = props.fromAccounts?.find(
    (account) => account.id === selectedEmailAccountId,
  );
  const selectedAccountProvider =
    selectedFromAccount?.account.provider ?? provider;
  // 已加载的账号列表知道该地址，因此离线查找失败时编辑窗口仍能打开。
  const sendingAddress =
    emailAccount?.email ||
    selectedFromAccount?.email ||
    (selectedAccountOverride ? undefined : userEmail);
  // 查找失败时用户仍可撰写，只是没有签名。
  // 仅在无错误时等待，可避免重连时的重新请求把已打开的窗口变回加载中状态。
  const {
    data: composeSignature,
    error: signatureError,
    isLoading: isLoadingSignature,
  } = useSWR<GetSignatureResponse>(
    getAccountScopedKey("/api/user/signature", selectedEmailAccountId),
  );
  // 查找失败时仍像以前一样从默认地址发送。
  const {
    data: sendAs,
    error: sendAsError,
    isLoading: isLoadingSendAs,
  } = useSWR<GetSendAsResponse>(
    getAccountScopedKey("/api/user/send-as", selectedEmailAccountId),
  );

  const localDraftIdentity = props.draftSessionId
    ? {
        emailAccountId: selectedEmailAccountId,
        threadId: props.replyingToEmail?.threadId ?? props.draftSessionId,
        messageId: props.draftSessionId,
      }
    : undefined;

  const localDraft = useLocalReplyDraft(
    localDraftIdentity,
    !props.providerDraftMessageId &&
      props.draftKeyMessageId &&
      props.replyingToEmail?.threadId
      ? {
          emailAccountId: selectedEmailAccountId,
          threadId: props.replyingToEmail.threadId,
          messageId: props.draftKeyMessageId,
        }
      : undefined,
    props.draftMode,
  );
  const composeSessionKey = `${selectedEmailAccountId}:${props.replyingToEmail?.threadId ?? ""}:${props.draftSessionId ?? ""}`;
  const draftAttachments = useComposeDraftAttachments({
    emailAccountId: selectedEmailAccountId,
    sessionKey: composeSessionKey,
    storedDraft: localDraft.draft,
    loadMailboxDraft: Boolean(
      props.providerDraftMessageId &&
        props.replyingToEmail?.draftHasAttachments,
    ),
    providerDraftMessageId: props.providerDraftMessageId,
    enabled: !localDraft.isLoading,
  });
  return (
    <LoadingContent
      error={sendingAddress ? undefined : error}
      loading={
        (!sendingAddress && isLoading) ||
        localDraft.isLoading ||
        draftAttachments.isLoading ||
        (isLoadingSignature && !signatureError) ||
        (isLoadingSendAs && !sendAsError)
      }
    >
      {sendingAddress && (
        <ShortcutsProvider scopes={MAIL_SHORTCUT_SCOPES}>
          <ComposeEmailFormContent
            {...props}
            localDraftIdentity={localDraftIdentity}
            storedDraft={localDraft.draft}
            initialAttachments={draftAttachments.attachments}
            initialProviderDraftId={draftAttachments.draftId}
            initialDraftMissing={draftAttachments.draftMissing}
            draftLoadError={localDraft.error}
            accountProvider={selectedAccountProvider}
            accountSignatureHtml={composeSignature?.signatureHtml ?? ""}
            sendingAddress={sendingAddress}
            sendAsAddresses={sendAs?.addresses ?? []}
            sentWithFooterHtml={composeSignature?.footerHtml ?? ""}
            key={composeSessionKey}
            onSelectEmailAccount={setSelectedEmailAccountId}
            selectedEmailAccountId={selectedEmailAccountId}
          />
        </ShortcutsProvider>
      )}
    </LoadingContent>
  );
}

function ComposeEmailFormContent({
  layout = "default",
  draftKeyMessageId,
  providerDraftMessageId,
  draftMode,
  storedDraft,
  draftLoadError,
  replyingToEmail,
  fromAccounts,
  accountProvider,
  accountSignatureHtml,
  sendingAddress,
  sendAsAddresses,
  sentWithFooterHtml,
  selectedEmailAccountId,
  onSelectEmailAccount,
  refetch,
  onSuccess,
  onMarkDone,
  onClose,
  onRestore,
  onDiscard,
  onPopOut,
  localDraftIdentity,
  initialAttachments,
  initialProviderDraftId,
  initialDraftMissing,
}: ComposeEmailFormProps & {
  localDraftIdentity?: ReplyDraftIdentity;
  storedDraft?: StoredReplyDraft;
  initialAttachments: ComposeAttachment[];
  initialProviderDraftId?: string;
  initialDraftMissing: boolean;
  draftLoadError?: Error;
  accountProvider: string;
  accountSignatureHtml: string;
  sendingAddress: string;
  sendAsAddresses: SendAsAddress[];
  sentWithFooterHtml: string;
  selectedEmailAccountId: string;
  onSelectEmailAccount: (emailAccountId: string) => void;
}) {
  const { emailAccountId, userEmail } = useAccount();
  const { showEmail } = useDisplayedEmail();
  const isComposeWindow = layout === "window";
  const isInlineReply = Boolean(draftKeyMessageId && replyingToEmail?.threadId);
  const canScheduleDelivery = isInlineReply || isComposeWindow;
  const isNewCompose = !replyingToEmail && !providerDraftMessageId;
  const initialSendAs = findSelectableSendAs(
    replyingToEmail?.fromHint,
    sendAsAddresses,
  );
  const initialFrom = initialSendAs && formatSendAsAddress(initialSendAs);
  const { mutate } = useSWRConfig();
  const client = useOptionalMailClient() ?? getActiveMailClient();
  const [sendAt, setSendAt] = useState(storedDraft?.content?.sendAt ?? "");
  const [remindAt, setRemindAt] = useState(
    storedDraft?.content?.remindAt ?? "",
  );
  const [requestId] = useState(
    () => storedDraft?.content?.requestId ?? randomUuid(),
  );
  const deliveryPath = useRef(storedDraft?.content?.deliveryPath);
  const [submissionError, setSubmissionError] = useState(() => {
    const times = parseDeliveryTimes(sendAt, remindAt);
    return times.valid ? "" : times.error;
  });
  const editorInitialized = useRef(false);
  const providerDraftId = useRef(
    initialDraftMissing
      ? undefined
      : (storedDraft?.content?.providerDraftId ?? initialProviderDraftId),
  );
  const draftQueueKey = `${selectedEmailAccountId}:${requestId}`;

  const [initialComposer] = useState(() => {
    // 进行复制，因为恢复操作会标记编辑器所展示的内嵌图片。
    const restoredAttachments = initialAttachments.map((attachment) => ({
      ...attachment,
    }));
    if (storedDraft?.content) {
      const { draft, preservedBlocks } = storedDraft.content;
      const parsedDraft = new DOMParser().parseFromString(
        draft.editableHtml,
        "text/html",
      );
      // 保持原始形式的 HTML 会按加载时的样子原样发送，因此其 cid: 图片
      // 不能替换为本地预览。
      const images =
        draft.mode === "edited"
          ? parsedDraft.querySelectorAll(
              'img[data-content-id], img[src^="cid:"]',
            )
          : [];
      for (const image of images) {
        const contentId =
          image.getAttribute("data-content-id") ??
          image.getAttribute("src")?.slice(4);
        const attachment = restoredAttachments.find(
          (item) => item.contentId === contentId,
        );
        if (attachment && contentId) {
          // 没有预览时，图片仍会作为附件发送出去。
          image.setAttribute(
            "src",
            attachment.previewUrl ?? `cid:${contentId}`,
          );
          image.setAttribute("data-content-id", contentId);
          attachment.managed = true;
        }
      }
      return {
        draft: {
          ...draft,
          editableHtml: sentWithFooterHtml
            ? stripBrandingOutsideSignature(parsedDraft.body)
            : parsedDraft.body.innerHTML,
        },
        preservedBlocks,
        attachments: restoredAttachments,
      };
    }

    const preparedDraft = prepareEmailDraft({
      html: replyingToEmail?.draftHtml ?? "",
      quotedHtml: replyingToEmail?.quotedContentHtml,
      signatureHtml:
        replyingToEmail?.signatureHtml ??
        getSendAsSignatureHtml(initialSendAs, accountSignatureHtml) ??
        undefined,
    });
    // 页脚随签名一起移动，紧跟其后并在删除时一同删除，不会在编辑器中引入
    // 另一个区块。重新打开的草稿的签名可能已带有页脚；它会被替换。
    const draft = {
      ...preparedDraft,
      editableHtml: sentWithFooterHtml
        ? stripBrandingSignatures(preparedDraft.editableHtml)
        : preparedDraft.editableHtml,
      signatureHtml: withSentWithFooter(
        preparedDraft.signatureHtml,
        sentWithFooterHtml,
      ),
    };
    const preservedBlocks = createPreservedEmailBlocks(draft);
    return { draft, preservedBlocks, attachments: restoredAttachments };
  });
  const { draft: initialDraft, preservedBlocks } = initialComposer;
  const [activeRecipientField, setActiveRecipientField] =
    useState<ComposeRecipientField>("to");
  const pendingRecipientsRef = useRef<Record<ComposeRecipientField, string>>({
    to: "",
    cc: "",
    bcc: "",
  });
  const [contactsReconnectRequired, setContactsReconnectRequired] =
    useState(false);
  const [isReconnectingContacts, setIsReconnectingContacts] = useState(false);
  const [editReply, setEditReply] = useState(false);
  // 转发一开始没有收件人，因此聚焦到收件人。回复则已有收件人。
  const focusRecipientField = draftMode === "forward" || !replyingToEmail;
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(
    initialComposer.attachments,
  );
  // 当回复或转发把文件放到邮箱草稿后设置。此时转发的草稿会保存被转发的
  // 文件，并将其与其他文件一起列出。
  const [savedToMailbox, setSavedToMailbox] = useState(
    Boolean(providerDraftId.current),
  );
  const forwardedAttachments = savedToMailbox
    ? []
    : (replyingToEmail?.forwardedAttachments ?? []);
  const attachmentsRef = useRef<ComposeAttachment[]>(
    initialComposer.attachments,
  );
  const isMountedRef = useRef(true);
  const editorRef = useRef<EmailEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inlineReplySummaryButtonRef = useRef<HTMLButtonElement>(null);
  const collapseInlineReplyFieldsButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);
  const sendAndMarkDoneButtonRef = useRef<HTMLButtonElement>(null);
  const deliveryOptionsRef = useRef<DeliveryOptionsHandle>(null);
  const shortcutOwnerId = useId();
  const {
    register,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
  } = useForm<ComposeFormValues>({
    defaultValues: storedDraft?.content?.values
      ? {
          // 在支持 send-as 之前保存的草稿不带发件人；若留空会显示默认值，
          // 而邮箱草稿仍保留自己的发件人。
          ...storedDraft.content.values,
          from: storedDraft.content.values.from ?? initialFrom,
        }
      : {
          replyToEmail: getReplyToEmailPayload(replyingToEmail),
          subject: replyingToEmail?.subject,
          from: initialFrom,
          to: replyingToEmail?.to,
          cc: replyingToEmail?.cc,
          bcc: replyingToEmail?.bcc,
        },
  });
  const {
    onSlashKeyDown,
    onSlashTrigger,
    toolbar: snippetToolbar,
  } = useComposeSnippets({
    editorRef,
    to: watch("to"),
  });

  const lastDraftContent = useRef<ReplyDraftContent | undefined>(undefined);
  const getDraftContent = (options?: {
    sendAt?: string;
    remindAt?: string;
  }): ReplyDraftContent | undefined => {
    if (!editorRef.current)
      return lastDraftContent.current
        ? {
            ...lastDraftContent.current,
            providerDraftId: providerDraftId.current,
            attachments: attachmentsRef.current.flatMap(toAttachmentReference),
          }
        : undefined;
    const value = editorRef.current.getValue();
    const values = { ...getValues() };
    for (const field of ["to", "cc", "bcc"] as const) {
      const pending = pendingRecipientsRef.current[field].trim();
      if (pending)
        values[field] = [values[field], pending].filter(Boolean).join(", ");
    }
    const content: ReplyDraftContent = {
      providerDraftId: providerDraftId.current,
      composeMode: draftMode,
      requestId,
      deliveryPath: deliveryPath.current,
      values,
      draft: {
        ...initialDraft,
        editableHtml: value.editableHtml,
        mode: value.mode,
      },
      preservedBlocks: preservedBlocks.filter((block) =>
        value.preservedBlockIds.includes(block.id),
      ),
      attachments: attachmentsRef.current.flatMap(toAttachmentReference),
      sendAt: options?.sendAt ?? sendAt,
      remindAt: options?.remindAt ?? remindAt,
    };
    lastDraftContent.current = content;
    return content;
  };
  const {
    capture: captureLocalDraft,
    clear: clearLocalDraft,
    flush: flushDraft,
    saveError: draftSaveError,
  } = useReplyDraftPersistence({
    identity: localDraftIdentity,
    initialRevision: storedDraft?.revision,
    loadError: draftLoadError,
    getContent: getDraftContent,
  });
  const getProviderDraftContent = () => {
    const content = getDraftContent();
    if (!content) return;
    const blocks = new Set(content.preservedBlocks.map((block) => block.id));
    return {
      subject: content.values.subject ?? "",
      from: content.values.from,
      to: content.values.to ?? "",
      cc: content.values.cc ?? "",
      bcc: content.values.bcc ?? "",
      messageHtml: combineEmailHtml({
        editableHtml: finalizeEditableEmailHtml({
          html: content.draft.editableHtml,
          inlineAttachments: getEditorInlineAttachments(attachmentsRef.current),
          mode: content.draft.mode,
        }),
        signatureHtml: blocks.has("signature")
          ? content.draft.signatureHtml
          : "",
        quotedHtml: blocks.has("quote") ? content.draft.quotedHtml : "",
      }),
    };
  };

  const followDraftMessage = (messageId: string | null) =>
    followProviderDraftMessage({
      client,
      emailAccountId: selectedEmailAccountId,
      messageId,
      openedDraftMessageId: providerDraftMessageId,
      localDraft: localDraftIdentity && {
        identity: localDraftIdentity,
        requestId,
      },
    });

  // 每个带文件的编写都需要一个邮箱草稿来保存它们。新邮件也会通过自动保存
  // 获得一个；回复和转发在首次附加文件时获得。
  const ensureProviderDraft = async () => {
    if (providerDraftId.current) return providerDraftId.current;
    if (providerDraftMessageId) {
      const draftId = await resolveDraftId({
        emailAccountId: selectedEmailAccountId,
        messageId: providerDraftMessageId,
      });
      if (!draftId)
        throw new Error("无法在你的邮箱中找到此草稿。请重新打开后重试。");
      providerDraftId.current = draftId;
      return draftId;
    }
    if (!localDraftIdentity) throw new Error("保存附件需要本地草稿存储。");
    const deletedDraftId = storedDraft?.content?.providerDraftId;
    if (initialDraftMissing && deletedDraftId)
      await forgetReplyDraftProvider(localDraftIdentity, deletedDraftId);
    captureLocalDraft();
    await flushDraft();
    let draftId = await updateReplyDraftProviderState(
      localDraftIdentity,
      requestId,
    );
    let createdMessageId: string | null = null;
    if (!draftId) {
      const content = getProviderDraftContent();
      if (!content) throw new Error("此草稿尚未准备好保存。");
      const created = await saveComposeDraftAction(selectedEmailAccountId, {
        content: {
          ...content,
          replyToEmail: getReplyToEmailPayload(getValues("replyToEmail")),
        },
      });
      if (!created?.data)
        throw new Error(
          "无法确认邮箱草稿已创建。请查看 Gmail 或 Outlook 的草稿箱；你的邮件仍保存在本设备上。",
        );
      draftId = created.data.draftId;
      createdMessageId = created.data.messageId;
    }
    // 如果编辑器在邮箱同步期间关闭，也保持此引用持久化。
    providerDraftId.current = draftId;
    await updateReplyDraftProviderState(localDraftIdentity, requestId, draftId);
    if (createdMessageId) await followDraftMessage(createdMessageId);
    return draftId;
  };

  // 回复和转发即使在附加任何文件之前也会同步其文本。
  const providerAutosave = useProviderDraftAutosave({
    enabled: Boolean(providerDraftMessageId) || Boolean(localDraftIdentity),
    sessionKey: providerDraftMessageId ? undefined : draftQueueKey,
    minIntervalMs:
      attachments.length && isGoogleProvider(accountProvider)
        ? GMAIL_ATTACHMENT_DRAFT_SAVE_INTERVAL_MS
        : 0,
    getContent: getProviderDraftContent,
    save: (content) =>
      enqueueDraftOperation(draftQueueKey, async () => {
        if (!providerDraftMessageId) {
          const draftId = await ensureProviderDraft();
          const result = await saveComposeDraftAction(selectedEmailAccountId, {
            draftId,
            content,
          });
          if (!result?.data) throw new Error(getDraftSyncErrorMessage(result));
          await followDraftMessage(result.data.messageId);
          return;
        }
        const result = await updateDraftAction(selectedEmailAccountId, {
          ...content,
          draftMessageId: providerDraftMessageId,
          draftId: providerDraftId.current,
        });
        if (!result?.data) throw new Error(getDraftSyncErrorMessage(result));
        if (result.data.status === "missing")
          throw new DraftAutosaveHaltedError(
            "此草稿已在别处发送、删除或更改，因此此处的编辑不再保存到你的邮箱。",
          );
        providerDraftId.current = result.data.draftId;
        captureLocalDraft();
        await flushDraft();
        await followDraftMessage(result.data.messageId);
      }),
  });
  const { stop: stopProviderAutosave, resume: resumeProviderAutosave } =
    providerAutosave;
  const captureDraft = useCallback(
    (options?: { sendAt?: string; remindAt?: string }) => {
      captureLocalDraft(options);
      providerAutosave.capture();
    },
    [captureLocalDraft, providerAutosave.capture],
  );
  useEffect(() => {
    if (storedDraft?.content) captureDraft();
  }, [storedDraft, captureDraft]);
  useEffect(() => {
    const subscription = watch(() => captureDraft());
    return () => subscription.unsubscribe();
  }, [captureDraft, watch]);

  const updateAttachments = useCallback(
    (next: ComposeAttachment[]) => {
      attachmentsRef.current = next;
      setAttachments(next);
      captureDraft();
    },
    [captureDraft],
  );

  // 每次变更后，邮箱中的列表才是草稿上文件的准确来源。
  // 编辑器关闭后此过程仍会继续，因此本地草稿仍能记录稍后完成的上传。
  const reconcileDraftAttachments = (
    listed: DraftAttachment[],
    current = attachmentsRef.current,
  ) => updateAttachments(mergeDraftAttachments(current, listed));

  const uploadComposeAttachment = (file: File, attachment: ComposeAttachment) =>
    enqueueDraftOperation(draftQueueKey, async () => {
      const isAttached = () =>
        attachmentsRef.current.some((item) => item.id === attachment.id);
      if (!isAttached()) return;
      const draftId = await ensureProviderDraft();
      const result = await uploadDraftAttachment({
        emailAccountId: selectedEmailAccountId,
        draftId,
        file,
        attachment: toAttachmentMetadata(attachment),
      });
      await followDraftMessage(result.messageId);
      if (isAttached()) return result;
      // 上传期间被移除：把它从草稿中一并移除。
      const removed = await removeDraftAttachment({
        emailAccountId: selectedEmailAccountId,
        draftId,
        attachmentId: result.attachmentId,
      });
      await followDraftMessage(removed.messageId);
    }).then(
      (result) => {
        if (!result) return;
        setSavedToMailbox(true);
        reconcileDraftAttachments(
          result.attachments,
          attachmentsRef.current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: "uploaded",
                  draftAttachmentId: result.attachmentId,
                }
              : item,
          ),
        );
      },
      (error: unknown) => {
        const description =
          error instanceof Error
            ? error.message
            : `无法附加 ${attachment.filename}。`;
        toastError({ description });
        updateAttachments(
          attachmentsRef.current.map((item) =>
            item.id === attachment.id
              ? { ...item, status: "failed", error: description }
              : item,
          ),
        );
      },
    );

  const detachAttachment = (attachment: ComposeAttachment) => {
    revokePreview(attachment);
    updateAttachments(
      attachmentsRef.current.filter(
        (candidate) => candidate.id !== attachment.id,
      ),
    );
    forgetAttachedFiles(selectedEmailAccountId, [attachment.id]);
    const draftId = providerDraftId.current;
    const { draftAttachmentId } = attachment;
    // 仍在进行的上传在结束时会把文件从草稿中移除。
    if (attachment.status !== "uploaded" || !draftAttachmentId || !draftId)
      return;
    enqueueDraftOperation(draftQueueKey, () =>
      removeDraftAttachment({
        emailAccountId: selectedEmailAccountId,
        draftId,
        attachmentId: draftAttachmentId,
      }),
    ).then(
      async (result) => {
        await followDraftMessage(result.messageId);
        reconcileDraftAttachments(result.attachments);
      },
      (error: unknown) => {
        toastError({
          description:
            error instanceof Error
              ? error.message
              : `无法移除 ${attachment.filename}。`,
        });
        updateAttachments([
          ...attachmentsRef.current,
          { ...attachment, previewUrl: undefined, managed: false },
        ]);
      },
    );
  };

  const removeUnusedInlineAttachments = (contentIds: string[]) => {
    const referencedIds = new Set(contentIds);
    for (const attachment of attachmentsRef.current) {
      if (
        attachment.managed &&
        attachment.disposition === "inline" &&
        attachment.contentId &&
        !referencedIds.has(attachment.contentId)
      )
        detachAttachment(attachment);
    }
  };

  const handleEditorStateChange = (state: EmailEditorState) => {
    removeUnusedInlineAttachments(state.inlineContentIds);
    if (!editorInitialized.current) {
      queueMicrotask(() => {
        editorInitialized.current = true;
      });
      return;
    }
    captureDraft();
  };

  const addFiles = async (
    files: File[],
    disposition: ComposeAttachment["disposition"],
  ) => {
    if (isSubmitting) return;
    const created = files.map((file) => {
      const attachment: ComposeAttachment = {
        ...createComposeAttachmentMetadata(file, disposition),
        status: "uploading",
      };
      return { file, attachment };
    });
    const validation = validateEmailAttachmentMetadata([
      ...attachmentsRef.current.filter((item) => item.status !== "failed"),
      ...created.map(({ attachment }) => attachment),
    ]);
    if (!validation.valid) {
      toastError({ description: validation.error });
      return;
    }
    if (disposition === "inline") {
      for (const { file } of created) {
        if (!(await isInlineImageContent(file))) {
          toastError({
            description: "内嵌图片的内容与文件类型不匹配。",
          });
          return;
        }
      }
      if (!isMountedRef.current) return;
    }

    const accepted = created.filter(({ file, attachment }) => {
      if (disposition !== "inline" || !attachment.contentId) return true;
      attachment.previewUrl = URL.createObjectURL(file);
      attachment.managed = true;
      const inserted = editorRef.current?.insertInlineImage({
        alt: attachment.filename,
        contentId: attachment.contentId,
        previewUrl: attachment.previewUrl,
      });
      if (inserted) return true;
      revokePreview(attachment);
      return false;
    });
    if (accepted.length !== created.length) {
      toastError({
        description: "有一张内嵌图片无法插入。",
      });
    }
    if (!accepted.length) return;
    updateAttachments([
      ...attachmentsRef.current,
      ...accepted.map(({ attachment }) => attachment),
    ]);
    await Promise.all(
      accepted.map(({ file, attachment }) =>
        uploadComposeAttachment(file, attachment),
      ),
    );
  };

  const removeAttachment = (attachment: ComposeAttachment) => {
    // 先分离，这样由此引发的编辑器变更就找不到要移除的内容。
    detachAttachment(attachment);
    if (attachment.contentId && attachment.managed) {
      editorRef.current?.removeInlineImage(attachment.contentId);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      const previews = [...attachmentsRef.current];
      setTimeout(() => {
        if (!isMountedRef.current)
          for (const attachment of previews) revokePreview(attachment);
      }, 0);
    };
  }, []);

  const forgetAttachedComposeFiles = useCallback(
    () =>
      forgetAttachedFiles(
        selectedEmailAccountId,
        attachmentsRef.current.map((attachment) => attachment.id),
      ),
    [selectedEmailAccountId],
  );

  // 内嵌回复已显示在屏幕上，侧边栏只读取当前账号的邮件，
  // 而未保存副本的发送没有可展示的内容。
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
      const recipients = resolveComposeRecipientFields({
        selectedRecipients: {
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
        },
        pendingRecipients: pendingRecipientsRef.current,
      });
      if (!recipients.to) {
        toastError({ description: "请输入有效的收件人邮箱地址。" });
        return;
      }

      // 文件在附加时会进入邮箱草稿，因此发送会等待它们，
      // 而不会自行携带其内容。
      await waitForDraftOperations(draftQueueKey);
      const failedAttachment = attachmentsRef.current.find(
        (attachment) => attachment.status !== "uploaded",
      );
      if (failedAttachment) {
        toastError({
          description: `${failedAttachment.filename} 未附加。请在发送前移除它或重新附加。`,
        });
        return;
      }

      const editorValue = editorRef.current?.getValue() ?? {
        editableHtml: initialDraft.editableHtml,
        inlineContentIds: [],
        mode: initialDraft.mode,
        preservedBlockIds: preservedBlocks.map((block) => block.id),
      };
      const preservedBlockIds = new Set(editorValue.preservedBlockIds);
      const editableHtml = finalizeEditableEmailHtml({
        html: editorValue.editableHtml,
        inlineAttachments: getEditorInlineAttachments(attachmentsRef.current),
        mode: editorValue.mode,
      });
      const enrichedData: SendEmailBody = {
        ...data,
        ...recipients,
        replyToEmail: getReplyToEmailPayload(data.replyToEmail),
        messageHtml: combineEmailHtml({
          editableHtml,
          signatureHtml: preservedBlockIds.has("signature")
            ? initialDraft.signatureHtml
            : "",
          quotedHtml: preservedBlockIds.has("quote")
            ? initialDraft.quotedHtml
            : "",
        }),
      };
      const payloadValidation = validateSendEmailPayloadSize(enrichedData);
      if (!payloadValidation.valid) {
        toastError({ description: payloadValidation.error });
        return;
      }

      const deliveryTimes = parseDeliveryTimes(sendAt, remindAt);
      if (!deliveryTimes.valid) {
        setSubmissionError(deliveryTimes.error);
        return;
      }
      setSubmissionError("");
      await stopProviderAutosave();
      let deliveryAccepted = false;
      try {
        // 自动保存可能替换草稿的 message ID；其服务商草稿 ID 会保留。
        enrichedData.providerDraftId = await resolveSendDraftId(
          providerDraftId.current,
          localDraftIdentity,
        );
        // 邮箱草稿负责把文件送达收件人。
        if (attachmentsRef.current.length && !enrichedData.providerDraftId) {
          toastError({
            description:
              "无法在你的邮箱中找到此草稿以发送其附件。请重新打开后重试。",
          });
          return;
        }
        if (isInlineReply) {
          if (deliveryPath.current === "outbox" && (sendAt || remindAt)) {
            setSubmissionError(
              "此回复已提交到发件箱。请先查看其发送状态，再安排新的回复。",
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
        if (isScheduled) {
          const scheduledThreadId = replyingToEmail?.threadId ?? null;
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
            setSubmissionError(
              getActionErrorMessage(result ?? {}, {
                prefix: scheduledThreadId
                  ? "无法安排发送此回复"
                  : "无法安排发送此邮件",
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
              description: "回复已安排发送，但无法清除其本地草稿副本。",
            });
          }
          if (markDoneAfterSend) onMarkDone?.();
          // 没有待处理项时，已安排视图会停止轮询，因此需要主动推送这次新的
          // 发送，而不是等待刷新。此时邮件已经安排完成，所以刷新失败
          // 不能进入下面的 catch 并把发送本身报告为失败。
          await refreshScheduledEmails(
            mutate,
            selectedEmailAccountId,
            scheduledThreadId,
          );
          if (!scheduledThreadId) {
            toastSuccess({ description: "邮件已安排发送。" });
          }
          onClose?.();
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
        const online = navigator.onLine;
        if (!client) {
          setSubmissionError("邮件功能仍在启动中。请稍后再试发送。");
          toastError({
            description: "邮件功能仍在启动中。请稍后再试发送。",
          });
          return;
        }
        let outcome: Awaited<ReturnType<typeof queueReaderEmail>>;
        let showDraftAgain = () => {};
        try {
          outcome = await queueReaderEmail({
            client,
            email: enrichedData,
            mutationId: requestId,
            emailAccountId: selectedEmailAccountId,
            holdForUndo: online,
            messageIds: isNewCompose ? [] : [readerMessageId],
            providerDraftMessageIds: draftMessageIds,
            attachments: attachmentsRef.current.flatMap(toAttachmentReference),
            online,
            threadId: readerThreadId,
            onQueued: async () => {
              deliveryAccepted = true;
              showDraftAgain = hideSendingDraftMessages(
                selectedEmailAccountId,
                draftMessageIds,
              );
              if (replyingToEmail?.threadId?.trim()) {
                await mutate([
                  "thread-deliveries",
                  selectedEmailAccountId,
                  readerThreadId,
                ]).catch(() => {});
              }
              onClose?.();
            },
          });
        } catch (error) {
          console.error(error);
          const description =
            error instanceof Error
              ? error.message
              : "无法确认此回复已进入队列。请先查看会话的发送状态再重试。";
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
                ? "回复已进入队列，但无法清除其本地草稿副本。"
                : "邮件已进入队列，但无法清除其本地草稿副本。",
            });
          }
        };
        if (outcome.status === "held") {
          beginUndoSend({
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
                toastError({ description: settled.error });
              } else if (
                settled.status === "uncertain" &&
                settled.ownsNotification
              ) {
                toastError({
                  description: "此回复可能已发送。请先查看已发送文件夹再重试。",
                });
              }
            })
            .catch(() =>
              finishUndoSendToast(outcome.mutationId, { sent: false }),
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
              description: "邮件已发送！",
              action: viewSentEmail
                ? { label: "查看", onClick: viewSentEmail }
                : undefined,
            });
          }
          if (markDoneAfterSend) onMarkDone?.();
          onSuccess?.(outcome.messageId, outcome.threadId);
          refetch?.();
        } else if (outcome.status === "queued") {
          if (!isInlineReply)
            toastSuccess({
              description: getQueuedEmailDescription(outcome.reason),
            });
          if (markDoneAfterSend) onMarkDone?.();
          onClose?.();
        } else if (outcome.status === "uncertain") {
          if (outcome.ownsNotification) {
            toastError({
              description: "此回复可能已发送。请先查看已发送文件夹再重试。",
            });
          }
          onClose?.();
        } else if (outcome.status === "failed" && outcome.ownsNotification) {
          toastError({ description: outcome.error });
        }
      } catch (error) {
        console.error(error);
        setSubmissionError("无法确认是否发送成功。请在重试前查看会话状态。");
        toastError({ description: "发送邮件时出错 :(" });
      } finally {
        if (!deliveryAccepted) resumeProviderAutosave();
      }

      refetch?.();
    },
    [
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
      getViewSentEmail,
      mutate,
      onClose,
      onRestore,
      onMarkDone,
      onSuccess,
      preservedBlocks,
      providerDraftMessageId,
      refetch,
      replyingToEmail,
      selectedEmailAccountId,
    ],
  );

  const reconnectContacts = async () => {
    setIsReconnectingContacts(true);

    try {
      const oauthProvider = isMicrosoftProvider(accountProvider)
        ? "microsoft"
        : "google";
      const url = await getAccountLinkingUrl(oauthProvider, {
        reconnectEmailAccountId: selectedEmailAccountId,
      });
      redirectToSafeUrl(url, { allowExternal: true });
    } catch (error) {
      toastError({
        title: "重新连接时出错",
        description:
          error instanceof Error ? error.message : "请重试或联系支持。",
      });
      setIsReconnectingContacts(false);
    }
  };

  const updatePendingRecipient = useCallback(
    (field: ComposeRecipientField, query: string) => {
      pendingRecipientsRef.current[field] = query;
      queueMicrotask(() => {
        if (isMountedRef.current) captureDraft();
      });
    },
    [captureDraft],
  );

  const recipientFieldProps = {
    emailAccountId: selectedEmailAccountId,
    ownAddresses: [sendingAddress],
    isReconnectingContacts,
    onActivate: setActiveRecipientField,
    onReconnectContacts: reconnectContacts,
    onReconnectRequired: () => setContactsReconnectRequired(true),
    onSearchQueryChange: updatePendingRecipient,
    onSelectedRecipientsChange: (
      field: ComposeRecipientField,
      recipients: string,
    ) => setValue(field, recipients),
    reconnectRequired: contactsReconnectRequired,
  };

  const handleFileInput =
    (disposition: ComposeAttachment["disposition"]) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length) {
        addFiles(files, disposition).catch(() =>
          toastError({ description: "有一个文件无法读取。" }),
        );
      }
    };
  const selectedSendAs = findSelectableSendAs(watch("from"), sendAsAddresses);
  const showAccountPicker = Boolean(fromAccounts?.length) && !replyingToEmail;
  // Gmail 会替换为各地址自己的签名，并保留已写入的内容。
  const changeSendAs = (email: string) => {
    const address = sendAsAddresses.find((item) => item.email === email);
    if (!address) return;
    const previousSignature = getSendAsSignatureHtml(
      selectedSendAs,
      accountSignatureHtml,
    );
    const nextSignature = getSendAsSignatureHtml(address, accountSignatureHtml);
    setValue("from", formatSendAsAddress(address));
    if (nextSignature !== previousSignature)
      editorRef.current?.replaceSignature(
        withSentWithFooter(nextSignature, sentWithFooterHtml),
      );
  };
  const canCollapseInlineReplyFields =
    isInlineReply && Boolean(replyingToEmail?.to);
  const showInlineReplySummary = canCollapseInlineReplyFields && !editReply;
  const openInlineReplyFields = () => {
    setEditReply(true);
    requestAnimationFrame(() =>
      collapseInlineReplyFieldsButtonRef.current?.focus(),
    );
  };
  const closeInlineReplyFields = () => {
    setEditReply(false);
    requestAnimationFrame(() => inlineReplySummaryButtonRef.current?.focus());
  };
  const handleSendAtChange = (value: string) => {
    const nextRemindAt = getReminderAfterSendTimeChange(value, remindAt);
    setSubmissionError("");
    setSendAt(value);
    setRemindAt(nextRemindAt);
    captureDraft({ sendAt: value, remindAt: nextRemindAt });
  };
  const handleRemindAtChange = (value: string) => {
    setSubmissionError("");
    setRemindAt(value);
    captureDraft({ remindAt: value });
  };
  const handleDiscard = useCallback(async () => {
    if (!onDiscard || isSubmitting) return;
    try {
      await stopProviderAutosave();
      await waitForDraftOperations(draftQueueKey);
      // 从邮箱打开的草稿由其所有者丢弃；其他任何编写都会丢弃它所保存的
      // 邮箱草稿。
      if (!providerDraftMessageId) {
        const local = localDraftIdentity
          ? await getReplyDraft(localDraftIdentity)
          : undefined;
        providerDraftId.current =
          local?.content?.providerDraftId ?? providerDraftId.current;
        if (providerDraftId.current) {
          const result = await discardComposeDraftAction(
            selectedEmailAccountId,
            {
              draftId: providerDraftId.current,
            },
          );
          if (!result?.data)
            throw new Error(getActionErrorMessage(result ?? {}));
          await client?.requestSync([selectedEmailAccountId]);
        }
        if (
          !providerDraftId.current &&
          local?.content?.providerDraftCreationUnconfirmed
        )
          toastError({
            description:
              "本地草稿将被丢弃。邮箱中可能仍存在草稿；请查看 Gmail 或 Outlook 的草稿箱。",
          });
      }
      if ((await onDiscard(providerDraftId.current)) === false) {
        resumeProviderAutosave();
        return;
      }
      forgetAttachedComposeFiles();
      await clearLocalDraft();
    } catch (error) {
      resumeProviderAutosave();
      toastError({
        description:
          error instanceof Error ? error.message : "无法丢弃此草稿。",
      });
    }
  }, [
    clearLocalDraft,
    client,
    draftQueueKey,
    forgetAttachedComposeFiles,
    isSubmitting,
    providerDraftMessageId,
    selectedEmailAccountId,
    localDraftIdentity,
    onDiscard,
    stopProviderAutosave,
    resumeProviderAutosave,
  ]);

  // 弹出的编辑器会从本地草稿重新打开，因此如果最新编辑无法保存，
  // 就继续在此处写入。
  const handlePopOut = async () => {
    if (!onPopOut || isSubmitting) return;
    if (await flushDraft()) onPopOut();
  };
  const popOutButton = onPopOut && (
    <Tooltip shortcuts={["popOutDraft"]}>
      <Button
        aria-label="弹出草稿"
        className="ml-auto size-7 shrink-0 hover:bg-transparent"
        disabled={isSubmitting}
        onClick={handlePopOut}
        size="icon"
        type="button"
        variant="ghostMuted"
      >
        <PictureInPicture2Icon className="size-4" />
      </Button>
    </Tooltip>
  );

  useShortcuts({
    send: (event) => {
      if (
        !isShortcutForForm(event, formRef.current, shortcutOwnerId) ||
        isSubmitting
      )
        return;
      formRef.current?.requestSubmit();
    },
    sendAndMarkDone: onMarkDone
      ? (event) => {
          if (
            !isShortcutForForm(event, formRef.current, shortcutOwnerId) ||
            isSubmitting
          )
            return;
          const submitter = sendAndMarkDoneButtonRef.current;
          if (submitter) formRef.current?.requestSubmit(submitter);
        }
      : undefined,
    sendLater:
      canScheduleDelivery && !isSubmitting
        ? (event) => {
            if (isShortcutForForm(event, formRef.current, shortcutOwnerId))
              deliveryOptionsRef.current?.open("sendLater");
          }
        : undefined,
    remindMe:
      canScheduleDelivery && !isSubmitting
        ? (event) => {
            if (isShortcutForForm(event, formRef.current, shortcutOwnerId))
              deliveryOptionsRef.current?.open("remindMe");
          }
        : undefined,
    attachFiles: (event) => {
      if (
        !isShortcutForForm(event, formRef.current, shortcutOwnerId) ||
        isSubmitting
      )
        return;
      attachmentInputRef.current?.click();
    },
    popOutDraft: onPopOut
      ? (event) => {
          if (isShortcutForForm(event, formRef.current, shortcutOwnerId))
            handlePopOut();
        }
      : undefined,
    discardDraft: onDiscard
      ? (event) => {
          if (isShortcutForForm(event, formRef.current, shortcutOwnerId))
            handleDiscard();
        }
      : undefined,
  });

  return (
    <form
      data-inline-reply={isInlineReply || undefined}
      ref={formRef}
      style={
        isInlineReply && !isComposeWindow
          ? ({
              "--email-editor-content-min-height": "56px",
              "--email-editor-content-padding": "0.25rem 0",
            } as CSSProperties)
          : undefined
      }
      onSubmit={handleSubmit(onSubmit)}
      className={cn(
        isComposeWindow
          ? "flex h-full min-h-0 flex-col overflow-hidden [&_[data-email-editor-root]]:min-h-0 [&_[data-email-editor-root]]:flex-1"
          : "space-y-2",
        isInlineReply &&
          "[&_[data-email-editor-root]]:text-neutral-900 dark:[&_[data-email-editor-root]]:text-neutral-100",
        isInlineReply &&
          !isComposeWindow &&
          "space-y-2 border-t border-border pt-4",
      )}
    >
      <div className={cn(isComposeWindow ? "shrink-0 px-4 pt-3" : "contents")}>
        {showAccountPicker && (
          <div className="flex min-h-7 items-center gap-2">
            <ComposeFieldLabel htmlFor="from-account" label="发件人" />
            <Select
              value={
                selectedSendAs
                  ? `alias:${selectedSendAs.email}`
                  : `account:${selectedEmailAccountId}`
              }
              onValueChange={(value) => {
                const [kind, id] = splitFromOption(value);
                if (kind === "alias") changeSendAs(id);
                else onSelectEmailAccount(id);
              }}
            >
              <SelectTrigger
                aria-label="发件人"
                className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0 focus:ring-offset-0"
                id="from-account"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fromAccounts?.flatMap((account) =>
                  account.id === selectedEmailAccountId && selectedSendAs
                    ? sendAsAddresses.map((address) => (
                        <SelectItem
                          key={address.email}
                          value={`alias:${address.email}`}
                        >
                          {formatAddressLabel(address.name, address.email)}
                        </SelectItem>
                      ))
                    : [
                        <SelectItem
                          disabled={Boolean(account.account.disconnectedAt)}
                          key={account.id}
                          value={`account:${account.id}`}
                        >
                          {formatAddressLabel(account.name, account.email)}
                        </SelectItem>,
                      ],
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        {showInlineReplySummary ? (
          <div className="flex min-h-7 items-center gap-2">
            <button
              type="button"
              aria-expanded={false}
              ref={inlineReplySummaryButtonRef}
              onClick={openInlineReplyFields}
              className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-sm font-medium leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-emerald-600 dark:text-emerald-400">
                草稿
              </span>
              <span className="min-w-0 truncate">
                发给{" "}
                {formatRecipientNames(
                  [
                    ...splitRecipientList(
                      watch("to") ?? replyingToEmail?.to ?? "",
                    ),
                    ...splitRecipientList(
                      watch("cc") ?? replyingToEmail?.cc ?? "",
                    ),
                  ],
                  userEmail,
                ) || "收件人"}
              </span>
              {selectedSendAs && !selectedSendAs.isDefault && (
                <span className="min-w-0 truncate font-normal text-muted-foreground">
                  来自 {selectedSendAs.email}
                </span>
              )}
              <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
            </button>
            {popOutButton}
          </div>
        ) : (
          <div className="space-y-1 [&_input]:bg-transparent">
            {selectedSendAs && !showAccountPicker && (
              <div className="flex min-h-7 items-center gap-2">
                <ComposeFieldLabel htmlFor="from-address" label="发件人" />
                <Select
                  value={selectedSendAs.email}
                  onValueChange={changeSendAs}
                >
                  <SelectTrigger
                    aria-label="发件人"
                    className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0 focus:ring-offset-0"
                    id="from-address"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sendAsAddresses.map((address) => (
                      <SelectItem key={address.email} value={address.email}>
                        {formatAddressLabel(address.name, address.email)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(["to", "cc", "bcc"] as const).map((field) => (
              <div key={field} className="flex min-h-7 items-center gap-2">
                <ComposeFieldLabel
                  htmlFor={field}
                  label={RECIPIENT_LABELS[field]}
                />
                <div className="min-w-0 flex-1">
                  {env.NEXT_PUBLIC_CONTACTS_ENABLED ||
                  client?.queryContactSuggestions ? (
                    <ComposeContactRecipientField
                      {...recipientFieldProps}
                      active={activeRecipientField === field}
                      autoFocus={field === "to" && focusRecipientField}
                      className="min-h-8"
                      name={field}
                      selectedRecipients={watch(field) ?? ""}
                    />
                  ) : (
                    <Input
                      type="text"
                      name={field}
                      registerProps={{
                        ...register(field, { required: field === "to" }),
                        autoFocus: field === "to" && focusRecipientField,
                      }}
                      error={errors[field]}
                      className="h-7 rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus:border-transparent focus:ring-0 sm:text-sm"
                    />
                  )}
                </div>
                {field === "to" && canCollapseInlineReplyFields && (
                  <button
                    type="button"
                    aria-label="隐藏收件人"
                    ref={collapseInlineReplyFieldsButtonRef}
                    onClick={closeInlineReplyFields}
                    className="rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDownIcon className="size-3 rotate-180" />
                  </button>
                )}
                {field === "to" && popOutButton}
              </div>
            ))}
            <div className="pt-3">
              <Input
                type="text"
                name="subject"
                registerProps={register("subject", { required: true })}
                error={errors.subject}
                placeholder="主题"
                className="h-8 rounded-none border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none focus:border-transparent focus:ring-0 sm:text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <EmailEditor
        placeholder={isInlineReply ? "" : undefined}
        appearance={isComposeWindow || isInlineReply ? "seamless" : "contained"}
        autofocus={!focusRecipientField}
        onSlashKeyDown={onSlashKeyDown}
        onSlashTrigger={onSlashTrigger}
        ref={editorRef}
        initialHtml={initialDraft.editableHtml}
        mode={initialDraft.mode}
        onStateChange={handleEditorStateChange}
        onImageFiles={(files) => {
          addFiles(files, "inline").catch(() =>
            toastError({ description: "无法读取该图片。" }),
          );
        }}
        preservedBlocks={preservedBlocks}
        resolveRemoteImages={resolveRemoteImages}
      />

      {submissionError && (
        <p
          role="alert"
          className={cn(
            "text-destructive text-sm",
            isComposeWindow && "shrink-0 px-4",
          )}
        >
          {submissionError}
        </p>
      )}
      {!!(attachments.length || forwardedAttachments.length) && (
        <ul
          aria-label="附件"
          className={cn(
            "flex flex-wrap gap-2",
            isComposeWindow && "shrink-0 px-4 py-2",
          )}
        >
          {forwardedAttachments.map((attachment) => (
            <li
              className="flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs"
              key={attachment.id}
              title="来自你转发的邮件"
            >
              <PaperclipIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="max-w-52 truncate">{attachment.filename}</span>
              <span className="text-muted-foreground">
                {formatFileSize(attachment.size)}
              </span>
            </li>
          ))}
          {attachments.map((attachment) => (
            <li
              aria-busy={attachment.status === "uploading" || undefined}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs",
                attachment.status === "failed" &&
                  "border-destructive/50 text-destructive",
              )}
              key={attachment.id}
              title={attachment.error}
            >
              <AttachmentIcon attachment={attachment} />
              <span className="max-w-52 truncate">{attachment.filename}</span>
              <span className="text-muted-foreground">
                {ATTACHMENT_STATUS_LABELS[attachment.status] ??
                  formatFileSize(attachment.size)}
              </span>
              <button
                aria-label={`移除 ${attachment.filename}`}
                className="rounded-sm p-0.5 hover:bg-muted"
                onClick={() => removeAttachment(attachment)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2",
          isComposeWindow && "shrink-0 px-4 py-2",
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          <Tooltip
            shortcuts={onMarkDone ? ["send", "sendAndMarkDone"] : ["send"]}
          >
            <Button disabled={isSubmitting} type="submit" variant="gradient">
              {isSubmitting && <ButtonLoader />}
              发送
            </Button>
          </Tooltip>
          <button
            aria-hidden
            hidden
            ref={sendAndMarkDoneButtonRef}
            tabIndex={-1}
            type="submit"
          />
          {canScheduleDelivery && (
            <DeliveryOptions
              ref={deliveryOptionsRef}
              sendAt={sendAt}
              remindAt={remindAt}
              disabled={isSubmitting}
              onSendAtChange={handleSendAtChange}
              onRemindAtChange={handleRemindAtChange}
              shortcutOwnerId={shortcutOwnerId}
            />
          )}
        </div>

        <div className="flex items-center gap-0.5 text-muted-foreground">
          {snippetToolbar}
          <VoiceInput
            onInsert={(text) => {
              editorRef.current?.insertText(
                text.endsWith(" ") ? text : `${text} `,
              );
            }}
            onSend={(text) => {
              editorRef.current?.insertText(
                text.endsWith(" ") ? text : `${text} `,
              );
            }}
          />
          <input
            className="hidden"
            data-testid="compose-attachments-input"
            multiple
            onChange={handleFileInput("attachment")}
            ref={attachmentInputRef}
            type="file"
          />
          <Tooltip shortcuts={["attachFiles"]}>
            <Button
              aria-label="附加文件"
              className="hover:bg-transparent"
              disabled={isSubmitting}
              onClick={() => attachmentInputRef.current?.click()}
              size="icon"
              type="button"
              variant="ghostMuted"
            >
              <PaperclipIcon className="size-4" />
            </Button>
          </Tooltip>
          <input
            accept={EMAIL_INLINE_IMAGE_MIME_TYPES.join(",")}
            className="hidden"
            data-testid="compose-inline-image-input"
            multiple
            onChange={handleFileInput("inline")}
            ref={inlineImageInputRef}
            type="file"
          />
          <Button
            aria-label="插入内嵌图片"
            className="hover:bg-transparent"
            disabled={isSubmitting}
            onClick={() => inlineImageInputRef.current?.click()}
            size="icon"
            type="button"
            variant="ghostMuted"
          >
            <ImageIcon className="size-4" />
          </Button>
          {onDiscard && (
            <Tooltip shortcuts={["discardDraft"]}>
              <Button
                aria-label="丢弃草稿"
                className="hover:bg-transparent"
                disabled={isSubmitting}
                onClick={handleDiscard}
                size="icon"
                type="button"
                variant="ghostMuted"
              >
                <TrashIcon className="size-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      {providerAutosave.error && (
        <p role="alert" className="text-xs text-destructive">
          {providerAutosave.error}
        </p>
      )}
      {localDraftIdentity && draftSaveError && (
        <p role="alert" className="text-xs text-destructive">
          {draftSaveError}
        </p>
      )}
    </form>
  );
}

// Gmail 每次保存都会重建整封邮件，包括文件。
const GMAIL_ATTACHMENT_DRAFT_SAVE_INTERVAL_MS = 15_000;

const ATTACHMENT_STATUS_LABELS: Partial<
  Record<ComposeAttachment["status"], string>
> = {
  uploading: "上传中…",
  failed: "未附加",
};

const DRAFT_SYNC_FAILED_MESSAGE =
  "无法将此草稿同步到你的邮箱。它已保存在本设备上，我们会继续重试。";

const RECIPIENT_LABELS: Record<ComposeRecipientField, string> = {
  to: "收件人",
  cc: "抄送",
  bcc: "密送",
};

function createComposeAttachmentMetadata(
  file: File,
  disposition: ComposeAttachment["disposition"],
): EmailAttachmentMetadata {
  const id = randomUuid();
  return {
    id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    disposition,
    ...(disposition === "inline"
      ? {
          contentId: `${id}@inboxzero.local`,
        }
      : {}),
  };
}

async function isInlineImageContent(file: File) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  let binary = "";
  for (const byte of header) binary += String.fromCharCode(byte);
  return detectInlineImageMimeType(btoa(binary)) === file.type;
}

function revokePreview(attachment: ComposeAttachment) {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

function AttachmentIcon({ attachment }: { attachment: ComposeAttachment }) {
  if (attachment.status === "uploading")
    return (
      <Loader2Icon aria-hidden className="size-3.5 shrink-0 animate-spin" />
    );
  if (attachment.status === "failed")
    return <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />;
  if (attachment.disposition === "inline")
    return <ImageIcon aria-hidden className="size-3.5 shrink-0" />;
  return <PaperclipIcon aria-hidden className="size-3.5 shrink-0" />;
}

function ComposeFieldLabel({
  htmlFor,
  label,
}: {
  htmlFor: string;
  label: string;
}) {
  return (
    <label
      className="w-12 shrink-0 text-sm font-medium leading-5 text-foreground"
      htmlFor={htmlFor}
    >
      {label}
    </label>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getQueuedEmailDescription(
  reason: "offline" | "pending" | "blocked_auth",
) {
  if (reason === "offline") {
    return "邮件已进入队列。你重新联网后它会发送。";
  }
  if (reason === "blocked_auth") {
    return "邮件已进入队列。重新连接此账号后即可发送。";
  }
  return "邮件已进入队列，将在后台持续发送。";
}

function isShortcutForForm(
  event: KeyboardEvent | undefined,
  form: HTMLFormElement | null,
  shortcutOwnerId: string,
) {
  if (!(event?.target instanceof Node)) return false;
  if (form?.contains(event.target)) return true;
  if (!(event.target instanceof Element)) return false;

  return (
    event.target
      .closest("[data-compose-shortcut-owner]")
      ?.getAttribute("data-compose-shortcut-owner") === shortcutOwnerId
  );
}

/**
 * SWR 的 `mutate` 在重新验证请求失败时会 reject。这些刷新在
 * 发送已安排完成后运行，因此失败只意味着数据过期，而不是发送失败，
 * 绝不能将其呈现为发送失败。
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

// 意外的服务器失败通常是暂时的，自动保存会重试，因此使用安抚性的文案。
// 具体的拒绝原因（草稿已在别处发送或删除、会话过期）则按原样展示。
function getDraftSyncErrorMessage(
  result: { serverError?: string } | undefined,
) {
  const message = getActionErrorMessage(
    result ?? {},
    DRAFT_SYNC_FAILED_MESSAGE,
  );
  return message === UNEXPECTED_ACTION_ERROR_MESSAGE
    ? DRAFT_SYNC_FAILED_MESSAGE
    : message;
}

// 编辑器签名内的页脚属于签名本身；只移除正文其他位置的品牌信息。
function stripBrandingOutsideSignature(body: HTMLElement) {
  const signature = body.querySelector(":scope > [data-smartmail]");
  if (!signature) return stripBrandingSignatures(body.innerHTML);
  const placeholder = document.createComment("signature");
  signature.replaceWith(placeholder);
  const html = stripBrandingSignatures(body.innerHTML);
  // 使用函数替换器可保留签名中的 "$" 序列原样。
  return html.replace("<!--signature-->", () => signature.outerHTML);
}

// 只有带别名的账号才会选择地址；其余账号继续不指定地址发送，
// 由服务商应用其默认值。
function findSelectableSendAs(
  candidates: string | undefined,
  addresses: SendAsAddress[],
) {
  if (addresses.length < 2) return;
  return findReplySendAsAddress(candidates, addresses);
}

// 默认地址保留在 Inbox Zero 中设置的签名；别名在服务商提供自己的签名时
// 使用其签名。
function getSendAsSignatureHtml(
  address: SendAsAddress | undefined,
  accountSignatureHtml: string,
) {
  if (address && !address.isDefault && address.signature)
    return address.signature;
  return accountSignatureHtml;
}

function withSentWithFooter(signatureHtml: string, footerHtml: string) {
  return [stripBrandingSignatures(signatureHtml.trim()), footerHtml]
    .filter(Boolean)
    .join("<br>");
}

function formatAddressLabel(name: string | null | undefined, email: string) {
  return name ? `${name} (${email})` : email;
}

function splitFromOption(value: string) {
  const separator = value.indexOf(":");
  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}
