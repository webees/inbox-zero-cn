"use client";

import {
  useCallback,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { AlertCircleIcon, Loader2Icon, MailIcon } from "lucide-react";
import { ReaderToolbar } from "@/app/(app)/[emailAccountId]/mail/ReaderToolbar";
import { MailReaderSurface } from "@inboxzero/mail-ui/MailReaderSurface";
import { isThreadStarred } from "@/app/(app)/[emailAccountId]/mail/star-state";
import { useThreadTranslation } from "@/app/(app)/[emailAccountId]/mail/use-thread-translation";
import type {
  ListThread,
  MailLayoutMode,
} from "@/app/(app)/[emailAccountId]/mail/types";
import { EmailThread } from "@/components/email-list/EmailThread";
import type { ThreadMessage } from "@/components/email-list/types";
import { getEmailMessageCellLabels } from "@/components/EmailMessageCellLabels";
import { LoadingContent } from "@/components/LoadingContent";
import { getSWRFetchErrorMessage } from "@/providers/swr-error";
import { Button } from "@/components/ui/button";
import type { EmailLabels } from "@/providers/email-label-types";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useHiddenDraftMessageIds } from "@/hooks/useHiddenDraftMessageIds";
import { extractEmailAddress, extractNameFromEmail } from "@/utils/email";
import { PublisherDiscussion } from "@/components/team-comments/PublisherDiscussion";
import type { OutgoingThreadMessage } from "@/utils/mail-engine/conversation-thread";

const SenderContextPanel = dynamic(
  () =>
    import("@/app/(app)/[emailAccountId]/mail/SenderContextPanel").then(
      (module) => module.SenderContextPanel,
    ),
  { ssr: false },
);

/**
 * 低于此宽度时，阅读器会被旁边的面板挤得太窄，因此
 * 发件人资料会改为滑到阅读器上方。
 */
const INLINE_SENDER_CONTEXT_MIN_WIDTH = 880;

export type ThreadReaderProps = {
  enableMessageNavigation: boolean;
  /** 已打开的行。加载期间它可能滞后于所选的会话。 */
  thread: ListThread | null;
  /** 所选的会话，包括其行与消息正在加载期间。 */
  threadId: string | null;
  /** 延迟的详情选择是否已跟上已打开的行。 */
  detailSelectionSettled: boolean;
  loading: boolean;
  error?: ComponentProps<typeof LoadingContent>["error"];
  /**
   * 阅读器当前可用的消息，包括部分本地分页。
   */
  messages: ThreadMessage[];
  localAvailability?: {
    missingBodyIds: Set<string>;
    outgoing: OutgoingThreadMessage[];
    sendOperationIds: Map<string, string>;
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => unknown;
  };
  userLabels: EmailLabels;
  layout: MailLayoutMode;
  labelHref: (labelId: string) => string;
  onRemoveLabel?: (labelId: string) => void;
  onBackToInbox: () => void;
  onArchive: () => void;
  onMoveToInbox?: () => void;
  isUnread: boolean;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  /** 在回复发送后或草稿变化后刷新已打开的会话。 */
  refetch: () => void;
  /** 当已发送的邮件开启一个新的服务商会话时，打开该会话。 */
  onSendSuccess?: (
    messageId: string,
    sentThreadId: string,
    repliedThreadId: string,
  ) => void;
  /**
   * 由回复操作设置。若未设置，对于已有 AI 草稿的邮件，
   * 撰写器仍会自行打开。
   */
  autoOpenReplyForMessageId?: string;
  autoOpenForwardForMessageId?: string;
  /** ⋯ 下拉菜单，即 `ThreadActionsMenu`，由外壳组合。 */
  menu?: ReactNode;
  renderMessageMenu?: (message: ThreadMessage) => ReactNode;
};

