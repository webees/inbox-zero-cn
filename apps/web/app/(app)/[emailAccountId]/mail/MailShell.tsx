"use client";

import type { ListThread } from "./types";

import { MailPanelErrorBoundary } from "@/app/(app)/[emailAccountId]/mail/MailPanelErrorBoundary";
import { isThreadStarred } from "@/app/(app)/[emailAccountId]/mail/star-state";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { ListToolbar } from "@/app/(app)/[emailAccountId]/mail/ListToolbar";
import { getMailSearchFolders } from "@/app/(app)/[emailAccountId]/mail/outlook-folder-list";
import { MailAccountSwitcher } from "@/app/(app)/[emailAccountId]/mail/MailAccountSwitcher";
import {
  getMailNavPath,
  MAIL_SCHEDULED_TYPE,
} from "@/app/(app)/[emailAccountId]/mail/MailSidebar";
import { MailShellSidebar } from "@/app/(app)/[emailAccountId]/mail/MailShellSidebar";
import { MailSplitTabs } from "@/app/(app)/[emailAccountId]/mail/MailSplitTabs";
import { SelectAllCheckbox } from "@/app/(app)/[emailAccountId]/mail/SelectAllCheckbox";
import { MailListPanel } from "@/app/(app)/[emailAccountId]/mail/MailListPanel";
import { MailReaderPane } from "@/app/(app)/[emailAccountId]/mail/MailReaderPane";
import { MailTitlebarNav } from "@/app/(app)/[emailAccountId]/mail/MailTitlebarNav";
import { ScheduledEmailList } from "@/app/(app)/[emailAccountId]/mail/ScheduledEmailList";
import type { MailboxItem } from "@/app/(app)/[emailAccountId]/mail/MailboxItemContextMenu";
import { ListSenderCommands } from "@/app/(app)/[emailAccountId]/mail/ListSenderCommands";
import { extractEmailAddress } from "@/utils/email";
import { LabelPickerDialog } from "@/app/(app)/[emailAccountId]/mail/LabelPickerDialog";
import { ThreadList } from "@/app/(app)/[emailAccountId]/mail/ThreadList";
import { useStableCallback } from "@/app/(app)/[emailAccountId]/mail/use-stable-callback";
import { useTranslateThread } from "@/app/(app)/[emailAccountId]/mail/use-thread-translation";
import { GmailLabel } from "@/utils/gmail/label";
import {
  getComposeTargetMessageId,
  getActiveThreadIndex,
  getSearchFocus,
  getNextThreadAfterRemoval,
  resolveThreadActionTargets,
} from "@/app/(app)/[emailAccountId]/mail/thread-list-behavior";
import {
  getListThreadKey,
  getListThreadSelection,
  getThreadSelectionKey,
  type MailLayoutMode,
  type ThreadSelection,
} from "@/app/(app)/[emailAccountId]/mail/types";
import type { ThreadMessage } from "@/components/email-list/types";
import { useMailThreads } from "@/app/(app)/[emailAccountId]/mail/use-mail-threads";
import { useCombinedMailThreads } from "@/app/(app)/[emailAccountId]/mail/use-combined-mail-threads";
import { useThreadActions } from "@/app/(app)/[emailAccountId]/mail/use-thread-actions";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import { MailProductFrame } from "@inboxzero/mail-ui/MailProductFrame";
import { MailEngineConnectionBanner } from "@/utils/mail-engine/MailEngineConnectionBanner";
import { useThreadSelection } from "@/app/(app)/[emailAccountId]/mail/use-thread-selection";
import { useWarmNeighbourThreads } from "@/app/(app)/[emailAccountId]/mail/use-warm-neighbour-threads";
import { useMailPerformanceTelemetry } from "@/app/(app)/[emailAccountId]/mail/use-mail-performance-telemetry";
import {
  isThreadArchived,
  isThreadUnread,
} from "@/app/(app)/[emailAccountId]/mail/read-state";
import { MailLayout, MailSplitFilterKind } from "@/generated/prisma/enums";
import { useSidebar } from "@/components/ui/sidebar";
import { useAtomValue, useSetAtom } from "jotai";
import {
  commandPaletteOpenAtom,
  mailCommandContextAtom,
  senderCommandContextAtom,
  shortcutsDialogOpenAtom,
} from "@/store/command-palette";
import {
  EmailAccountScopeProvider,
  useAccount,
} from "@/providers/EmailAccountProvider";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { getOpenInMailboxLabel } from "@/utils/url";
import { useEmailLabels } from "@/providers/EmailLabelsProvider";
import { undoLatestToast } from "@/components/Toast";
import { useDisplayedEmail } from "@/hooks/useDisplayedEmail";
import { useLabels } from "@/hooks/useLabels";
import { useFolders } from "@/hooks/useFolders";
import { useMailSettings } from "@/hooks/useMailSettings";
import { useAccounts } from "@/hooks/useAccounts";
import { useThread } from "@/hooks/useThread";
import { useShortcuts } from "@/lib/shortcuts/useShortcuts";
import type { ShortcutHandlers } from "@/lib/shortcuts/registry";
import { updateMailPreferencesAction } from "@/utils/actions/mail-split";
import type { UpdateMailPreferencesBody } from "@/utils/actions/mail-split.validation";
import { submitConversationChange } from "@/utils/mail-engine/submit-conversations";
import { admissionRejectionCopy } from "@/utils/mail-engine/admission-notice";
import {
  getPortableLabelSplits,
  OTHER_SPLIT_ID,
  otherMailSplitQuery,
  mailSplitToThreadsQuery,
  mailTypeToThreadsQuery,
} from "@/utils/split-inbox/split-query";
import { getActionErrorMessage } from "@/utils/error";
import { prefixPath } from "@/utils/path";
import { getMailAccountUrl } from "@/app/(app)/[emailAccountId]/mail/mail-account-url";
import { redirectToSafeUrl } from "@/utils/redirect";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";
import { LoadingContent } from "@/components/LoadingContent";
import { useTeamCommentsAvailable } from "@/components/team-comments/use-team-comments-available";
import { getEmailMessageCellActions } from "@/components/EmailMessageCellActions";
import type { ThreadsQuery } from "@/utils/threads/validation";

// 放在模块层级，这样“空”的阅读器不会在每次渲染时向子组件传入新数组。
const NO_MESSAGES: ThreadMessage[] = [];
const NO_LABELS = {};

/**
 * 负责邮件屏幕的 URL、会话列表、选择与分诊状态，
 * 并由记忆化的部分组合出侧边栏、列表与阅读器。J/K 与引擎
 * 快照会重新渲染该组件，因此向下传递的一切都保持
 * 引用稳定，只有输入发生变化的部分才重新渲染。
 */
