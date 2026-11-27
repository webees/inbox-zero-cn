"use client";

import { OpenedConversationAttachments } from "@/components/email-list/OpenedConversationAttachments";
import {
  Children,
  createContext,
  useEffect,
  isValidElement,
  useState,
  useContext,
  useMemo,
  cloneElement,
  type ReactNode,
} from "react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  InfoIcon,
  MailOpenIcon,
  MoreVerticalIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type EmailMeta,
  useEmailLookup,
  useKnownThreadIds,
} from "@/components/assistant-chat/email-lookup-context";
import { useInlineEmailActionContext } from "@/components/assistant-chat/inline-email-action-context";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  archiveThreadAction,
  markReadThreadAction,
} from "@/utils/actions/mail";
import { normalizeInlineEmailThreadIds } from "@/utils/ai/assistant/inline-email-actions";
import { getEmailUrlForMessage } from "@/utils/url";
import { formatShortDate } from "@/utils/date";
import { extractEmailAddress, extractNameFromEmail } from "@/utils/email";
import { toastError, toastSuccess } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/Tooltip";
import { EmailAttachments } from "@/components/email-list/EmailAttachments";
import { HtmlEmail, PlainEmail } from "@/components/email-list/EmailContents";
import { EmailDetails } from "@/components/email-list/EmailDetails";
import { useThread } from "@/hooks/useThread";
import { LoadingMiniSpinner } from "@/components/Loading";
import { SenderIcon } from "@/components/SenderIcon";
import { useAtom, useAtomValue } from "jotai";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { mailPreviewAtom, mailScreenMountedAtom } from "@/store/mail-preview";

type ActionState = "idle" | "loading" | "done";

const iconButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

const iconIndicatorClass =
  "inline-flex h-7 w-7 items-center justify-center text-muted-foreground";

type InlineEmailListState = {
  archivedThreadIds: Set<string>;
  readThreadIds: Set<string>;
  markArchived: (threadIds: string[]) => void;
  markRead: (threadIds: string[]) => void;
};

const InlineEmailListContext = createContext<InlineEmailListState | null>(null);