export function ThreadReader({
  enableMessageNavigation,
  thread,
  threadId,
  detailSelectionSettled,
  loading,
  error,
  messages,
  localAvailability,
  userLabels,
  layout,
  labelHref,
  onRemoveLabel,
  onBackToInbox,
  onArchive,
  onMoveToInbox,
  isUnread,
  onMarkRead,
  onMarkUnread,
  refetch,
  onSendSuccess,
  autoOpenReplyForMessageId,
  autoOpenForwardForMessageId,
  menu,
  renderMessageMenu,
}: ThreadReaderProps) {
  const [senderContext, setSenderContext] = useState<{
    messageId: string;
    senderEmail: string;
    senderName: string;
  } | null>(null);
  const [readerRef, readerWidth] = useElementWidth();
  const { emailAccountId } = useAccount();
  const hiddenDraftMessageIds = useHiddenDraftMessageIds(emailAccountId);
  const headerMessage =
    latestShownMessage(thread?.messages ?? [], hiddenDraftMessageIds) ??
    latestShownMessage(messages, hiddenDraftMessageIds) ??
    thread?.messages.at(-1) ??
    messages.at(-1);
  const translation = useThreadTranslation(
    emailAccountId,
    headerMessage?.threadId,
  );
  const translatedSubject = translation?.showOriginal
    ? undefined
    : translation?.subject;

  if (error || (!headerMessage && !localAvailability)) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center"
        data-detail-selection-settled={detailSelectionSettled}
        data-testid="thread-reader"
      >
        <LoadingContent
          error={error}
          loading={loading}
          errorComponent={<ThreadReaderError error={error} onRetry={refetch} />}
          loadingComponent={
            <Loader2Icon
              aria-label="正在加载邮件"
              className="size-6 animate-spin text-muted-foreground"
            />
          }
        >
          <MailIcon className="size-6 text-muted-foreground" />
          <div className="text-foreground text-sm">未选择任何内容</div>
          <div className="text-muted-foreground text-xs">
            选择其他视图，或返回收件箱。
          </div>
        </LoadingContent>
      </div>
    );
  }

  const labels =
    getEmailMessageCellLabels({
      labelIds: headerMessage?.labelIds,
      userLabels,
    }) ?? [];

  const renderToolbar = (
    messageExpansion?: ComponentProps<typeof ReaderToolbar>["messageExpansion"],
  ) => (
    <ReaderToolbar
      isStarred={isThreadStarred(
        thread?.messages.length ? thread.messages : messages,
      )}
      isUnread={isUnread}
      messageExpansion={messageExpansion}
      labelHref={labelHref}
      labels={labels}
      menu={menu}
      onArchive={onArchive}
      onMoveToInbox={onMoveToInbox}
      onMarkRead={onMarkRead}
      onMarkUnread={onMarkUnread}
      onBackToInbox={onBackToInbox}
      onRemoveLabel={onRemoveLabel}
      subject={translatedSubject ?? headerMessage?.headers.subject ?? "会话"}
    />
  );

  return (
    <MailReaderSurface
      containerRef={readerRef}
      detailSelectionSettled={detailSelectionSettled}
      layout={layout}
      localAvailability={localAvailability}
      renderLoadMoreButton={({ disabled, loading, onClick }) => (
        <Button
          className="mb-4"
          disabled={disabled}
          onClick={onClick}
          variant="outline"
        >
          {loading ? "正在加载邮件…" : "加载更早的邮件"}
        </Button>
      )}
      sidePanel={
        senderContext ? (
          <SenderContextPanel
            messageId={senderContext.messageId}
            onClose={() => setSenderContext(null)}
            senderEmail={senderContext.senderEmail}
            senderName={senderContext.senderName}
            variant={
              readerWidth >= INLINE_SENDER_CONTEXT_MIN_WIDTH
                ? "inline"
                : "sheet"
            }
          />
        ) : null
      }
    >
      {messages.length > 0 ? (
        <EmailThread
          renderToolbar={renderToolbar}
          renderMessageMenu={renderMessageMenu}
          enableMessageNavigation={enableMessageNavigation}
          autoOpenReplyForMessageId={autoOpenReplyForMessageId}
          autoOpenForwardForMessageId={autoOpenForwardForMessageId}
          key={threadId}
          messages={messages}
          missingBodyIds={localAvailability?.missingBodyIds}
          outgoing={localAvailability?.outgoing}
          sendOperationIds={localAvailability?.sendOperationIds}
          onMarkDone={onArchive}
          onOpenSenderContext={(message) => {
            const senderEmail = extractEmailAddress(message.headers.from);
            setSenderContext({
              messageId: message.id,
              senderEmail,
              senderName:
                extractNameFromEmail(message.headers.from) || senderEmail,
            });
          }}
          refetch={refetch}
          onSendSuccess={onSendSuccess}
          onThreadDiscarded={
            // 部分加载的会话可能看起来只有草稿，因此要等到
            // 所有消息都到齐后再认定它是这样，才离开。
            localAvailability?.hasMore ? undefined : onBackToInbox
          }
          showReplyButton
        />
      ) : (
        renderToolbar()
      )}
      {emailAccountId && threadId && messages.length > 0 && (
        <PublisherDiscussion
          key={`${emailAccountId}:${threadId}`}
          emailAccountId={emailAccountId}
          threadId={threadId}
        />
      )}
    </MailReaderSurface>
  );
}

/**
 * 加载会话可能因阅读器能够恢复的原因而失败，例如服务商尚未
 * 使某条消息可读，因此这里提供重试，
 * 而不是显示通用的全应用错误页。
 */
function ThreadReaderError({
  error,
  onRetry,
}: {
  error: ThreadReaderProps["error"];
  onRetry: () => void;
}) {
  return (
    <>
      <AlertCircleIcon className="size-6 text-muted-foreground" />
      <div className="text-foreground text-sm">无法打开此会话</div>
      <div className="text-muted-foreground text-xs">
        {getSWRFetchErrorMessage(error?.info)}
      </div>
      <Button className="mt-2" onClick={onRetry} size="sm" variant="outline">
        重试
      </Button>
    </>
  );
}

/**
 * 使用回调 ref 而不是 effect：阅读器只有在会话打开后、
 * 加载分支来去之后，才会挂载其被测量的元素。
 */
function useElementWidth() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

// 被待发送邮件替代的草稿不会显示，因此它也不会
// 成为会话的标题。
function latestShownMessage<T extends { id: string }>(
  messages: T[],
  hiddenDraftMessageIds: string[],
) {
  return messages.findLast(
    (message) => !hiddenDraftMessageIds.includes(message.id),
  );
}