export function MailShell() {
  const { emailAccount, emailAccountId, userEmail, provider } = useAccount();
  const { data: accountsData } = useAccounts();
  const isGoogle = isGoogleProvider(provider);
  const isOutlook = isMicrosoftProvider(provider);
  const { userLabels } = useEmailLabels();
  const { userLabels: allLabels, mutate: mutateLabels } = useLabels();
  const { folders } = useFolders(provider);
  const { data: settings, mutate: mutateSettings } = useMailSettings();
  const { toggleSidebar } = useSidebar();
  const isPaletteOpen = useAtomValue(commandPaletteOpenAtom);
  const isHelpOpen = useAtomValue(shortcutsDialogOpenAtom);
  const setIsHelpOpen = useSetAtom(shortcutsDialogOpenAtom);
  const senderCommandContext = useAtomValue(senderCommandContextAtom);
  const setMailCommandContext = useSetAtom(mailCommandContextAtom);
  // 侧边栏查看器打开时拥有分诊快捷键，因此此屏幕
  // 会让位，避免同一按键被同时归档。
  const { threadId: sidePanelThreadId } = useDisplayedEmail();
  const client = useOptionalMailClient();

  const [openThreadQuery, setOpenThreadQuery] = useQueryStates({
    "thread-id": parseAsString,
    "thread-account-id": parseAsString,
  });
  const openThreadId = openThreadQuery["thread-id"];
  const openThreadAccountId = openThreadQuery["thread-account-id"];
  const [activeSplitId, setActiveSplitId] = useQueryState("split");
  const [accountScope, setAccountScope] = useQueryState("accountScope");
  const [scopeType, setScopeType] = useQueryState("type");
  const [scopeLabelId, setScopeLabelId] = useQueryState("labelId");
  const [scopeFolderId, setScopeFolderId] = useQueryState("folderId");
  const [searchParam, setSearchParam] = useQueryState("q");

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [labelPicker, setLabelPicker] = useState<{
    mode: "label" | "move";
    targets: ThreadSelection[];
  } | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState<string>();
  const [forwardToMessageId, setForwardToMessageId] = useState<string>();
  const pendingComposeRequest = useRef<{
    mode: "reply" | "forward";
    threadKey: string;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocusRef = useRef(false);

  useEffect(() => {
    setIsDesktopApp(Boolean(getInboxZeroDesktopApp()));
  }, []);

  const isAllAccounts = accountScope === "all";
  const setOpenThread = useCallback(
    (selection: ThreadSelection | null) => {
      setIsMenuOpen(false);
      return setOpenThreadQuery({
        "thread-id": selection?.threadId ?? null,
        "thread-account-id":
          isAllAccounts && selection ? selection.emailAccountId : null,
      });
    },
    [isAllAccounts, setOpenThreadQuery],
  );
  const combinedAccounts = useMemo(
    () =>
      (accountsData?.emailAccounts ?? [])
        .filter(
          (emailAccount) =>
            emailAccount.includeInAllAccounts &&
            emailAccount.account.disconnectedAt === null,
        )
        .map(({ id, email, name, image }) => ({
          id,
          email,
          name,
          image,
        })),
    [accountsData?.emailAccounts],
  );
  const accountLayout: MailLayoutMode =
    settings?.layout === MailLayout.SPLIT ? "split" : "list";
  const layout = isAllAccounts ? "list" : accountLayout;
  const expandedPreview = settings?.expandedPreview ?? false;

  // 通过 SWR 缓存写入而非镜像到本地状态，因此该偏好
  // 只有一个真实来源，每个读取者都能看到新值。
  const updatePreferences = useCallback(
    (preferences: UpdateMailPreferencesBody) => {
      if (!settings) return;
      const loadedSettings = settings;

      mutateSettings(
        async (current) => {
          const result = await updateMailPreferencesAction(
            emailAccountId,
            preferences,
          );
          // 抛出异常以便 SWR 回滚乐观值，而不是让
          // UI 显示服务器从未接受的偏好。
          if (result?.serverError || result?.validationErrors)
            throw new Error(getActionErrorMessage(result));
          return { ...(current ?? loadedSettings), ...preferences };
        },
        {
          optimisticData: (current) => ({
            ...(current ?? loadedSettings),
            ...preferences,
          }),
          revalidate: false,
          rollbackOnError: true,
        },
      ).catch((error) => {
        toast.error(error instanceof Error ? error.message : "无法保存");
      });
    },
    [emailAccountId, mutateSettings, settings],
  );

  const toggleLayout = useCallback(
    () =>
      updatePreferences({
        layout: layout === "split" ? MailLayout.LIST : MailLayout.SPLIT,
      }),
    [layout, updatePreferences],
  );

  const togglePreview = useCallback(
    () => updatePreferences({ expandedPreview: !expandedPreview }),
    [expandedPreview, updatePreferences],
  );

  // 侧边栏选择会限定整个列表的范围，从而替代分栏标签——
  // 分栏是切分收件箱的方式，而不是切分任意视图的方式。
  // 只解析一次，这样标签栏与获取到的行不会不一致。
  const scopeQuery: ThreadsQuery | null = useMemo(() => {
    if (scopeLabelId) return { labelId: scopeLabelId };
    if (scopeFolderId) return { folderId: scopeFolderId };
    if (scopeType && scopeType !== "inbox")
      return mailTypeToThreadsQuery(scopeType);
    return null;
  }, [scopeFolderId, scopeLabelId, scopeType]);
  const isScoped = !isAllAccounts && scopeQuery !== null;

  const searchEditIdentity = JSON.stringify([
    emailAccountId,
    isAllAccounts,
    searchParam,
    scopeType,
    scopeLabelId,
    scopeFolderId,
  ]);
  const [searchDraft, setSearchDraft] = useState<{
    identity: string;
    value: string;
  }>();
  if (searchDraft && searchDraft.identity !== searchEditIdentity)
    setSearchDraft(undefined);
  const searchValue =
    (searchDraft?.identity === searchEditIdentity
      ? searchDraft.value
      : searchParam) ?? "";
  const searchQuery = searchValue.trim() || null;
  // 定时发送保存在我们自己的数据库中，因此此视图没有
  // 会话列表需要获取。
  const isScheduledView =
    !isAllAccounts && !searchQuery && scopeType === MAIL_SCHEDULED_TYPE;
  const [settledSearch, setSettledSearch] = useState(searchQuery);
  useEffect(() => {
    const timeout = setTimeout(() => setSettledSearch(searchQuery), 250);
    return () => clearTimeout(timeout);
  }, [searchQuery]);
  const searchSettled = !searchQuery || searchQuery === settledSearch;
  const setSearch = useCallback(
    (value: string) => {
      setSearchDraft(undefined);
      setSettledSearch(value.trim() || null);
      return setSearchParam(value.trim() || null);
    },
    [setSearchParam],
  );
  const onSearchChange = useCallback(
    (value: string) => setSearchDraft({ identity: searchEditIdentity, value }),
    [searchEditIdentity],
  );
  // Picking the view that's already open leaves the URL unchanged, so an
  // unsubmitted search would otherwise keep filtering the list.
  const discardSearchDraft = useCallback(() => setSearchDraft(undefined), []);

  const combinedLabelSplits = useMemo(
    () => getPortableLabelSplits(settings?.splits ?? [], userLabels),
    [settings?.splits, userLabels],
  );

  const splits = useMemo(
    () =>
      [
        ...(settings?.splits ?? []).map((split) => ({
          ...split,
          name:
            isGoogle && split.name.trim().toLowerCase() === "other"
              ? `${split.name}（自定义）`
              : split.name,
        })),
        ...(isGoogle && !isAllAccounts
          ? [
              {
                id: OTHER_SPLIT_ID,
                name: "其他",
                matchAll: true,
                filters: [],
              },
            ]
          : []),
      ].filter(
        (split) =>
          !isAllAccounts ||
          split.filters.every(
            (filter) => filter.kind === MailSplitFilterKind.UNREAD,
          ) ||
          combinedLabelSplits.some((portable) => portable.id === split.id),
      ),
    [settings?.splits, isAllAccounts, combinedLabelSplits, isGoogle],
  );
  const splitTabs = useMemo(
    () =>
      splits.map((split) => ({
        ...split,
        deletable: split.filters.length > 0,
      })),
    [splits],
  );
  const activeSplit =
    splits.find((split) => split.id === activeSplitId) ?? splits[0];
  const displayedActiveSplitId = activeSplit?.id ?? null;
  const activeCombinedLabelNames = combinedLabelSplits.find(
    (split) => split.id === displayedActiveSplitId,
  )?.labelNames;
  const query: ThreadsQuery = useMemo(() => {
    // 搜索会覆盖分栏/范围并覆盖整个邮箱，与 Gmail 和 Outlook
    // 自带搜索框的默认行为一致。
    if (searchQuery) return { q: searchQuery };
    if (scopeQuery) return scopeQuery;

    if (activeSplit?.id === OTHER_SPLIT_ID) return otherMailSplitQuery(splits);
    return activeSplit
      ? mailSplitToThreadsQuery(activeSplit)
      : { type: "inbox" };
  }, [searchQuery, scopeQuery, activeSplit, splits]);

  const accountThreadState = useMailThreads({
    emailAccountId,
    query,
    enabled: !isAllAccounts && searchSettled && !isScheduledView,
  });
  const combinedThreadState = useCombinedMailThreads({
    accounts: combinedAccounts,
    emailAccountId,
    enabled: isAllAccounts && searchSettled,
    isUnread:
      !searchQuery &&
      !!activeSplit?.filters.length &&
      activeSplit.filters.every(
        (filter) => filter.kind === MailSplitFilterKind.UNREAD,
      ),
    labelNames: searchQuery ? undefined : activeCombinedLabelNames,
    searchQuery: searchQuery ?? undefined,
  });
  const { labelsByAccount } = combinedThreadState;
  const splitCountAccountIds = useMemo(
    () =>
      isAllAccounts
        ? combinedAccounts.map((account) => account.id)
        : [emailAccountId],
    [combinedAccounts, emailAccountId, isAllAccounts],
  );
  const {
    threads: remoteThreads,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
    refetch: refetchThreadList,
  } = isAllAccounts ? combinedThreadState : accountThreadState;
  const providerState = isAllAccounts
    ? combinedThreadState
    : accountThreadState;
  const hasProviderResponse = searchSettled && providerState.hasRemoteResponse;
  const threads = searchSettled ? remoteThreads : EMPTY_SEARCH_THREADS;
  const searchViewIdentity = JSON.stringify([
    emailAccountId,
    isAllAccounts,
    searchQuery,
  ]);
  const orderedIds = useStableOrderedIds(threads);
  const previousSearchFocus = useRef<
    ReturnType<typeof getSearchFocus> | undefined
  >(undefined);
  useLayoutEffect(() => {
    const next = getSearchFocus({
      previous: previousSearchFocus.current,
      view: searchQuery ? searchViewIdentity : null,
      focusedIndex,
      orderedIds,
    });
    previousSearchFocus.current = next;
    if (next.index !== focusedIndex) setFocusedIndex(next.index);
  }, [orderedIds, focusedIndex, searchQuery, searchViewIdentity]);
  let emptySearchMessage: string | undefined;
  if (searchQuery && hasProviderResponse && !threads.length) {
    emptySearchMessage = "此视图中没有邮件";
  }

  const selection = useThreadSelection(orderedIds);

  const clampIndex = useCallback(
    (index: number) =>
      Math.min(Math.max(0, index), Math.max(0, threads.length - 1)),
    [threads.length],
  );
  const openThreadSelection = useMemo<ThreadSelection | null>(() => {
    if (!openThreadId) return null;
    const ownerEmailAccountId = isAllAccounts
      ? openThreadAccountId
      : emailAccountId;
    if (!ownerEmailAccountId) return null;
    return {
      emailAccountId: ownerEmailAccountId,
      threadId: openThreadId,
    };
  }, [emailAccountId, isAllAccounts, openThreadAccountId, openThreadId]);
  const openThreadKey = isAllAccounts
    ? getThreadSelectionKey(openThreadSelection)
    : openThreadId;
  const readerEmailAccount = openThreadSelection
    ? openThreadSelection.emailAccountId === emailAccountId
      ? emailAccount
      : accountsData?.emailAccounts.find(
          (account) => account.id === openThreadSelection.emailAccountId,
        )
    : emailAccount;
  const clampedIndex = getActiveThreadIndex({
    threadIds: orderedIds,
    focusedIndex,
    openThreadId: openThreadKey,
  });
  const focusedThread = threads[clampedIndex];
  const openThread = openThreadKey
    ? threads.find((thread) => getListThreadKey(thread) === openThreadKey)
    : undefined;
  const readAttemptedForOpenThread = useRef<string | null>(null);
  useWarmNeighbourThreads({ threads, openThreadKey, emailAccountId });

  // 将这一对作为一个值延迟：当 J/K 在账号行之间移动时，把新 id
  // 与上一个账号一起渲染，比提前获取更糟。
  const deferredReaderSelection = useDeferredValue(openThreadSelection);
  const readerThreadKey = getThreadSelectionKey(deferredReaderSelection);
  const openReaderThreadKey = getThreadSelectionKey(openThreadSelection);
  useLayoutEffect(() => {
    if (openReaderThreadKey) setIsMenuOpen(false);
  }, [openReaderThreadKey]);
  const readerSelectionSettled = readerThreadKey === openReaderThreadKey;
  const [visibleReaderThreadKey, setVisibleReaderThreadKey] =
    useState<string>();
  useMailPerformanceTelemetry({
    openThreadKey: openReaderThreadKey,
    visibleThreadKey: visibleReaderThreadKey,
  });
  const {
    data: openThreadData,
    error: openThreadError,
    isLoading: isOpenThreadLoading,
    mutate: refetchOpenThread,
    localAvailability: openThreadLocalAvailability,
  } = useThread(
    {
      id: deferredReaderSelection?.threadId ?? null,
      emailAccountId: deferredReaderSelection?.emailAccountId,
    },
    { includeDrafts: true, localMail: true },
  );
  // 延迟到延迟的 id 跟上之前不提供，这样快速按 J/K 不会把新
  // 会话的头部与上一个会话的正文配对。
  const openMessages = readerSelectionSettled
    ? (openThreadData?.thread.messages ?? NO_MESSAGES)
    : NO_MESSAGES;
  const openExternalUrl = useMemo(() => {
    const message = openMessages.at(-1);
    if (!message || !readerEmailAccount) return;
    return getEmailMessageCellActions({
      externalUrl: message.externalUrl,
      messageId: message.id,
      provider: readerEmailAccount.account.provider,
      threadId: message.threadId,
      userEmail: readerEmailAccount.email,
    })?.openUrl;
  }, [openMessages, readerEmailAccount]);
  const translateThread = useTranslateThread();
  const readerEmailAccountId = readerEmailAccount?.id;
  const translateOpenThread = useMemo(() => {
    const threadId = openMessages.at(-1)?.threadId;
    const messageIds = openMessages
      .filter((message) => !message.labelIds?.includes(GmailLabel.DRAFT))
      .map((message) => message.id);
    if (!readerEmailAccountId || !threadId || !messageIds.length) return;
    return () => {
      translateThread({
        emailAccountId: readerEmailAccountId,
        threadId,
        messageIds,
      });
    };
  }, [openMessages, readerEmailAccountId, translateThread]);
  const teamCommentsAvailable = useTeamCommentsAvailable(readerEmailAccountId);
  const openTeamComments = useMemo(
    () =>
      // 监听器随会话的消息一起挂载，因此更早的请求
      // 会被丢弃。
      openThreadId &&
      readerSelectionSettled &&
      openMessages.length > 0 &&
      teamCommentsAvailable
        ? () => document.dispatchEvent(new Event("team-comments:open"))
        : undefined,
    [
      openThreadId,
      readerSelectionSettled,
      openMessages.length,
      teamCommentsAvailable,
    ],
  );
  const readerTarget = useMemo(() => {
    if (!openThreadKey || !openThreadSelection || !readerSelectionSettled)
      return;
    const messageIds = [...new Set(openMessages.map((message) => message.id))];
    if (!messageIds.length) return;
    return {
      emailAccountId: openThreadSelection.emailAccountId,
      key: openThreadKey,
      messageIds,
      threadId: openThreadSelection.threadId,
    };
  }, [
    openMessages,
    openThreadKey,
    openThreadSelection,
    readerSelectionSettled,
  ]);
  const actionTargets = useMemo(() => {
    // 导航可能快于可见的阅读器；不要对未看到的邮件执行操作。
    if (
      openReaderThreadKey &&
      openReaderThreadKey !== visibleReaderThreadKey &&
      !selection.hasSelection
    )
      return [];
    const listTargets = threads.map((thread) => ({
      key: getListThreadKey(thread),
      messages: thread.messages,
      selection: getListThreadSelection(thread, emailAccountId),
    }));
    const openTarget =
      openThreadKey && openThreadSelection && (openThread || readerTarget)
        ? {
            key: openThreadKey,
            messages: openThread?.messages ?? openMessages,
            selection: openThreadSelection,
          }
        : undefined;

    return resolveThreadActionTargets({
      focusedKey: focusedThread ? getListThreadKey(focusedThread) : undefined,
      listTargets,
      openTarget,
      selectedKeys: [...selection.selectedIds],
    });
  }, [
    emailAccountId,
    focusedThread,
    openReaderThreadKey,
    visibleReaderThreadKey,
    selection.hasSelection,
    openMessages,
    openThread,
    openThreadKey,
    openThreadSelection,
    readerTarget,
    selection.selectedIds,
    threads,
  ]);
  const {
    archive,
    moveToInbox,
    trash,
    markSpam,
    setReadState,
    setStarredState,
    snooze,
    undo,
  } = useThreadActions({
    emailAccountId,
    readerTarget,
    threads,
  });
  const markRead = useCallback(
    (threadKeys: string[]) => setReadState(threadKeys, true, false),
    [setReadState],
  );
  const composeTargetMessageId = getComposeTargetMessageId(openMessages);
  const requestReaderReply = useCallback(() => {
    const messageId = composeTargetMessageId;
    if (messageId) {
      pendingComposeRequest.current = null;
      setForwardToMessageId(undefined);
      setReplyToMessageId(messageId);
      return;
    }

    if (openReaderThreadKey) {
      pendingComposeRequest.current = {
        mode: "reply",
        threadKey: openReaderThreadKey,
      };
    }
  }, [composeTargetMessageId, openReaderThreadKey]);

  const requestReaderForward = useCallback(() => {
    const messageId = composeTargetMessageId;
    if (messageId) {
      pendingComposeRequest.current = null;
      setReplyToMessageId(undefined);
      setForwardToMessageId(messageId);
      return;
    }

    if (openReaderThreadKey) {
      pendingComposeRequest.current = {
        mode: "forward",
        threadKey: openReaderThreadKey,
      };
    }
  }, [composeTargetMessageId, openReaderThreadKey]);

  useEffect(() => {
    const pendingRequest = pendingComposeRequest.current;
    if (!pendingRequest) return;
    if (pendingRequest.threadKey !== openReaderThreadKey) {
      pendingComposeRequest.current = null;
      return;
    }

    const messageId = composeTargetMessageId;
    if (!readerSelectionSettled || !messageId) return;

    pendingComposeRequest.current = null;
    if (pendingRequest.mode === "reply") {
      setForwardToMessageId(undefined);
      setReplyToMessageId(messageId);
    } else {
      setReplyToMessageId(undefined);
      setForwardToMessageId(messageId);
    }
  }, [composeTargetMessageId, openReaderThreadKey, readerSelectionSettled]);

  // 让获取到的快照决定初始已读状态。一旦尝试过标记，
  // 乐观修补过的行就是保持同步的副本，
  // 而获取到的快照可能仍是旧的。
  const initialReadStateMessages = openMessages.length
    ? openMessages
    : (openThread?.messages ?? openMessages);
  const readStateMessages =
    readAttemptedForOpenThread.current === openThreadKey
      ? (openThread?.messages ?? openMessages)
      : initialReadStateMessages;
  const isOpenThreadUnread = isThreadUnread(readStateMessages);

  const labelHref = useCallback(
    (labelId: string) =>
      prefixPath(
        openThreadSelection?.emailAccountId ?? emailAccountId,
        getMailNavPath({ kind: "label", labelId }),
      ),
    [emailAccountId, openThreadSelection?.emailAccountId],
  );

  const getOpenThreadKey = useStableCallback(() => openThreadKey);
  const advanceReaderPast = useStableCallback(
    (currentThreadKey: string, removedThreadKeys: string[]) => {
      const nextThread = getNextThreadAfterRemoval({
        threadIds: orderedIds,
        currentThreadId: currentThreadKey,
        currentThreadIndex: focusedIndex,
        removedThreadIds: removedThreadKeys,
      });
      setFocusedIndex(nextThread?.index ?? 0);
      const nextRow = threads.find(
        (thread) => getListThreadKey(thread) === nextThread?.id,
      );
      setOpenThread(
        nextRow ? getListThreadSelection(nextRow, emailAccountId) : null,
      );
    },
  );
  const runOn = useStableCallback(
    async (
      action: (ids: string[]) => Promise<string[]>,
      removeFromList: boolean,
      autoAdvanceReader = false,
    ) => {
      const ids = actionTargets.map((target) => target.key);
      if (!ids.length) return;
      const hadSelection = selection.hasSelection;
      const queuedThreadKeys = await action(ids);
      if (!queuedThreadKeys.length) return;
      if (
        removeFromList &&
        openThreadKey &&
        queuedThreadKeys.includes(openThreadKey) &&
        // 操作排队期间用户可能已打开另一个会话。
        getOpenThreadKey() === openThreadKey
      ) {
        if (autoAdvanceReader) {
          advanceReaderPast(openThreadKey, queuedThreadKeys);
        } else {
          setOpenThread(null);
        }
      }
      selection.clear();
      if (hadSelection && queuedThreadKeys.length < ids.length) {
        const queued = new Set(queuedThreadKeys);
        for (const id of ids) {
          if (queued.has(id)) continue;
          const index = orderedIds.indexOf(id);
          if (index >= 0) selection.toggle(index);
        }
      }
    },
  );

  const openAt = useStableCallback((index: number) => {
    const thread = threads[index];
    if (!thread) return;
    setFocusedIndex(index);
    setReplyToMessageId(undefined);
    setForwardToMessageId(undefined);
    selection.clear();
    setOpenThread(getListThreadSelection(thread, emailAccountId));
  });

  const move = useCallback(
    (delta: number) => {
      const next = clampIndex(clampedIndex + delta);
      setFocusedIndex(next);
      // 阅读器打开后，导航会使其内容与位置保持同步。
      // 关闭的列表视图仍允许 J/K 单独移动行光标——
      // 此时光标仍表示意图，因此为 Enter 预热该行。
      const nextThread = threads[next];
      if ((layout === "split" || openThreadId) && nextThread) {
        setReplyToMessageId(undefined);
        setForwardToMessageId(undefined);
        setOpenThread(getListThreadSelection(nextThread, emailAccountId));
      }
    },
    [
      clampIndex,
      clampedIndex,
      threads,
      layout,
      openThreadId,
      setOpenThread,
      emailAccountId,
    ],
  );

  const extendSelection = useCallback(
    (delta: number) => {
      const next = clampIndex(clampedIndex + delta);
      selection.extendTo(next, clampedIndex);
      setFocusedIndex(next);
    },
    [clampIndex, clampedIndex, selection],
  );

  useEffect(() => {
    if (!openReaderThreadKey) {
      readAttemptedForOpenThread.current = null;
      return;
    }
    if (
      !openThreadKey ||
      !readerSelectionSettled ||
      !openMessages.length ||
      readAttemptedForOpenThread.current === openThreadKey
    ) {
      return;
    }
    if (!isOpenThreadUnread) {
      // 缓存的已读快照可能先于新的未读响应到达。
      return;
    }

    // 记住持久化的尝试，这样当发件箱等待连接或服务商恢复时，
    // 该阅读器不会重复排队。
    readAttemptedForOpenThread.current = openThreadKey;
    markRead([openThreadKey]);
  }, [
    isOpenThreadUnread,
    markRead,
    openMessages.length,
    openReaderThreadKey,
    openThreadKey,
    readerSelectionSettled,
  ]);
  const archiveTargets = useCallback(
    () => runOn(archive, true, true),
    [archive, runOn],
  );
  // 再次归档不会有效果，因此已归档的目标提供返回路径。
  const moveToInboxTargets = useCallback(
    () => runOn(moveToInbox, true, true),
    [moveToInbox, runOn],
  );
  const targetsArchived =
    actionTargets.length > 0 &&
    actionTargets.every((target) => isThreadArchived(target.messages));
  const trashTargets = useCallback(
    () => runOn(trash, true, true),
    [runOn, trash],
  );
  const markSpamTargets = useCallback(
    () => runOn(markSpam, true, true),
    [markSpam, runOn],
  );
  const markReadTargets = useCallback(
    () => runOn(markRead, false),
    [markRead, runOn],
  );
  const markUnreadTargets = useStableCallback(() =>
    runOn((ids) => {
      if (openThreadKey && ids.includes(openThreadKey)) {
        readAttemptedForOpenThread.current = openThreadKey;
      }
      return setReadState(ids, false);
    }, true),
  );
  const allStarred =
    actionTargets.length > 0 &&
    actionTargets.every((target) => isThreadStarred(target.messages));
  const starTargets = useCallback(
    () => runOn((ids) => setStarredState(ids, !allStarred), false),
    [runOn, setStarredState, allStarred],
  );
  const snoozeTargets = useCallback(
    (until: Date) => runOn((ids) => snooze(ids, until), true, true),
    [runOn, snooze],
  );
  const currentLabelTargets = useMemo(
    () => actionTargets.map((target) => target.selection),
    [actionTargets],
  );
  const labelAccountId = currentLabelTargets[0]?.emailAccountId;
  const labelAccount =
    labelAccountId === emailAccountId
      ? emailAccount
      : accountsData?.emailAccounts.find(
          (account) => account.id === labelAccountId,
        );
  // Outlook 分类与 Gmail 标签使用相同的引擎成员关系命令。
  const canLabel =
    currentLabelTargets.length > 0 &&
    (isGoogleProvider(labelAccount?.account.provider) ||
      isMicrosoftProvider(labelAccount?.account.provider)) &&
    currentLabelTargets.every(
      (target) => target.emailAccountId === labelAccountId,
    );
  const openLabelPicker = useStableCallback(() => {
    if (canLabel)
      setLabelPicker({ mode: "label", targets: currentLabelTargets });
  });
  const openMovePicker = useStableCallback(() => {
    if (canLabel)
      setLabelPicker({ mode: "move", targets: currentLabelTargets });
  });
  const singleActionTarget =
    actionTargets.length === 1 ? actionTargets.at(0) : undefined;
  const requestForwardTarget = useStableCallback(() => {
    if (!singleActionTarget) return;
    if (singleActionTarget.key === openThreadKey) {
      requestReaderForward();
      return;
    }

    const targetIndex = threads.findIndex(
      (thread) => getListThreadKey(thread) === singleActionTarget.key,
    );
    const targetThreadKey = getThreadSelectionKey(singleActionTarget.selection);
    if (!targetThreadKey) return;
    pendingComposeRequest.current = {
      mode: "forward",
      threadKey: targetThreadKey,
    };
    if (targetIndex >= 0) setFocusedIndex(targetIndex);
    setReplyToMessageId(undefined);
    setForwardToMessageId(undefined);
    setOpenThread(singleActionTarget.selection);
  });
  const pickerAccount =
    labelPicker?.targets[0]?.emailAccountId === emailAccountId
      ? emailAccount
      : accountsData?.emailAccounts.find(
          (account) => account.id === labelPicker?.targets[0]?.emailAccountId,
        );
  const senderAccount =
    singleActionTarget?.selection.emailAccountId === emailAccountId
      ? emailAccount
      : accountsData?.emailAccounts.find(
          (account) =>
            account.id === singleActionTarget?.selection.emailAccountId,
        );
  const isReaderTarget =
    singleActionTarget !== undefined &&
    singleActionTarget.key === openThreadKey;

  const mailCommandContext = useMemo(
    () => ({
      actions: {
        archive: archiveTargets,
        moveToInbox: targetsArchived ? moveToInboxTargets : undefined,
        forward: singleActionTarget ? requestForwardTarget : undefined,
        label: canLabel ? openLabelPicker : undefined,
        star: starTargets,
        markRead: markReadTargets,
        markSpam: markSpamTargets,
        markUnread: markUnreadTargets,
        move: canLabel ? openMovePicker : undefined,
        openExternal:
          isReaderTarget && openExternalUrl
            ? () =>
                window.open(openExternalUrl, "_blank", "noopener,noreferrer")
            : undefined,
        snooze: snoozeTargets,
        translate: isReaderTarget ? translateOpenThread : undefined,
        comment: isReaderTarget ? openTeamComments : undefined,
        trash: trashTargets,
      },
      allStarred,
      hasRead: actionTargets.some((target) => !isThreadUnread(target.messages)),
      hasUnread: actionTargets.some((target) =>
        isThreadUnread(target.messages),
      ),
      openExternalLabel:
        isReaderTarget && openExternalUrl
          ? (getOpenInMailboxLabel(readerEmailAccount?.account.provider) ??
            undefined)
          : undefined,
      target: singleActionTarget
        ? {
            emailAccountId: singleActionTarget.selection.emailAccountId,
            threadId: singleActionTarget.selection.threadId,
          }
        : undefined,
      targetCount: actionTargets.length,
    }),
    [
      archiveTargets,
      moveToInboxTargets,
      targetsArchived,
      actionTargets,
      canLabel,
      isReaderTarget,
      allStarred,
      starTargets,
      markReadTargets,
      markSpamTargets,
      markUnreadTargets,
      openLabelPicker,
      openMovePicker,
      openExternalUrl,
      readerEmailAccount?.account.provider,
      requestForwardTarget,
      singleActionTarget,
      snoozeTargets,
      translateOpenThread,
      openTeamComments,
      trashTargets,
    ],
  );

  useEffect(() => {
    setMailCommandContext(
      mailCommandContext.targetCount ? mailCommandContext : null,
    );
    return () => setMailCommandContext(null);
  }, [mailCommandContext, setMailCommandContext]);
  const isMailOverlayOpen =
    isHelpOpen ||
    isPaletteOpen ||
    Boolean(labelPicker) ||
    (isMenuOpen && Boolean(openThreadId));

  const selectAccount = useCallback((accountId: string) => {
    redirectToSafeUrl(getMailAccountUrl(accountId, window.location.search));
  }, []);

  const selectAllAccounts = useCallback(() => {
    setSearchDraft(undefined);
    selection.clear();
    setFocusedIndex(0);
    setOpenThread(null);
    setScopeType(null);
    setScopeLabelId(null);
    setScopeFolderId(null);
    setSearchParam(null);
    if (
      !settings?.splits.some(
        (split) =>
          split.id === activeSplitId &&
          split.filters.every(
            (filter) => filter.kind === MailSplitFilterKind.UNREAD,
          ),
      ) &&
      !combinedLabelSplits.some((split) => split.id === activeSplitId)
    ) {
      setActiveSplitId(null);
    }
    setAccountScope("all");
  }, [
    activeSplitId,
    settings?.splits,
    combinedLabelSplits,
    selection.clear,
    setAccountScope,
    setActiveSplitId,
    setOpenThread,
    setScopeFolderId,
    setScopeLabelId,
    setScopeType,
    setSearchParam,
  ]);

  const closeReader = useCallback(() => {
    setOpenThread(null);
  }, [setOpenThread]);

  const senderCommands =
    senderCommandContext?.emailAccountId ===
      singleActionTarget?.selection.emailAccountId &&
    senderCommandContext?.threadId === singleActionTarget?.selection.threadId
      ? senderCommandContext
      : null;
  // `useShortcuts` 将处理函数保存在 ref 中，因此这些无需记忆化。
  const handlers: ShortcutHandlers = (() => {
    if (sidePanelThreadId || labelPicker) return {};
    return {
      unsubscribe:
        !isMailOverlayOpen && !senderCommands?.isUnsubscribeDisabled
          ? senderCommands?.unsubscribe
          : undefined,
      toggleAutoArchive:
        !isMailOverlayOpen && !senderCommands?.isAutoArchiveDisabled
          ? senderCommands?.toggleAutoArchive
          : undefined,
      next: (event) => {
        if (openThreadId && event?.key === "ArrowDown") return;
        move(1);
      },
      previous: (event) => {
        if (openThreadId && event?.key === "ArrowUp") return;
        move(-1);
      },
      open: openThreadId
        ? (event) => {
            if (
              event?.target instanceof Element &&
              event.target.closest("[data-thread-message-id]")
            )
              return;
            requestReaderReply();
          }
        : () => openAt(clampedIndex),
      backToList: isMailOverlayOpen
        ? undefined
        : () => {
            if (selection.hasSelection) selection.clear();
            else if (layout === "list" && openThreadId) closeReader();
            else if (searchValue) setSearch("");
          },
      nextSplit: () => {
        const index = splits.findIndex(
          (split) => split.id === displayedActiveSplitId,
        );
        const next = splits[(index + 1) % splits.length];
        if (next) setActiveSplitId(next.id);
      },
      switchAccount: (event) => {
        const accountNumber = Number(event?.key);
        if (
          !Number.isInteger(accountNumber) ||
          accountNumber < 1 ||
          accountNumber > 9
        )
          return;
        const account = accountsData?.emailAccounts.at(accountNumber - 1);
        if (account && (isAllAccounts || account.id !== emailAccountId)) {
          selectAccount(account.id);
        }
      },
      switchAllAccounts: selectAllAccounts,
      select: () => selection.toggle(clampedIndex),
      selectAll: selection.selectAll,
      // 光标随扩展一起移动；否则每次重复都会
      // 从同一行重新扩展，范围永远不会增长。
      extendSelectionDown: () => extendSelection(1),
      extendSelectionUp: () => extendSelection(-1),
      label: canLabel ? openLabelPicker : undefined,
      move: canLabel ? openMovePicker : undefined,
      archive: targetsArchived ? undefined : archiveTargets,
      star: starTargets,
      markSpam: markSpamTargets,
      markUnread: markUnreadTargets,
      delete: trashTargets,
      reply: () => {
        setForwardToMessageId(undefined);
        if (!openThreadId && focusedThread) {
          setOpenThread(getListThreadSelection(focusedThread, emailAccountId));
        }
        setReplyToMessageId(composeTargetMessageId);
      },
      forward: singleActionTarget ? requestForwardTarget : undefined,
      moreActions: openThreadId
        ? () => setIsMenuOpen((open) => !open)
        : undefined,
      openTeamComments,
      openExternal:
        isReaderTarget && openExternalUrl
          ? () => window.open(openExternalUrl, "_blank", "noopener,noreferrer")
          : undefined,
      translate: isMailOverlayOpen ? undefined : translateOpenThread,
      undo: async () => {
        if (await undoLatestToast()) return;
        await undo();
      },
      toggleLayout: isAllAccounts ? undefined : toggleLayout,
      togglePreview,
      help: () => setIsHelpOpen(true),
      search: isMailOverlayOpen
        ? undefined
        : () => {
            if (selection.hasSelection) selection.clear();
            if (layout === "list" && openThreadId) closeReader();
            pendingSearchFocusRef.current = true;
            const input = searchInputRef.current;
            if (input) {
              pendingSearchFocusRef.current = false;
              input.focus();
              input.select();
            }
          },
    };
  })();

  useLayoutEffect(() => {
    // 当选择被清除或列表返回时，搜索框会重新挂载，因此
    // 在实际渲染它的那次提交之后消费待处理的 `/` 聚焦。
    if (!pendingSearchFocusRef.current) return;
    const input = searchInputRef.current;
    if (!input) return;
    pendingSearchFocusRef.current = false;
    input.focus();
    input.select();
  });

  useShortcuts(handlers, { isDesktopApp });

  // 阅读器实际有往来的发件人，这样“描述它”可以把
  // 人名转换成地址，而不是猜测域名。
  const getSplitSenders = useStableCallback(() => {
    const seen = new Set<string>();
    for (const thread of threads) {
      const from = thread.messages.at(-1)?.headers.from;
      const address = from ? extractEmailAddress(from) : null;
      if (address && address !== userEmail) seen.add(address);
      if (seen.size >= 50) break;
    }
    return [...seen];
  });

  const onMailboxItemDeleted = useCallback(
    async (item: MailboxItem) => {
      const isActive =
        item.kind === "folder"
          ? scopeFolderId === item.id
          : scopeLabelId === item.id;
      const deletedActiveSplit =
        item.kind === "label" &&
        settings?.splits?.some(
          (split) =>
            split.id === activeSplitId &&
            // 删除该标签会移除仅由它定义的分栏。
            split.filters.length > 0 &&
            split.filters.every(
              (filter) =>
                filter.kind === MailSplitFilterKind.LABEL &&
                filter.value === item.id,
            ),
        );
      if (isActive) {
        await Promise.all([
          setOpenThread(null),
          setScopeType("inbox"),
          item.kind === "folder"
            ? setScopeFolderId(null)
            : setScopeLabelId(null),
        ]);
      }
      if (deletedActiveSplit) setActiveSplitId(null);
      if (item.kind === "label") await mutateSettings();
    },
    [
      mutateSettings,
      activeSplitId,
      scopeFolderId,
      scopeLabelId,
      setActiveSplitId,
      setOpenThread,
      setScopeFolderId,
      setScopeLabelId,
      setScopeType,
      settings?.splits,
    ],
  );

  const onRemoveLabel = useStableCallback(async (labelId: string) => {
    if (!openThreadSelection || !client) return;
    try {
      const { admission } = await submitConversationChange({
        client,
        accountId: openThreadSelection.emailAccountId,
        conversationId: openThreadSelection.threadId,
        change: {
          kind: "set_membership",
          membership: "label",
          id: labelId,
          present: false,
        },
      });
      if (admission.status === "rejected") {
        toast.error(admissionRejectionCopy(admission.code) ?? "无法移除标签");
      }
    } catch {
      toast.error("无法移除标签");
    }
  });

  const refetchReader = useStableCallback(() => {
    Promise.allSettled([refetchOpenThread(), refetchThreadList()]);
  });

  const markOpenThreadRead = useStableCallback(() => {
    if (!openThreadKey) return;
    setReadState([openThreadKey], true);
  });
  const onSendSuccess = useStableCallback(
    (_messageId: string, sentThreadId: string, repliedThreadId: string) => {
      // 挂起的发送会在撤销窗口后落定，那时用户可能
      // 已经离开；仅当用户仍在该会话时才跟随回复。
      if (
        !openThreadSelection ||
        repliedThreadId !== openThreadSelection.threadId ||
        !sentThreadId.trim() ||
        sentThreadId === openThreadSelection.threadId
      )
        return;
      setReplyToMessageId(undefined);
      setOpenThread({
        emailAccountId: openThreadSelection.emailAccountId,
        threadId: sentThreadId,
      });
    },
  );
  const onToggleAssistant = useStableCallback(() =>
    toggleSidebar(["chat-sidebar"]),
  );
  const searchFolders = useMemo(
    () =>
      isOutlook && !isAllAccounts
        ? getMailSearchFolders(folders)
        : NO_SEARCH_OPTIONS,
    [folders, isAllAccounts, isOutlook],
  );
  const showSplitTabs = !isScoped && !searchQuery;
  const threadCount = threads.length;
  const { selectedCount, selectAll, clear: clearSelection } = selection;
  // 仅在选中内容后才提供，否则标签会紧贴在一起。
  const selectAllCheckbox = useMemo(
    () =>
      selectedCount > 0 ? (
        <SelectAllCheckbox
          threadCount={threadCount}
          selectedCount={selectedCount}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
        />
      ) : null,
    [threadCount, selectedCount, selectAll, clearSelection],
  );

  const showList = layout === "split" || !openThreadSelection;
  const showReader = layout === "split" || Boolean(openThreadSelection);
  const readerUserLabels = isAllAccounts
    ? (labelsByAccount[openThreadSelection?.emailAccountId ?? ""] ?? NO_LABELS)
    : userLabels;

  const senderCommandsPanel =
    !isReaderTarget &&
    singleActionTarget &&
    senderAccount &&
    !sidePanelThreadId ? (
      <EmailAccountScopeProvider emailAccount={senderAccount}>
        <ListSenderCommands
          key={singleActionTarget.key}
          message={singleActionTarget.messages.at(-1) ?? null}
        />
      </EmailAccountScopeProvider>
    ) : null;

  const labelPickerDialog =
    labelPicker && pickerAccount ? (
      <EmailAccountScopeProvider emailAccount={pickerAccount}>
        <LabelPickerDialog
          threadIds={labelPicker.targets.map((target) => target.threadId)}
          mode={labelPicker.mode}
          onClose={() => setLabelPicker(null)}
          onApplied={(threadIds, _labelId) => {
            const keys = threadIds.map((threadId) =>
              isAllAccounts ? `${pickerAccount.id}:${threadId}` : threadId,
            );
            // 同时刷新侧边栏的标签计数。
            client?.requestSync([pickerAccount.id]).catch(() => undefined);
            refetchOpenThread();
            refetchThreadList();
            if (labelPicker.mode === "move") {
              if (openThreadKey && keys.includes(openThreadKey)) {
                advanceReaderPast(openThreadKey, keys);
              }
              selection.clear();
            }
            mutateLabels();
          }}
        />
      </EmailAccountScopeProvider>
    ) : null;

  return (
    <MailProductFrame
      accountSwitcher={
        <MailAccountSwitcher
          isDesktopApp={isDesktopApp}
          isAllAccounts={isAllAccounts}
          onSelectAccount={selectAccount}
          onSelectAll={selectAllAccounts}
          variant="compact"
        />
      }
      floating={senderCommandsPanel}
      dialogs={labelPickerDialog}
    >
      <MailShellSidebar
        activeType={
          scopeLabelId || scopeFolderId ? null : (scopeType ?? "inbox")
        }
        activeLabelId={scopeLabelId}
        activeFolderId={scopeFolderId}
        isAllAccounts={isAllAccounts}
        isDesktopApp={isDesktopApp}
        onSelectAccount={selectAccount}
        onSelectAllAccounts={selectAllAccounts}
        onMailboxItemDeleted={onMailboxItemDeleted}
        onNavigate={discardSearchDraft}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MailEngineConnectionBanner />
        <div className="flex min-h-0 min-w-0 flex-1">
          {showList && (
            <MailListPanel layout={layout}>
              <ListToolbar
                layout={layout}
                isDesktopApp={isDesktopApp}
                searchQuery={searchParam ?? ""}
                onSearch={setSearch}
                searchValue={searchValue}
                onSearchChange={onSearchChange}
                searchInputRef={searchInputRef}
                searchLabels={isAllAccounts ? NO_SEARCH_OPTIONS : allLabels}
                searchFolders={searchFolders}
                searchVariant={getMailSearchVariant({
                  isAllAccounts,
                  isOutlook,
                })}
                onToggleLayout={toggleLayout}
                expandedPreview={expandedPreview}
                onTogglePreview={togglePreview}
                onToggleAssistant={onToggleAssistant}
                showLayoutToggle={!isAllAccounts}
                selectAll={showSplitTabs ? null : selectAllCheckbox}
                selectedCount={selection.selectedCount}
                onArchiveSelected={archiveTargets}
                onMoveToInboxSelected={
                  targetsArchived ? moveToInboxTargets : undefined
                }
                onDeleteSelected={trashTargets}
                isUnreadSelected={actionTargets.some((target) =>
                  isThreadUnread(target.messages),
                )}
                onMarkReadSelected={markReadTargets}
                onMarkUnreadSelected={markUnreadTargets}
                isStarredSelected={allStarred}
                onStarSelected={starTargets}
                onLabelSelected={canLabel ? openLabelPicker : undefined}
                onClearSelection={selection.clear}
              />
              {showSplitTabs && (
                <MailSplitTabs
                  leading={selectAllCheckbox}
                  splits={splitTabs}
                  activeSplitId={displayedActiveSplitId}
                  onSelectSplit={setActiveSplitId}
                  isAllAccounts={isAllAccounts}
                  getSenders={getSplitSenders}
                  countAccountIds={splitCountAccountIds}
                  portableLabelSplits={
                    isAllAccounts ? combinedLabelSplits : undefined
                  }
                  labelsByAccount={isAllAccounts ? labelsByAccount : undefined}
                />
              )}
              {isAllAccounts && combinedThreadState.failedAccountIds.length ? (
                <div className="border-border border-b bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:bg-amber-950/30 dark:text-amber-200">
                  部分收件箱无法加载。请稍后重试，或检查它们的连接。
                </div>
              ) : null}
              <MailPanelErrorBoundary
                resetKey={JSON.stringify([
                  emailAccountId,
                  isAllAccounts,
                  query,
                  displayedActiveSplitId,
                  searchQuery,
                ])}
                title="无法显示你的邮件列表"
              >
                {isScheduledView ? (
                  <ScheduledEmailList />
                ) : (
                  <LoadingContent
                    loading={
                      !threads.length &&
                      (isLoading || (!!searchQuery && !searchSettled))
                    }
                    error={searchQuery ? undefined : error}
                  >
                    <ThreadList
                      threads={threads}
                      emptyMessage={emptySearchMessage}
                      layout={layout}
                      expandedPreview={expandedPreview}
                      userEmail={userEmail}
                      userLabels={isAllAccounts ? NO_LABELS : userLabels}
                      labelsByAccount={labelsByAccount}
                      focusedIndex={clampedIndex}
                      isSelected={selection.isSelected}
                      selectedCount={selection.selectedCount}
                      onOpenThread={openAt}
                      onToggleSelect={selection.toggle}
                      onSelectRangeTo={selection.selectRangeTo}
                      showLoadMore={hasMore}
                      isLoadingMore={isLoadingMore}
                      onLoadMore={loadMore}
                      showSentOpenStatus={
                        scopeType === "sent" && !isAllAccounts
                      }
                      listKey={
                        isAllAccounts
                          ? `all-accounts:${searchQuery ?? displayedActiveSplitId}`
                          : JSON.stringify(query)
                      }
                    />
                  </LoadingContent>
                )}
              </MailPanelErrorBoundary>
            </MailListPanel>
          )}

          {showReader ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showList ? null : (
                <MailTitlebarNav
                  showHistory={isDesktopApp}
                  className="px-3 pt-3"
                />
              )}
              <MailReaderPane
                readerEmailAccount={readerEmailAccount}
                readerKey={openReaderThreadKey}
                planSelection={deferredReaderSelection}
                dataReady={
                  !openThreadSelection ||
                  (readerSelectionSettled &&
                    Boolean(openThreadData || openThreadError))
                }
                onReady={setVisibleReaderThreadKey}
                onClose={closeReader}
                showFixWithChat={
                  !isAllAccounts ||
                  openThreadSelection?.emailAccountId === emailAccountId
                }
                lastMessage={openMessages.at(-1) ?? null}
                isStarred={allStarred}
                onToggleStar={starTargets}
                onMarkSpam={markSpamTargets}
                onDelete={trashTargets}
                onLabel={canLabel ? openLabelPicker : undefined}
                onMove={canLabel ? openMovePicker : undefined}
                onTranslate={translateOpenThread}
                onComment={openTeamComments}
                isMenuOpen={isMenuOpen}
                onMenuOpenChange={setIsMenuOpen}
                enableMessageNavigation={!sidePanelThreadId}
                thread={openThread ?? null}
                threadId={openThreadId}
                detailSelectionSettled={readerSelectionSettled}
                loading={
                  Boolean(openThreadSelection) &&
                  (!readerSelectionSettled || isOpenThreadLoading)
                }
                error={readerSelectionSettled ? openThreadError : undefined}
                messages={openMessages}
                localAvailability={
                  readerSelectionSettled
                    ? openThreadLocalAvailability
                    : undefined
                }
                userLabels={readerUserLabels}
                layout={layout}
                labelHref={labelHref}
                onRemoveLabel={onRemoveLabel}
                onArchive={archiveTargets}
                onMoveToInbox={targetsArchived ? moveToInboxTargets : undefined}
                isUnread={isOpenThreadUnread}
                onMarkRead={markOpenThreadRead}
                onMarkUnread={markUnreadTargets}
                refetch={refetchReader}
                onSendSuccess={onSendSuccess}
                autoOpenReplyForMessageId={replyToMessageId}
                autoOpenForwardForMessageId={forwardToMessageId}
              />
            </div>
          ) : null}
        </div>
      </div>
    </MailProductFrame>
  );
}

function getMailSearchVariant({
  isAllAccounts,
  isOutlook,
}: {
  isAllAccounts: boolean;
  isOutlook: boolean;
}): "gmail" | "outlook" | "common" {
  if (isAllAccounts) return "common";
  if (isOutlook) return "outlook";
  return "gmail";
}

function useStableOrderedIds(threads: ListThread[]) {
  const previous = useRef<string[]>([]);
  // 选择回调闭包引用了这些 id；在顺序未变时保留它们，
  // 意味着只编辑一行的快照不会重新渲染每一行。
  return useMemo(() => {
    const ids = threads.map(getListThreadKey);
    const unchanged =
      ids.length === previous.current.length &&
      ids.every((id, index) => id === previous.current[index]);
    if (!unchanged) previous.current = ids;
    return previous.current;
  }, [threads]);
}

const EMPTY_SEARCH_THREADS: ListThread[] = [];
const NO_SEARCH_OPTIONS: { name: string }[] = [];