export function InlineEmailList({ children }: { children?: ReactNode }) {
  const { t, i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const inlineEmailActionContext = useInlineEmailActionContext();
  const [archiveAllState, setArchiveAllState] = useState<ActionState>("idle");
  const [markReadState, setMarkReadState] = useState<ActionState>("idle");
  const [collapsed, setCollapsed] = useState(false);
  const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);
  const [archivedThreadIds, setArchivedThreadIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [readThreadIds, setReadThreadIds] = useState<Set<string>>(
    () => new Set(),
  );
  const numberedChildren = useMemo(
    () => numberInlineEmailCards(children),
    [children],
  );
  const knownThreadIds = useKnownThreadIds();
  const threadIds = normalizeInlineEmailThreadIds(
    collectThreadIds(children, knownThreadIds),
  );
  const remainingArchiveThreadIds = threadIds.filter(
    (threadId) => !archivedThreadIds.has(threadId),
  );
  const remainingReadThreadIds = threadIds.filter(
    (threadId) => !readThreadIds.has(threadId),
  );
  const archiveAllDone =
    archiveAllState === "done" || remainingArchiveThreadIds.length === 0;
  const markReadDone =
    markReadState === "done" || remainingReadThreadIds.length === 0;
  const allHandled =
    threadIds.length > 0 &&
    threadIds.every(
      (threadId) =>
        archivedThreadIds.has(threadId) || readThreadIds.has(threadId),
    );

  useEffect(() => {
    if (!allHandled) {
      setCollapsed(false);
      setHasAutoCollapsed(false);
      return;
    }

    if (hasAutoCollapsed) return;

    const timeoutId = window.setTimeout(() => {
      setCollapsed(true);
      setHasAutoCollapsed(true);
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [allHandled, hasAutoCollapsed]);

  function markArchived(threadIds: string[]) {
    setArchivedThreadIds((current) => addThreadIds(current, threadIds));
  }

  function markRead(threadIds: string[]) {
    setReadThreadIds((current) => addThreadIds(current, threadIds));
  }

  async function handleArchiveAll() {
    if (archiveAllState !== "idle" || remainingArchiveThreadIds.length === 0) {
      return;
    }
    setArchiveAllState("loading");
    try {
      const results = await Promise.all(
        remainingArchiveThreadIds.map((threadId) =>
          archiveThreadAction(emailAccountId, { threadId }),
        ),
      );
      const successfulThreadIds = getSuccessfulThreadIds(
        remainingArchiveThreadIds,
        results,
      );
      const failedCount = results.filter((r) => r?.serverError).length;
      if (failedCount === results.length) {
        toastError({ description: t`无法归档邮件` });
        setArchiveAllState("idle");
      } else if (failedCount > 0) {
        markArchived(successfulThreadIds);
        inlineEmailActionContext?.queueAction(
          "archive_threads",
          successfulThreadIds,
        );
        toastSuccess({
          description: t`已归档 ${results.length - failedCount} 封邮件，共 ${results.length} 封`,
        });
        setArchiveAllState("idle");
      } else {
        markArchived(successfulThreadIds);
        inlineEmailActionContext?.queueAction(
          "archive_threads",
          successfulThreadIds,
        );
        toastSuccess({
          description: t`已归档 ${remainingArchiveThreadIds.length} 封邮件`,
        });
        setArchiveAllState("done");
      }
    } catch {
      toastError({ description: t`无法归档邮件` });
      setArchiveAllState("idle");
    }
  }

  async function handleMarkAllRead() {
    if (markReadState !== "idle" || remainingReadThreadIds.length === 0) {
      return;
    }
    setMarkReadState("loading");
    try {
      const results = await Promise.all(
        remainingReadThreadIds.map((threadId) =>
          markReadThreadAction(emailAccountId, { threadId, read: true }),
        ),
      );
      const successfulThreadIds = getSuccessfulThreadIds(
        remainingReadThreadIds,
        results,
      );
      const failedCount = results.filter((r) => r?.serverError).length;
      if (failedCount === results.length) {
        toastError({ description: t`无法将邮件标记为已读` });
        setMarkReadState("idle");
      } else if (failedCount > 0) {
        markRead(successfulThreadIds);
        inlineEmailActionContext?.queueAction(
          "mark_read_threads",
          successfulThreadIds,
        );
        const total = results.length;
        toastSuccess({
          description: t`已将 ${total - failedCount} 封邮件标记为已读，共 ${total} 封`,
        });
        setMarkReadState("idle");
      } else {
        markRead(successfulThreadIds);
        inlineEmailActionContext?.queueAction(
          "mark_read_threads",
          successfulThreadIds,
        );
        toastSuccess({
          description: t`已将 ${remainingReadThreadIds.length} 封邮件标记为已读`,
        });
        setMarkReadState("done");
      }
    } catch {
      toastError({ description: t`无法将邮件标记为已读` });
      setMarkReadState("idle");
    }
  }

  return (
    <InlineEmailListContext.Provider
      value={{
        archivedThreadIds,
        readThreadIds,
        markArchived,
        markRead,
      }}
    >
      {collapsed ? (
        <button
          type="button"
          className="my-2 flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/30"
          onClick={() => setCollapsed(false)}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">
              <Trans>已完成的邮件</Trans>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCompletedSummary({
                threadIds,
                archivedThreadIds,
                readThreadIds,
                i18n,
              })}
            </div>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
          {threadIds.length > 0 && (
            <div className="flex items-center justify-end gap-1 border-b px-3 py-1.5">
              <Tooltip content={archiveAllDone ? t`已全部归档` : t`全部归档`}>
                <Button
                  variant="ghost"
                  size="iconXs"
                  loading={archiveAllState === "loading"}
                  disabled={archiveAllDone}
                  onClick={handleArchiveAll}
                  Icon={archiveAllDone ? CheckIcon : ArchiveIcon}
                />
              </Tooltip>
              <Tooltip
                content={markReadDone ? t`All marked read` : t`Mark all read`}
              >
                <Button
                  variant="ghost"
                  size="iconXs"
                  loading={markReadState === "loading"}
                  disabled={markReadDone}
                  onClick={handleMarkAllRead}
                  Icon={markReadDone ? CheckIcon : MailOpenIcon}
                />
              </Tooltip>
            </div>
          )}
          {numberedChildren}
        </div>
      )}
    </InlineEmailListContext.Provider>
  );
}

function numberInlineEmailCards(children: ReactNode): ReactNode {
  let nextIndex = 0;
  return Children.map(children, (child) => {
    if (
      !isValidElement<{
        id?: string;
        threadid?: string;
        index?: number | string;
      }>(child)
    ) {
      return child;
    }
    if (!getRawInlineEmailThreadId(child.props)) return child;
    if (child.props.index !== undefined) {
      const explicit = Number(child.props.index);
      if (Number.isFinite(explicit)) {
        nextIndex = Math.max(nextIndex, explicit);
      }
      return child;
    }
    nextIndex += 1;
    return cloneElement(child, { index: nextIndex });
  });
}

export function InlineEmailCard({
  id,
  threadid,
  index,
  children,
}: {
  id?: string;
  threadid?: string;
  index?: number | string;
  children?: ReactNode;
}) {
  const emailLookup = useEmailLookup();
  const knownThreadIds = useKnownThreadIds();
  const listState = useContext(InlineEmailListContext);
  const inlineEmailActionContext = useInlineEmailActionContext();
  const { t, i18n } = useLingui();
  const { emailAccountId, provider, userEmail } = useAccount();
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [markReadState, setMarkReadState] = useState<ActionState>("idle");
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const threadId = resolveInlineEmailThreadId({ id, threadid, knownThreadIds });
  const mailScreenMounted = useAtomValue(mailScreenMountedAtom);
  const [preview, setPreview] = useAtom(mailPreviewAtom);
  // Beside the mail screen there's room to show the whole email there.
  const opensOnMailScreen = mailScreenMounted && Boolean(threadId);
  const isPreviewed =
    opensOnMailScreen &&
    preview?.threadId === threadId &&
    preview?.emailAccountId === emailAccountId;

  function toggleOpen() {
    if (!threadId) return;
    if (opensOnMailScreen) {
      setPreview(isPreviewed ? null : { emailAccountId, threadId });
      return;
    }
    setExpanded(!expanded);
  }

  const meta = threadId ? emailLookup.get(threadId) : undefined;
  const isArchived = !!threadId && !!listState?.archivedThreadIds.has(threadId);
  const isMarkedRead = !!threadId && !!listState?.readThreadIds.has(threadId);

  const externalUrl = getInlineEmailExternalUrl({
    threadId,
    messageId: meta?.messageId,
    externalUrl: meta?.externalUrl,
    userEmail,
    provider,
  });

  async function handleArchive() {
    if (!threadId || actionState !== "idle") return;
    setActionState("loading");
    try {
      const result = await archiveThreadAction(emailAccountId, {
        threadId,
      });
      if (result?.serverError) {
        toastError({ description: result.serverError });
        setActionState("idle");
        return;
      }
      listState?.markArchived([threadId]);
      inlineEmailActionContext?.queueAction("archive_threads", [threadId]);
      toastSuccess({ description: t`Archived` });
      setActionState("done");
    } catch {
      toastError({ description: t`Failed to archive` });
      setActionState("idle");
    }
  }

  async function handleMarkRead() {
    if (!threadId || markReadState !== "idle") return;
    setMarkReadState("loading");
    try {
      const result = await markReadThreadAction(emailAccountId, {
        threadId,
        read: true,
      });
      if (result?.serverError) {
        toastError({ description: result.serverError });
        setMarkReadState("idle");
        return;
      }
      listState?.markRead([threadId]);
      inlineEmailActionContext?.queueAction("mark_read_threads", [threadId]);
      toastSuccess({ description: t`Marked as read` });
      setMarkReadState("done");
    } catch {
      toastError({ description: t`Failed to mark as read` });
      setMarkReadState("idle");
    }
  }

  const isDone = actionState === "done" || isArchived;
  const markReadComplete = isMarkedRead || markReadState === "done";
  const showArchive = Boolean(threadId);
  const hasSummary = Children.toArray(children).some(
    (child) => typeof child !== "string" || child.trim() !== "",
  );

  // An empty card for a thread no tool returned has nothing to show or open.
  if (!threadId && !hasSummary) return null;

  return (
    <div
      className={getCardClass({ inList: Boolean(listState), isPreviewed })}
      data-inline-email-card=""
    >
      <div
        role={threadId ? "button" : undefined}
        tabIndex={threadId ? 0 : undefined}
        className={`group flex items-center gap-2.5 px-3 text-sm ${hasSummary ? "py-3" : "py-2.5"} ${threadId ? "cursor-pointer" : ""} ${getRowStateClass({ isDone, inList: Boolean(listState) })}`}
        aria-current={isPreviewed ? "true" : undefined}
        data-chat-email-thread-id={opensOnMailScreen ? threadId : undefined}
        // The actions menu renders in a portal, but React still bubbles its
        // events here; only act on events from the row itself.
        onClick={(e) => {
          if (isFromRow(e)) toggleOpen();
        }}
        onKeyDown={(e) => {
          if (!isFromRow(e)) return;
          if (threadId && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggleOpen();
          }
        }}
      >
        {/* Outside a list the reply's own markdown list already numbers the card. */}
        {listState && index !== undefined ? (
          <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {index}.
          </span>
        ) : null}

        <InlineEmailCardBody meta={meta} hasSummary={hasSummary}>
          {children}
        </InlineEmailCardBody>

        <div className="flex shrink-0 items-center gap-0.5">
          {meta ? (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {formatShortDate(new Date(meta.date), {
                lowercase: true,
                locale: i18n.locale,
              })}
            </span>
          ) : null}
          {threadId ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={iconButtonClass}
                aria-label={t`更多操作`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                  }
                }}
              >
                <MoreVerticalIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {showArchive ? (
                  <DropdownMenuItem
                    disabled={isDone || actionState === "loading"}
                    onClick={handleArchive}
                  >
                    {isDone ? (
                      <CheckIcon className="mr-2 size-4" />
                    ) : (
                      <ArchiveIcon className="mr-2 size-4" />
                    )}
                    {isDone ? <Trans>已归档</Trans> : <Trans>归档</Trans>}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={markReadComplete || markReadState === "loading"}
                  onClick={handleMarkRead}
                >
                  {markReadComplete ? (
                    <CheckIcon className="mr-2 size-4" />
                  ) : (
                    <MailOpenIcon className="mr-2 size-4" />
                  )}
                  {markReadComplete ? (
                    <Trans>已标记为已读</Trans>
                  ) : (
                    <Trans>标记为已读</Trans>
                  )}
                </DropdownMenuItem>
                {opensOnMailScreen ? null : (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowDetails((v) => !v);
                      if (!expanded) setExpanded(true);
                    }}
                  >
                    <InfoIcon className="mr-2 size-4" />
                    {showDetails ? (
                      <Trans>隐藏详情</Trans>
                    ) : (
                      <Trans>显示详情</Trans>
                    )}
                  </DropdownMenuItem>
                )}
                {externalUrl ? (
                  <DropdownMenuItem asChild>
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLinkIcon className="mr-2 size-4" />
                      <Trans>在邮件中打开</Trans>
                    </a>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {threadId ? (
            <span className={iconIndicatorClass} aria-hidden="true">
              {expanded && !opensOnMailScreen ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </span>
          ) : null}
        </div>
      </div>

      {expanded && threadId && !opensOnMailScreen && (
        <EmailPreview threadId={threadId} showDetails={showDetails} />
      )}
    </div>
  );
}

export function InlineEmailDetail({
  id,
  threadid,
  children,
}: {
  id?: string;
  threadid?: string;
  children?: ReactNode;
}) {
  const emailLookup = useEmailLookup();
  const knownThreadIds = useKnownThreadIds();
  const { t, i18n } = useLingui();
  const { provider, userEmail } = useAccount();
  const threadId = resolveInlineEmailThreadId({ id, threadid, knownThreadIds });
  const meta = threadId ? emailLookup.get(threadId) : undefined;
  const externalUrl = getInlineEmailExternalUrl({
    threadId,
    messageId: meta?.messageId,
    externalUrl: meta?.externalUrl,
    userEmail,
    provider,
  });

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {meta?.subject || t`邮件`}
          </div>
          {meta ? (
            <div className="text-xs text-muted-foreground">
              {meta.from}
              {" · "}
              {formatShortDate(new Date(meta.date), {
                lowercase: true,
                locale: i18n.locale,
              })}
            </div>
          ) : null}
          {children ? (
            <div className="mt-1 text-xs text-muted-foreground">{children}</div>
          ) : null}
        </div>
        {externalUrl ? (
          <Tooltip content={t`在邮件中打开`}>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Tooltip>
        ) : null}
      </div>
      {threadId ? (
        <EmailPreview threadId={threadId} compact />
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          <Trans>未找到邮件内容</Trans>
        </div>
      )}
    </div>
  );
}

function InlineEmailCardBody({
  meta,
  hasSummary,
  children,
}: {
  meta: EmailMeta | undefined;
  hasSummary: boolean;
  children?: ReactNode;
}) {
  const { t } = useLingui();

  if (!meta) {
    if (hasSummary) {
      return <span className="min-w-0 flex-1 truncate">{children}</span>;
    }
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        <Trans>打开邮件</Trans>
      </span>
    );
  }

  const address = extractEmailAddress(meta.from) || meta.from;
  const name = extractNameFromEmail(meta.from);

  return (
    <>
      <SenderIcon email={address} name={name} size={28} />
      <div className="min-w-0 flex-1">
        <Tooltip content={address} side="right">
          <div className="truncate font-medium text-foreground">{name}</div>
        </Tooltip>
        {hasSummary ? (
          <div className="mt-0.5 text-sm text-foreground">{children}</div>
        ) : (
          <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {meta.subject || t`（无主题）`}
          </div>
        )}
      </div>
    </>
  );
}

function isFromRow(event: { currentTarget: EventTarget; target: EventTarget }) {
  return (
    event.currentTarget instanceof Node &&
    event.target instanceof Node &&
    event.currentTarget.contains(event.target)
  );
}

function getCardClass({
  inList,
  isPreviewed,
}: {
  inList: boolean;
  isPreviewed: boolean;
}) {
  if (inList) return "border-b last:border-b-0";
  // 灰色背景将邮件卡片与回复正文区分开。边框使用内嵌圆环，因为聊天滚动区域会裁剪
  // 卡片外部绘制的内容；悬停时会将卡片背景着色，以避免覆盖圆环。
  const base = "my-1.5 overflow-hidden rounded-lg ring-1 ring-inset";
  return isPreviewed
    ? `${base} bg-primary/10 ring-primary/40`
    : `${base} bg-muted/60 ring-border hover:bg-muted`;
}

function getRowStateClass({
  isDone,
  inList,
}: {
  isDone: boolean;
  inList: boolean;
}) {
  if (isDone) return "line-through opacity-50";
  // 独立卡片自行处理悬停效果；请参阅 getCardClass。
  return inList ? "hover:bg-muted/50" : "";
}

function collectThreadIds(
  children: ReactNode,
  knownThreadIds: Set<string> | null,
): string[] {
  const ids: string[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ id?: string; threadid?: string }>(child)) return;

    const threadId = resolveInlineEmailThreadId({
      ...child.props,
      knownThreadIds,
    });
    if (threadId) {
      ids.push(threadId);
    }
  });
  return ids;
}

