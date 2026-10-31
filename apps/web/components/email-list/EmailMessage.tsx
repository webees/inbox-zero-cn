import { CalendarInvitation } from "@/components/email-list/CalendarInvitation";
import { isCalendarInvitationMessage } from "@/utils/calendar/invitations/detection";
import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useAction } from "next-safe-action/hooks";
import {
  ForwardIcon,
  ReplyAllIcon,
  ReplyIcon,
  ChevronsUpDownIcon,
  ChevronsDownUpIcon,
  UserSearchIcon,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  extractEmailAddress,
  extractNameFromEmail,
  formatRecipientNames,
  getInitials,
  isSameEmailAddress,
  splitRecipientList,
} from "@/utils/email";
import { formatShortDate } from "@/utils/date";
import { ComposeEmailFormLazy } from "@/app/(app)/[emailAccountId]/compose/ComposeEmailFormLazy";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ParsedMessage } from "@/utils/types";
import { forwardEmailHtml, forwardEmailSubject } from "@/utils/gmail/forward";
import { extractDraftComposerContent } from "@/utils/parse/extract-reply.client";
import type { ReplyingToEmail } from "@/app/(app)/[emailAccountId]/compose/ComposeEmailForm";
import { createReplyContent } from "@/utils/gmail/reply";
import { cn } from "@/utils";
import { decodeSnippet } from "@/utils/gmail/decode";
import { GmailLabel } from "@/utils/gmail/label";
import { deleteDraftAction } from "@/utils/actions/mail";
import type { ThreadMessage } from "@/components/email-list/types";
import { EmailDetails } from "@/components/email-list/EmailDetails";
import { HtmlEmail, PlainEmail } from "@/components/email-list/EmailContents";
import { EmailAttachments } from "@/components/email-list/EmailAttachments";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useComposeModal } from "@/providers/ComposeModalProvider";
import { formatReplySubject } from "@/utils/email/subject";
import { buildReplyAllRecipients, formatCcList } from "@/utils/email/reply-all";
import { isTypingTarget } from "@/lib/shortcuts/registry";
import { useContactPhoto } from "@/hooks/useContactPhoto";
import { toastError } from "@/components/Toast";
import { LoadingMiniSpinner } from "@/components/Loading";
import { getActionErrorMessage } from "@/utils/error";
import {
  getDraftSessionMessageId,
  getReplyDraftSessionId,
  type ReplyDraftMode,
} from "@/utils/mail-engine/reply-drafts";
import {
  SentMessageOpenStatus,
  type SentMessageOpenState,
} from "@/components/email-list/SentMessageOpenStatus";
import {
  getMessageTranslation,
  useThreadTranslation,
  useTranslateThread,
} from "@/app/(app)/[emailAccountId]/mail/use-thread-translation";

type ComposeSession = { id: number; mode: ReplyDraftMode };

export function EmailMessage({
  message,
  bodyAvailable = true,
  missingBodyIds,
  menu,
  refetch,
  showReplyButton,
  defaultComposeMode,
  hideComposer,
  onStartCompose,
  draftMessages,
  expanded,
  onToggle,
  onExpand,
  onSendSuccess,
  onMarkDone,
  onDraftDiscarded,
  onOpenSenderContext,
  hasDraft = false,
  selected,
  onSelect,
  onNavigateMessage,
  sentMessageOpen,
  replyAnchor,
  composerSessionMessageId,
  onReplySent,
  concealSentReply,
  awaitSentReply,
  sendOperationId,
  concealed,
}: {
  message: ThreadMessage;
  bodyAvailable?: boolean;
  missingBodyIds?: Set<string>;
  menu?: React.ReactNode;
  draftMessages?: ThreadMessage[];
  refetch: () => void;
  showReplyButton: boolean;
  defaultComposeMode?: ReplyDraftMode;
  hideComposer?: boolean;
  onStartCompose?: () => void;
  expanded: boolean;
  /** 会话只有一条消息且永不折叠时不存在。 */
  onToggle?: () => void;
  /**
   * 编辑器打开后保持消息展开。否则新到的消息会将其折叠，
   * 隐藏正在撰写的回复。
   */
  onExpand?: () => void;
  onSendSuccess: (messageId: string, threadId: string) => void;
  onMarkDone?: () => void;
  /**
   * 此消息中显示的已保存草稿已被丢弃。仅由丢弃草稿会清空会话的
   * 父组件接入。
   */
  onDraftDiscarded?: () => void;
  onOpenSenderContext?: (message: ThreadMessage) => void;
  hasDraft?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onNavigateMessage?: (direction: -1 | 1) => void;
  sentMessageOpen?: SentMessageOpenState;
  /** 对于服务商尚未发出的回复：这条消息要回复到的会话。 */
  replyAnchor?: ThreadMessage;
  /** 当这条消息的 ID 在其下方发生变化时，保留编辑器的草稿。 */
  composerSessionMessageId?: string;
  /** 这条消息的回复或转发刚刚离开编辑器。 */
  onReplySent?: () => void;
  /** 发送的消息一到达会话就隐藏，赶在其编辑器交接之前。 */
  concealSentReply?: (operationId: string) => () => void;
  /**
   * 当排队发送的消息在会话中就绪后完成，使其编辑器可以一直保持到那时，
   * 而不是留下空档。
   */
  awaitSentReply?: (operationId: string) => Promise<void>;
  /** 这条消息所属的发送操作，在其发送中或同步后可用。 */
  sendOperationId?: string;
  /** 已布局但不可见，使其正文在替换发送它的编辑器之前加载。 */
  concealed?: boolean;
}) {
  const { emailAccountId } = useAccount();
  const { poppedOutDraftSessionId } = useComposeModal();
  const threadTranslation = useThreadTranslation(
    emailAccountId,
    message.threadId,
  );
  const translation = getMessageTranslation(threadTranslation, message.id);
  const showTranslation = Boolean(translation && !translation.showOriginal);
  // `null` 跟随 `defaultComposeMode`，而阅读器的“回复”按钮会在这条消息挂载很久后才切换它。
  const [composeOverride, setComposeOverride] = useState<
    ReplyDraftMode | "closed" | null
  >(null);
  const composeMode = hideComposer
    ? undefined
    : resolveComposeMode(
        composeOverride,
        defaultComposeMode,
        (mode) =>
          getReplyDraftSessionId(
            composerSessionMessageId ?? message.id,
            mode,
          ) === poppedOutDraftSessionId,
      );
  const serverDrafts = (draftMessages ?? []).map((draft) => ({
    message: draft,
    sessionMessageId: getDraftSessionMessageId(emailAccountId, draft.id),
  }));
  const [dismissedDraftIds, setDismissedDraftIds] = useState(
    () => new Set<string>(),
  );
  const setDraftDismissed = useCallback(
    (sessionMessageId: string, dismissed: boolean) => {
      setDismissedDraftIds((previous) => {
        if (previous.has(sessionMessageId) === dismissed) return previous;
        const next = new Set(previous);
        if (dismissed) next.add(sessionMessageId);
        else next.delete(sessionMessageId);
        return next;
      });
    },
    [],
  );
  const visibleDrafts = serverDrafts.filter(
    (draft) =>
      !dismissedDraftIds.has(draft.sessionMessageId) &&
      getReplyDraftSessionId(draft.sessionMessageId, "reply") !==
        poppedOutDraftSessionId,
  );
  // 新回复的自动保存可能在线程得知打开的编辑器已保存它之前，就作为邮箱
  // 草稿同步回来。一旦打开，新回复会保留该编辑器，而不会在句中替换成
  // 那份副本。
  const [newReplyOpen, setNewReplyOpen] = useState(false);
  const isNewReply =
    composeMode === "reply" && (newReplyOpen || visibleDrafts.length === 0);
  if (isNewReply !== newReplyOpen) setNewReplyOpen(isNewReply);
  const shownDrafts = isNewReply ? [] : visibleDrafts;
  const composingMailboxReply = composeMode === "reply" && !isNewReply;
  const isDraftRow = serverDrafts.some(
    (draft) => draft.message.id === message.id,
  );
  const hasOpenComposer = Boolean(composeMode) || visibleDrafts.length > 0;

  const [showDetails, setShowDetails] = useState(false);
  const composeSessionRef = useRef(0);
  const messageRef = useRef<HTMLLIElement>(null);

  // 回复应引用的选区，以及引用它的编辑器：按会话关联的已保存草稿，
  // 未设置时为新的回复。
  const [pendingQuote, setPendingQuote] = useState<{
    text: string;
    draftSessionMessageId?: string;
  }>();
  const clearPendingQuote = useCallback(() => setPendingQuote(undefined), []);
  const [replyAll, setReplyAll] = useState(false);

  const onReply = useCallback(
    (quote?: string) => {
      onStartCompose?.();
      composeSessionRef.current += 1;
      setReplyAll(false);
      const savedDraft = serverDrafts[0];
      setPendingQuote(
        quote
          ? { text: quote, draftSessionMessageId: savedDraft?.sessionMessageId }
          : undefined,
      );
      if (savedDraft) {
        setDraftDismissed(savedDraft.sessionMessageId, false);
        setComposeOverride("closed");
        requestAnimationFrame(() => {
          messageRef.current
            ?.querySelector<HTMLElement>("[data-email-editor-content]")
            ?.focus();
        });
      } else {
        setComposeOverride("reply");
      }
      onExpand?.();
    },
    [onExpand, onStartCompose, serverDrafts, setDraftDismissed],
  );
  const onReplyAll = useCallback(() => {
    onReply();
    setReplyAll(true);
  }, [onReply]);
  const onForward = useCallback(() => {
    onStartCompose?.();
    composeSessionRef.current += 1;
    setComposeOverride("forward");
    onExpand?.();
  }, [onExpand, onStartCompose]);

  const onCloseCompose = useCallback(() => {
    setComposeOverride("closed");
    setPendingQuote(undefined);
  }, []);
  const closeMailboxDraft = (sessionMessageId: string) => {
    setPendingQuote(undefined);
    if (composeMode === "reply") onCloseCompose();
    setDraftDismissed(sessionMessageId, true);
  };
  const [composerKey, setComposerKey] = useState(0);
  const undoSendSessionRef = useRef<ComposeSession | null>(null);

  const onStartDiscard = useCallback((): ComposeSession | undefined => {
    if (!composeMode) return;
    const composeSession = {
      id: composeSessionRef.current,
      mode: composeMode,
    };
    onCloseCompose();
    return composeSession;
  }, [composeMode, onCloseCompose]);

  const onRestoreCompose = useCallback((composeSession: ComposeSession) => {
    if (composeSessionRef.current !== composeSession.id) return;
    composeSessionRef.current += 1;
    setComposeOverride(composeSession.mode);
  }, []);
  const onCloseComposeAfterSend = useCallback(() => {
    if (composeMode) {
      undoSendSessionRef.current = {
        id: composeSessionRef.current,
        mode: composeMode,
      };
    }
    onCloseCompose();
  }, [composeMode, onCloseCompose]);
  const onRestoreComposeAfterSend = useCallback(() => {
    const session = undoSendSessionRef.current;
    if (!session) return;
    composeSessionRef.current += 1;
    setComposerKey((key) => key + 1);
    setComposeOverride(session.mode);
  }, []);

  const toggleDetails = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDetails((prev) => !prev);
  }, []);

  const onMessageKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (
        event.target !== event.currentTarget ||
        (event.key !== "Enter" && event.key !== " ")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter" && expanded && showReplyButton) {
        onReply(getSelectedText(event.currentTarget));
      } else {
        onToggle?.();
      }
    },
    [expanded, onReply, onToggle, showReplyButton],
  );

  return (
    <li
      ref={messageRef}
      data-thread-message-id={message.id}
      data-send-operation-id={sendOperationId}
      data-selected={selected}
      aria-hidden={concealed || undefined}
      tabIndex={selected !== undefined || hasOpenComposer ? -1 : undefined}
      aria-current={selected || undefined}
      onFocusCapture={onSelect}
      onClickCapture={onSelect}
      onKeyDown={onMessageKeyDown}
      onKeyDownCapture={(event) => {
        // 在富文本编辑器消费 Escape 前处理草稿。
        if (
          hasOpenComposer &&
          event.key === "Escape" &&
          !event.defaultPrevented &&
          isTypingTarget(event.target) &&
          event.target instanceof Element &&
          event.target.closest('[data-inline-reply="true"]') &&
          !event.target.closest(
            '[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"][aria-expanded="true"]',
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      className={cn(
        // 两种状态下内边距保持一致，展开时标题不会位移。会话跟踪选区时
        // 会绘制滑动选择条；否则由获得焦点的卡片自行绘制。
        "group/message relative min-w-0 rounded bg-card px-3 py-2.5 outline-none transition-colors sm:px-4",
        selected === undefined &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l before:bg-primary before:opacity-0 focus-within:before:opacity-100",
        concealed && "invisible absolute inset-x-0",
        !expanded && "hover:bg-muted/40",
      )}
    >
      <MessageHeader
        expanded={expanded}
        message={message}
        menu={menu}
        onForward={onForward}
        onOpenSenderContext={onOpenSenderContext}
        onReply={onReply}
        onReplyAll={onReplyAll}
        onToggle={onToggle}
        onToggleKeyDown={onMessageKeyDown}
        showDetails={showDetails}
        showReplyButton={showReplyButton}
        toggleDetails={toggleDetails}
        hasDraft={hasDraft || visibleDrafts.length > 0}
        sentMessageOpen={sentMessageOpen}
      />

      {expanded && (
        // 让正文与发件人姓名对齐，而不是与头像对齐。
        <div className="min-w-0 pt-3 sm:pl-9">
          {isCalendarInvitationMessage(message) && (
            <CalendarInvitation key={message.id} messageId={message.id} />
          )}

          {!bodyAvailable && !isDraftRow && composeMode !== "forward" && (
            <MessageBodyLoading />
          )}
          {!isDraftRow && threadTranslation?.loading && (
            <p className="mb-3 flex items-center gap-1.5 text-muted-foreground text-xs">
              <LoadingMiniSpinner />
              正在翻译…
            </p>
          )}
          {!isDraftRow && translation && (
            <TranslationNotice
              languageName={translation.languageName}
              showOriginal={translation.showOriginal}
              messageId={message.id}
              threadId={message.threadId}
            />
          )}
          {bodyAvailable && !isDraftRow && showTranslation && translation && (
            <PlainEmail text={translation.text} />
          )}
          {bodyAvailable &&
            !isDraftRow &&
            !showTranslation &&
            (message.textHtml ? (
              <HtmlEmail
                onForwardMessage={showReplyButton ? onForward : undefined}
                onReplyMessage={showReplyButton ? onReply : undefined}
                onNavigateMessage={onNavigateMessage}
                onFocusMessage={onSelect}
                emailAccountId={emailAccountId}
                html={message.textHtml}
                inlineAttachments={message.inline}
                sendOperationId={sendOperationId}
                messageId={message.id}
              />
            ) : (
              <PlainEmail text={message.textPlain || ""} />
            ))}

          {message.attachments && <EmailAttachments message={message} />}

          {shownDrafts.map(({ message: draft, sessionMessageId }, index) => (
            <ReplyPanel
              key={sessionMessageId}
              autoScroll={!composeMode && index === shownDrafts.length - 1}
              draftBodyAvailable={!missingBodyIds?.has(draft.id)}
              draftMessage={draft}
              draftSessionMessageId={sessionMessageId}
              message={message}
              onCloseCompose={() => closeMailboxDraft(sessionMessageId)}
              onRestoreCompose={() =>
                setDraftDismissed(sessionMessageId, false)
              }
              onRestore={() => setDraftDismissed(sessionMessageId, false)}
              onSendSuccess={onSendSuccess}
              onSent={onReplySent}
              concealSentReply={concealSentReply}
              awaitSentReply={awaitSentReply}
              onMarkDone={onMarkDone}
              onDraftDiscarded={onDraftDiscarded}
              quote={
                pendingQuote?.draftSessionMessageId === sessionMessageId
                  ? pendingQuote.text
                  : undefined
              }
              onQuoteInserted={clearPendingQuote}
              onStartDiscard={() => {
                closeMailboxDraft(sessionMessageId);
                return {
                  id: composeSessionRef.current,
                  mode: "reply" as const,
                };
              }}
              refetch={refetch}
              composeMode="reply"
            />
          ))}
          {composeMode && !composingMailboxReply && (
            <ReplyPanel
              key={composerKey}
              autoScroll
              bodyAvailable={bodyAvailable}
              draftSessionMessageId={composerSessionMessageId}
              message={message}
              replyAnchor={replyAnchor}
              replyAll={replyAll}
              onCloseCompose={onCloseComposeAfterSend}
              onRestore={onRestoreComposeAfterSend}
              onRestoreCompose={onRestoreCompose}
              onSendSuccess={onSendSuccess}
              onSent={onReplySent}
              concealSentReply={concealSentReply}
              awaitSentReply={awaitSentReply}
              onMarkDone={onMarkDone}
              onStartDiscard={onStartDiscard}
              refetch={refetch}
              composeMode={composeMode}
              quote={
                pendingQuote && !pendingQuote.draftSessionMessageId
                  ? pendingQuote.text
                  : undefined
              }
              onQuoteInserted={clearPendingQuote}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 每条消息一行，构成整个会话的节奏：头像、发件人和时间。
 * 折叠时还显示摘要，这样无需打开每条消息也能从上到下阅读会话。
 */
function MessageHeader({
  message,
  menu,
  expanded,
  showDetails,
  toggleDetails,
  showReplyButton,
  onReply,
  onReplyAll,
  onForward,
  onOpenSenderContext,
  onToggle,
  onToggleKeyDown,
  hasDraft,
  sentMessageOpen,
}: {
  message: ParsedMessage;
  menu?: React.ReactNode;
  expanded: boolean;
  showDetails: boolean;
  toggleDetails: (e: React.MouseEvent) => void;
  showReplyButton: boolean;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onOpenSenderContext?: (message: ThreadMessage) => void;
  onToggle?: () => void;
  onToggleKeyDown: React.KeyboardEventHandler<HTMLElement>;
  hasDraft: boolean;
  sentMessageOpen?: SentMessageOpenState;
}) {
  const { emailAccount, emailAccountId, userEmail } = useAccount();

  const isSent = message.labelIds?.includes(GmailLabel.SENT) ?? false;
  const senderEmail = extractEmailAddress(message.headers.from);
  const senderName = isSent
    ? "我"
    : extractNameFromEmail(message.headers.from) || senderEmail;
  const contactPhoto = useContactPhoto({
    email: expanded && !isSent ? senderEmail : null,
    emailAccountId,
  });
  const senderImage = isSent ? emailAccount?.image : contactPhoto;
  const recipients = formatRecipientNames(
    [
      ...splitRecipientList(message.headers.to ?? ""),
      ...splitRecipientList(message.headers.cc ?? ""),
    ],
    userEmail,
  );
  const canResearchSender =
    Boolean(onOpenSenderContext) &&
    !isSent &&
    Boolean(senderEmail) &&
    !isSameEmailAddress(senderEmail, userEmail);
  // 回复本身会保留抄送列表，因此全部回复只会添加其他收件人。
  // 回复用户自己发出的邮件时本就发给所有人。
  const canReplyAll =
    !isSent &&
    splitRecipientList(message.headers.to ?? "").some(
      (recipient) =>
        !isSameEmailAddress(recipient, userEmail) &&
        !isSameEmailAddress(recipient, message.headers.from),
    );

  // 折叠由会话决定，所以只有等到该行获得切换回调后
  // 才会变为可交互。
  const toggleProps: React.ComponentProps<"div"> | undefined = onToggle && {
    "aria-expanded": expanded,
    onClick: onToggle,
    onKeyDown: onToggleKeyDown,
    role: "button",
    tabIndex: 0,
  };

  const compose = (open: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    open();
  };

  const avatar = (
    <Avatar aria-hidden className="size-7 shrink-0">
      <AvatarImage alt="" src={senderImage || undefined} />
      <AvatarFallback
        className={cn(
          "font-semibold text-[10px] tracking-wide",
          isSent
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {getInitials(senderName)}
      </AvatarFallback>
    </Avatar>
  );
  // 折叠行使用固定宽度，使摘要列沿会话保持对齐。
  const senderNameClassName = cn(
    "truncate text-sm",
    expanded
      ? "min-w-0 font-medium text-foreground"
      : "w-24 shrink-0 font-medium text-secondary-foreground sm:w-28",
  );

  return (
    <div
      {...toggleProps}
      className={cn(
        "flex min-w-0 gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        expanded && showDetails ? "items-start" : "items-center",
        onToggle && "cursor-pointer",
      )}
    >
      {expanded ? (
        <>
          {showDetails ? (
            // 不像摘要那样作为整体切换，这样地址仍可选中，
            // 点击内部也不会折叠消息。
            // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside toggles from the keyboard
            <div
              className="flex min-w-0 flex-1 cursor-auto items-start gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              {avatar}
              <EmailDetails message={message}>
                <Button
                  aria-expanded
                  aria-label="隐藏详情"
                  onClick={toggleDetails}
                  size="iconXs"
                  variant="ghostMuted"
                >
                  <ChevronsDownUpIcon className="size-3.5" />
                </Button>
              </EmailDetails>
            </div>
          ) : (
            <button
              aria-expanded={false}
              aria-label="显示详情"
              className="group/details flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={toggleDetails}
              type="button"
            >
              {avatar}
              <span className={senderNameClassName}>{senderName}</span>
              {recipients && (
                <span className="hidden min-w-0 shrink-[999] truncate text-muted-foreground text-sm sm:block">
                  收件人：{" "}
                  <span className="font-medium text-foreground">
                    {recipients}
                  </span>
                </span>
              )}
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-opacity group-hover/message:opacity-100 group-focus-visible/details:opacity-100 sm:opacity-0" />
            </button>
          )}
          {canResearchSender && (
            <Tooltip content="查看公开资料">
              <Button
                aria-label={`查看 ${senderName} 的公开资料`}
                className="transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100 sm:opacity-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSenderContext?.(message);
                }}
                size="iconXs"
                variant="ghostMuted"
              >
                <UserSearchIcon className="size-3.5" />
              </Button>
            </Tooltip>
          )}
        </>
      ) : (
        <>
          {avatar}
          <span className={senderNameClassName}>{senderName}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
            {decodeSnippet(message.snippet)}
          </span>
        </>
      )}

      {hasDraft &&
        (!expanded || message.labelIds?.includes(GmailLabel.DRAFT)) && (
          <span className="shrink-0 text-primary text-xs">草稿</span>
        )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {(showReplyButton || menu) && (
          <span className="flex shrink-0 items-center transition-opacity focus-within:opacity-100 group-hover/message:opacity-100 has-[[data-state=open]]:opacity-100 sm:opacity-0">
            {showReplyButton && (
              <>
                <Tooltip shortcuts={["reply"]}>
                  <Button
                    onClick={compose(onReply)}
                    size="iconXs"
                    variant="ghostMuted"
                  >
                    <ReplyIcon className="size-3.5" />
                    <span className="sr-only">回复</span>
                  </Button>
                </Tooltip>
                {canReplyAll && (
                  <Tooltip content="全部回复">
                    <Button
                      onClick={compose(onReplyAll)}
                      size="iconXs"
                      variant="ghostMuted"
                    >
                      <ReplyAllIcon className="size-3.5" />
                      <span className="sr-only">全部回复</span>
                    </Button>
                  </Tooltip>
                )}
                <Tooltip shortcuts={["forward"]}>
                  <Button
                    onClick={compose(onForward)}
                    size="iconXs"
                    variant="ghostMuted"
                  >
                    <ForwardIcon className="size-3.5" />
                    <span className="sr-only">转发</span>
                  </Button>
                </Tooltip>
              </>
            )}
            {menu}
          </span>
        )}
        {isSent &&
          !message.labelIds?.includes(GmailLabel.DRAFT) &&
          sentMessageOpen && <SentMessageOpenStatus open={sentMessageOpen} />}
        <time
          className="shrink-0 whitespace-nowrap text-muted-foreground text-xs"
          dateTime={message.headers.date}
        >
          {formatShortDate(new Date(message.headers.date))}
        </time>
      </div>
    </div>
  );
}

function ReplyPanel({
  message,
  refetch,
  onSendSuccess,
  onSent,
  onMarkDone,
  onCloseCompose,
  onRestore,
  onRestoreCompose,
  onStartDiscard,
  onDraftDiscarded,
  composeMode,
  draftMessage,
  draftSessionMessageId,
  draftBodyAvailable = true,
  autoScroll = false,
  bodyAvailable = true,
  replyAnchor,
  replyAll = false,
  quote,
  onQuoteInserted,
  concealSentReply,
  awaitSentReply,
}: {
  message: ParsedMessage;
  refetch: () => void;
  onSendSuccess: (messageId: string, threadId: string) => void;
  onSent?: () => void;
  concealSentReply?: (operationId: string) => () => void;
  awaitSentReply?: (operationId: string) => Promise<void>;
  onMarkDone?: () => void;
  onCloseCompose: () => void;
  onRestore?: () => void;
  onRestoreCompose: (composeSession: ComposeSession) => void;
  onStartDiscard: () => ComposeSession | undefined;
  onDraftDiscarded?: () => void;
  composeMode: ReplyDraftMode;
  draftMessage?: ThreadMessage;
  draftSessionMessageId?: string;
  draftBodyAvailable?: boolean;
  autoScroll?: boolean;
  bodyAvailable?: boolean;
  replyAnchor?: ParsedMessage;
  replyAll?: boolean;
  quote?: string;
  onQuoteInserted?: () => void;
}) {
  const { emailAccountId, userEmail } = useAccount();
  const { popOutReply } = useComposeModal();
  const [handingOffSend, setHandingOffSend] = useState(false);
  const handoffStarted = useRef(false);
  // 卸载时也会设置：撤销可能会在原编辑器位置恢复新编辑器，
  // 迟到的交接不得关闭它。
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);
  const closeAfterSend = () => {
    if (closed.current) return;
    closed.current = true;
    onCloseCompose();
  };
  const replyTargetId = replyAnchor?.id ?? message.id;
  const draftSessionId = getReplyDraftSessionId(
    draftSessionMessageId ?? message.id,
    composeMode,
  );

  const replyRef = useRef<HTMLDivElement>(null);
  // 开始撰写后，转发即占有其原始来源。后续的缓存回退不能替换该来源，
  // 也不能丢弃未发送的编辑器状态。
  const [forwardSource, setForwardSource] = useState<ParsedMessage>();
  if (composeMode === "forward" && bodyAvailable && !forwardSource)
    setForwardSource(message);
  // 一旦打开，编辑器和其本地草稿即支配该回复。同步在正文加载前带回的
  // 已保存草稿不能替换它们。
  const [draftSource, setDraftSource] = useState<ParsedMessage>();
  if (draftMessage && draftBodyAvailable && !draftSource)
    setDraftSource(draftMessage);

  // 回复面板首次打开时滚动到它
  useEffect(() => {
    if (!autoScroll || !replyRef.current) return;

    // 滚动前等待回复面板完成布局。
    const scrollTimeout = setTimeout(() => {
      replyRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 500);

    return () => clearTimeout(scrollTimeout);
  }, [autoScroll]);

  const replyingToEmail = useMemo((): ReplyingToEmail | undefined => {
    if (composeMode === "reply") {
      if (draftSource) return prepareDraftReplyEmail(draftSource);

      return prepareReplyingToEmail({
        message,
        threadOn: replyAnchor,
        replyAll,
        userEmail,
      });
    }
    return forwardSource
      ? prepareForwardingEmail(forwardSource, Boolean(replyAnchor))
      : undefined;
  }, [
    composeMode,
    message,
    draftSource,
    forwardSource,
    replyAnchor,
    replyAll,
    userEmail,
  ]);

  const { executeAsync: discardDraft } = useAction(
    deleteDraftAction.bind(null, emailAccountId),
  );

  const onDiscard = useCallback(
    async (draftId?: string) => {
      if (composeMode === "forward" || !draftMessage) {
        onCloseCompose();
        return true;
      }

      const discardPromise = discardDraft({
        draftMessageId: draftMessage.id,
        draftId,
      });
      const composeSession = onStartDiscard();
      if (!composeSession) return false;

      try {
        const result = await discardPromise;
        if (
          result &&
          (result.serverError !== undefined ||
            result.validationErrors !== undefined)
        ) {
          toastError({
            description: getActionErrorMessage(result, {
              prefix: "丢弃草稿失败",
            }),
          });
          onRestoreCompose(composeSession);
          return false;
        }
      } catch {
        toastError({ description: "丢弃草稿失败" });
        onRestoreCompose(composeSession);
        return false;
      } finally {
        refetch();
      }
      onDraftDiscarded?.();
      return true;
    },
    [
      composeMode,
      draftMessage,
      discardDraft,
      onCloseCompose,
      onDraftDiscarded,
      onRestoreCompose,
      onStartDiscard,
      refetch,
    ],
  );

  if (draftMessage && !draftSource) {
    return (
      <div className="mt-5">
        <MessageBodyLoading />
      </div>
    );
  }

  if (!replyingToEmail)
    return (
      <div className="mt-5 flex gap-2">
        <Button onClick={refetch} size="sm" variant="outline">
          加载要转发的邮件
        </Button>
        <Button onClick={onCloseCompose} size="sm" variant="ghost">
          取消
        </Button>
      </div>
    );

  return (
    <div className="mt-5" inert={handingOffSend} ref={replyRef}>
      <ComposeEmailFormLazy
        providerDraftMessageId={
          composeMode === "reply" ? draftMessage?.id : undefined
        }
        draftKeyMessageId={replyTargetId}
        draftMode={composeMode}
        draftSessionId={draftSessionId}
        onSubmitting={concealSentReply}
        onClose={(queuedOperationId?: string) => {
          // 离线发送排队后会再次关闭；交接会将其关闭。
          if (handoffStarted.current) return;
          // 在交接之前执行，这样下方已发送的回复成为最新一条时，
          // 此消息仍保持展开。
          onSent?.();
          if (!queuedOperationId || !awaitSentReply) {
            closeAfterSend();
            return;
          }
          // 现在关闭会让会话在已发送邮件正文加载完成前缺少这条回复。
          handoffStarted.current = true;
          setHandingOffSend(true);
          awaitSentReply(queuedOperationId).then(closeAfterSend);
        }}
        onRestore={() => {
          // 撤销会恢复一个新的编辑器，需要先关闭当前这个。
          if (handoffStarted.current) closeAfterSend();
          onRestore?.();
        }}
        onDiscard={onDiscard}
        onPopOut={() => {
          popOutReply({
            emailAccountId,
            draftSessionId,
            draftKeyMessageId: replyTargetId,
            draftMode: composeMode,
            providerDraftMessageId:
              composeMode === "reply" ? draftMessage?.id : undefined,
            replyingToEmail,
            onReturn: onRestore,
          });
          onCloseCompose();
        }}
        onMarkDone={onMarkDone}
        onSuccess={(messageId: string, threadId: string) => {
          onSendSuccess(messageId, threadId);
          onCloseCompose();
        }}
        refetch={refetch}
        replyingToEmail={replyingToEmail}
        quote={quote}
        onQuoteInserted={onQuoteInserted}
      />
    </div>
  );
}

function resolveComposeMode(
  override: ReplyDraftMode | "closed" | null,
  defaultComposeMode: ReplyDraftMode | undefined,
  isPoppedOut: (mode: ReplyDraftMode) => boolean,
) {
  if (override === "closed") return;
  const mode = override ?? defaultComposeMode;
  // 弹出的回复在其独立窗口中撰写，而不是内联。
  if (mode && isPoppedOut(mode)) return;
  return mode;
}

const prepareReplyingToEmail = ({
  message,
  threadOn = message,
  replyAll,
  userEmail,
}: {
  message: ParsedMessage;
  threadOn?: ParsedMessage;
  replyAll: boolean;
  userEmail: string;
}): ReplyingToEmail => {
  const sentFromUser = message.labelIds?.includes("SENT");

  const { html } = createReplyContent({ message });
  const replyTo = message.headers["reply-to"] || message.headers.from;
  const replyAllCc =
    replyAll && !sentFromUser
      ? buildReplyAllRecipients(message.headers, replyTo, userEmail).cc
      : undefined;

  return {
    // 跟进自己发出的邮件时使用原始收件人，否则回复发件人
    to: sentFromUser ? message.headers.to : replyTo,
    fromHint: getFromHint(message),
    // 跟进自己发出的邮件时不添加“Re:”前缀
    subject: sentFromUser
      ? message.headers.subject
      : formatReplySubject(message.headers.subject),
    headerMessageId: threadOn.headers["message-id"] || undefined,
    messageId: threadOn.id || undefined,
    threadId: threadOn.threadId || undefined,
    // 保留原始抄送
    cc: replyAllCc ? formatCcList(replyAllCc) : message.headers.cc,
    // 如有原始密送则保留
    bcc: sentFromUser ? message.headers.bcc : "",
    references: threadOn.headers.references,
    draftHtml: "",
    quotedContentHtml: html,
  };
};

const prepareForwardingEmail = (
  message: ParsedMessage,
  unsent = false,
): ReplyingToEmail => ({
  to: "",
  fromHint: getFromHint(message),
  subject: forwardEmailSubject(message.headers.subject),
  headerMessageId: undefined,
  threadId: message.threadId || undefined,
  // 服务商没有可用来转发的未发送邮件副本。
  forwardedMessageId: unsent ? undefined : message.id || undefined,
  forwardedAttachments: message.attachments?.map((attachment) => ({
    id: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
  })),
  cc: "",
  references: "",
  draftHtml: forwardEmailHtml({ content: "", message }),
  quotedContentHtml: "",
});

function prepareDraftReplyEmail(draft: ParsedMessage): ReplyingToEmail {
  const splitHtml = extractDraftComposerContent(
    draft.textHtml,
    draft.textPlain,
  );

  return {
    to: draft.headers.to,
    fromHint: draft.headers.from,
    subject: draft.headers.subject,
    headerMessageId: draft.headers["message-id"] || undefined,
    messageId: draft.id || undefined,
    threadId: draft.threadId || undefined,
    cc: draft.headers.cc,
    bcc: draft.headers.bcc,
    references: draft.headers.references,
    draftHtml: splitHtml.draftHtml,
    quotedContentHtml: splitHtml.originalHtml,
    draftHasAttachments: Boolean(
      draft.attachments?.length || draft.inline?.length,
    ),
  };
}

// 跟进用户自己发出的邮件时保留其发件人；回复收到的邮件时，
// 从该邮件发送到的用户地址发出。
function getFromHint(message: ParsedMessage) {
  if (message.labelIds?.includes("SENT")) return message.headers.from;
  return [message.headers.to, message.headers.cc].filter(Boolean).join(", ");
}

function TranslationNotice({
  languageName,
  showOriginal,
  messageId,
  threadId,
}: {
  languageName: string | null;
  showOriginal: boolean;
  messageId: string;
  threadId: string;
}) {
  const { emailAccountId } = useAccount();
  const translateThread = useTranslateThread();
  let status = "正在显示原文";
  if (!showOriginal) {
    status = languageName ? `已从${languageName}翻译` : "已翻译";
  }

  return (
    <p className="mb-3 flex items-center gap-1.5 text-muted-foreground text-xs">
      {status}
      <span aria-hidden>·</span>
      <button
        className="text-primary hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          translateThread({
            emailAccountId,
            threadId,
            messageIds: [messageId],
          });
        }}
        type="button"
      >
        {showOriginal ? "显示译文" : "显示原文"}
      </button>
    </p>
  );
}

function MessageBodyLoading() {
  return (
    <p
      data-email-ready="false"
      className="flex items-center gap-2 text-muted-foreground text-sm"
      role="status"
    >
      <LoadingMiniSpinner />
      正在加载邮件…
    </p>
  );
}

// 纯文本正文直接渲染在页面中，因此其选区属于窗口。
function getSelectedText(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  if (!container.contains(selection.anchorNode)) return;
  return selection.toString().trim() || undefined;
}