function EmailPreview({
  threadId,
  compact = false,
  showDetails = false,
}: {
  threadId: string;
  compact?: boolean;
  showDetails?: boolean;
}) {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const { data, isLoading, error } = useThread({ id: threadId });

  if (isLoading) {
    return (
      <div className="flex justify-center px-3 py-4 text-muted-foreground">
        <LoadingMiniSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <Trans>无法加载邮件内容：{error.error}</Trans>
      </div>
    );
  }

  if (!data?.thread?.messages?.length) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <Trans>未找到邮件内容</Trans>
      </div>
    );
  }

  const lastMessage = data.thread.messages[data.thread.messages.length - 1];

  const body = (
    <OpenedConversationAttachments
      emailAccountId={emailAccountId}
      threadId={threadId}
      allowUncached
    >
      {lastMessage.textHtml ? (
        <HtmlEmail
          // 较新的消息是一封不同的邮件，而不是这封邮件的更新。
          key={lastMessage.id}
          emailAccountId={emailAccountId}
          html={lastMessage.textHtml}
          inlineAttachments={lastMessage.inline}
          messageId={lastMessage.id}
        />
      ) : (
        <PlainEmail
          text={
            lastMessage.textPlain ||
            lastMessage.snippet ||
            t`No content available.`
          }
        />
      )}

      {lastMessage.attachments?.length ? (
        <EmailAttachments message={lastMessage} />
      ) : null}
    </OpenedConversationAttachments>
  );

  if (compact) {
    return <div className="max-h-[32rem] overflow-auto px-4 py-3">{body}</div>;
  }

  return (
    <div className="border-t bg-muted/40 p-3">
      <div className="max-h-[32rem] overflow-auto rounded-md border bg-background px-4 py-3 shadow-xs">
        {showDetails ? (
          <div className="mb-3">
            <EmailDetails message={lastMessage} />
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
}

// Models sometimes drop or change a character when copying a thread ID. Only
// link a card to IDs a tool actually returned, so a mistyped one renders as
// plain text instead of a card that fails to load.
function resolveInlineEmailThreadId({
  id,
  threadid,
  knownThreadIds,
}: {
  id?: string;
  threadid?: string;
  knownThreadIds: Set<string> | null;
}) {
  const threadId = getRawInlineEmailThreadId({ id, threadid });
  if (!threadId || !knownThreadIds) return threadId;
  return knownThreadIds.has(threadId) ? threadId : undefined;
}

function getRawInlineEmailThreadId({
  id,
  threadid,
}: {
  id?: string;
  threadid?: string;
}) {
  if (threadid) return threadid;
  if (!id) return;
  if (id.startsWith("user-content-")) {
    return id.slice("user-content-".length) || undefined;
  }
  return id;
}

function getInlineEmailExternalUrl({
  threadId,
  messageId,
  externalUrl,
  userEmail,
  provider,
}: {
  threadId?: string;
  messageId?: string;
  externalUrl?: string;
  userEmail?: string | null;
  provider?: string;
}) {
  if (externalUrl) return externalUrl;
  if (!threadId) return null;
  if (provider === "microsoft") return null;

  return getEmailUrlForMessage(
    messageId ?? threadId,
    threadId,
    userEmail,
    provider,
  );
}

function addThreadIds(current: Set<string>, threadIds: string[]) {
  if (!threadIds.length) return current;

  const next = new Set(current);

  for (const threadId of threadIds) {
    next.add(threadId);
  }

  return next;
}

function getSuccessfulThreadIds(
  threadIds: string[],
  results: Array<{ serverError?: string } | undefined>,
) {
  return threadIds.filter((_, index) => !results[index]?.serverError);
}

function formatCompletedSummary({
  threadIds,
  archivedThreadIds,
  readThreadIds,
  i18n,
}: {
  threadIds: string[];
  archivedThreadIds: Set<string>;
  readThreadIds: Set<string>;
  i18n: I18n;
}) {
  const archivedCount = threadIds.filter((threadId) =>
    archivedThreadIds.has(threadId),
  ).length;
  const readOnlyCount = threadIds.filter(
    (threadId) =>
      !archivedThreadIds.has(threadId) && readThreadIds.has(threadId),
  ).length;

  if (archivedCount > 0 && readOnlyCount > 0) {
    return i18n._(
      msg`${plural(archivedCount, {
        one: "# archived",
        other: "# archived",
      })}, ${plural(readOnlyCount, {
        one: "# marked read",
        other: "# marked read",
      })}`,
    );
  }
  if (archivedCount > 0) {
    return i18n._(
      msg`${plural(archivedCount, { one: "# archived", other: "# archived" })}`,
    );
  }
  if (readOnlyCount > 0) {
    return i18n._(
      msg`${plural(readOnlyCount, {
        one: "# marked read",
        other: "# marked read",
      })}`,
    );
  }
  return "";
}
