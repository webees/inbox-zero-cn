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
  type ReactNode,
} from "react";
import { emailMessageContextSchema } from "@/utils/ai/assistant/chat-context-validation";
import { latestShownMessage } from "@/app/(app)/[emailAccountId]/mail/latest-shown-message";
import { useHiddenDraftMessageIds } from "@/hooks/useHiddenDraftMessageIds";
import { useChat } from "@/providers/ChatProvider";
import { buildChatMailView } from "@/app/(app)/[emailAccountId]/mail/chat-mail-view";
import type { MailScreenAction } from "@/utils/ai/assistant/mail-screen-action";
import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { ChevronLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { ListToolbar } from "@/app/(app)/[emailAccountId]/mail/ListToolbar";
import { getMailSearchFolders } from "@/app/(app)/[emailAccountId]/mail/outlook-folder-list";
import {
  getMailCategories,
  getMailNavPath,
  MAIL_SCHEDULED_TYPE,
  MAILBOX_ITEMS,
} from "@/app/(app)/[emailAccountId]/mail/MailSidebar";
import { MailShellSidebar } from "@/app/(app)/[emailAccountId]/mail/MailShellSidebar";
import { MailSplitTabs } from "@/app/(app)/[emailAccountId]/mail/MailSplitTabs";
import { SelectAllCheckbox } from "@/app/(app)/[emailAccountId]/mail/SelectAllCheckbox";
import { MailListPanel } from "@/app/(app)/[emailAccountId]/mail/MailListPanel";
import { MailReaderPane } from "@/app/(app)/[emailAccountId]/mail/MailReaderPane";
import { MailPreviewOverlay } from "@/app/(app)/[emailAccountId]/mail/MailPreviewOverlay";
import { ScheduledEmailList } from "@/app/(app)/[emailAccountId]/mail/ScheduledEmailList";
import type { MailboxItem } from "@/app/(app)/[emailAccountId]/mail/MailboxItemContextMenu";
import { ListSenderCommands } from "@/app/(app)/[emailAccountId]/mail/ListSenderCommands";
import { extractEmailAddress, isSameEmailAddress } from "@/utils/email";
import { LabelPickerDialog } from "@/app/(app)/[emailAccountId]/mail/LabelPickerDialog";
import { SplitPickerDialog } from "@/app/(app)/[emailAccountId]/mail/SplitPickerDialog";
import {
  canAddSendersToSplit,
  type SenderThread,
} from "@/utils/split-inbox/split-senders";
import { InboxZeroCelebration } from "@/app/(app)/[emailAccountId]/mail/InboxZeroCelebration";
import { ThreadList } from "@/app/(app)/[emailAccountId]/mail/ThreadList";
import { useStableCallback } from "@/app/(app)/[emailAccountId]/mail/use-stable-callback";
import { useTranslateThread } from "@/app/(app)/[emailAccountId]/mail/use-thread-translation";
import { GmailLabel } from "@/utils/gmail/label";
import { Tooltip } from "@/components/Tooltip";
import {
  flattenOutlookFolders,
  type OutlookFolder,
} from "@/utils/outlook/folders";
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
import {
  type ThreadActionTarget,
  useThreadActions,
} from "@/app/(app)/[emailAccountId]/mail/use-thread-actions";
import { useOptimisticArchive } from "@/app/(app)/[emailAccountId]/mail/use-optimistic-archive";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import { MailProductFrame } from "@inboxzero/mail-ui/MailProductFrame";
import { MailEngineConnectionBanner } from "@/utils/mail-engine/MailEngineConnectionBanner";
import { useThreadSelection } from "@/app/(app)/[emailAccountId]/mail/use-thread-selection";
import {
  bundleInboxThreads,
  isBundleEligibleSplit,
} from "@/app/(app)/[emailAccountId]/mail/inbox-bundles";
import { isOtpThread } from "@/app/(app)/[emailAccountId]/mail/otp-code";
import {
  copySelectedThreadText,
  findSelectAllReader,
  selectThreadText,
} from "@/app/(app)/[emailAccountId]/mail/thread-select-all";
import { useWarmNeighbourThreads } from "@/app/(app)/[emailAccountId]/mail/use-warm-neighbour-threads";
import { useMailPerformanceTelemetry } from "@/app/(app)/[emailAccountId]/mail/use-mail-performance-telemetry";
import {
  isThreadArchived,
  isThreadUnread,
} from "@/app/(app)/[emailAccountId]/mail/read-state";
import {
  MailLayout,
  MailSetupState,
  MailSplitFilterKind,
} from "@/generated/prisma/enums";
import { MailSetupPanel } from "@/app/(app)/[emailAccountId]/mail/MailSetupPanel";
import { isDefaultAllMailSplit } from "@/utils/split-inbox/initial-splits";
import { useSidebar } from "@/components/ui/sidebar";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { mailPreviewAtom, mailScreenMountedAtom } from "@/store/mail-preview";
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
import { cn } from "@/utils";
import { useShortcuts } from "@/lib/shortcuts/useShortcuts";
import type { ShortcutHandlers } from "@/lib/shortcuts/registry";
import { updateMailPreferencesAction } from "@/utils/actions/mail-split";
import type { UpdateMailPreferencesBody } from "@/utils/actions/mail-split.validation";
import { submitConversationChange } from "@/utils/mail-engine/submit-conversations";
import { admissionRejectionCopy } from "@/utils/mail-engine/admission-notice";
import {
  getPortableLabelSplits,
  type MailSplit,
  OTHER_SPLIT_ID,
  splitToThreadsQuery,
  mailTypeToThreadsQuery,
  threadListQueryRequiresInbox,
} from "@/utils/split-inbox/split-query";
import { getActionErrorMessage } from "@/utils/error";
import { prefixPath } from "@/utils/path";
import { getMailAccountUrl } from "@/app/(app)/[emailAccountId]/mail/mail-account-url";
import { redirectToSafeUrl } from "@/utils/redirect";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";
import { LoadingMiniSpinner } from "@/components/Loading";
import { LoadingContent } from "@/components/LoadingContent";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { Button } from "@/components/ui/button";
import { useTeamCommentsAvailable } from "@/components/team-comments/use-team-comments-available";
import { getEmailMessageCellActions } from "@/components/EmailMessageCellActions";
import type { ThreadsQuery } from "@/utils/threads/validation";
import { getConversationSubject } from "@/utils/email/subject";
import { printMessages } from "@/app/(app)/[emailAccountId]/mail/print-messages";

// 放在模块级，使“空”阅读器不会在每次渲染时给子组件传入新数组。
const NO_MESSAGES: ThreadMessage[] = [];
const ASSISTANT_SELECTION_WAIT_MS = 15_000;
const NO_LABELS = {};

/**
 * 管理邮件界面的 URL、会话列表、选择与分拣状态，
 * 并由记忆化部分组合出侧边栏、列表和阅读器。J/K 与引擎快照
 * 会重新渲染此组件，因此向下传递的内容都保持引用稳定，
 * 只有输入发生变化的部分才会重新渲染。
 */
export function MailShell() {
  const { i18n, t } = useLingui();
  const { emailAccount, emailAccountId, userEmail, provider } = useAccount();
  const { data: accountsData } = useAccounts();
  const isGoogle = isGoogleProvider(provider);
  const isOutlook = isMicrosoftProvider(provider);
  const { userLabels } = useEmailLabels();
  const { userLabels: allLabels } = useLabels();
  const { folders } = useFolders(provider);
  const { data: settings, mutate: mutateSettings } = useMailSettings();
  const { toggleSidebar, state: sidebarState } = useSidebar();
  const isPaletteOpen = useAtomValue(commandPaletteOpenAtom);
  const isHelpOpen = useAtomValue(shortcutsDialogOpenAtom);
  const setIsHelpOpen = useSetAtom(shortcutsDialogOpenAtom);
  const senderCommandContext = useAtomValue(senderCommandContextAtom);
  const setMailCommandContext = useSetAtom(mailCommandContextAtom);
  // 侧边面板查看器打开时接管分拣快捷键，因此此界面让位，
  // 避免两者同时归档同一次按键。
  const { threadId: sidePanelThreadId } = useDisplayedEmail();
  const [preview, setPreview] = useAtom(mailPreviewAtom);
  // 在另一个账号下打开的预览无法在当前账号中加载。
  const previewThreadId =
    preview?.emailAccountId === emailAccountId ? preview.threadId : null;
  const setMailScreenMounted = useSetAtom(mailScreenMountedAtom);
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
  const [setupParam, setSetupParam] = useQueryState("setup");

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMailNavOpen, setIsMailNavOpen] = useState(false);
  const [isListScrolled, setIsListScrolled] = useState(false);
  const [labelPicker, setLabelPicker] = useState<{
    mode: "label" | "move";
    threadKeys: string[];
    targets: ThreadSelection[];
  } | null>(null);
  const [splitPickerThreads, setSplitPickerThreads] = useState<
    SenderThread[] | null
  >(null);
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
  const layout: MailLayoutMode =
    settings?.layout === MailLayout.SPLIT ? "split" : "list";
  const expandedPreview = settings?.expandedPreview ?? false;
  const bundleInbox = settings?.bundleInbox ?? false;

  // 通过 SWR 缓存写入，而不是镜像到本地状态，因此该偏好只有一个数据源，
  // 所有阅读器都能看到新值。
  const updatePreferences = useCallback(
    (preferences: UpdateMailPreferencesBody) => {
      if (!settings) return;
      const loadedSettings = settings;

      return mutateSettings(
        async (current) => {
          const result = await updateMailPreferencesAction(
            emailAccountId,
            preferences,
          );
          // 主动抛出以便 SWR 回滚乐观值，避免界面显示服务器从未接受的偏好。
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
        toast.error(error instanceof Error ? error.message : t`无法保存该项`);
      });
    },
    [emailAccountId, mutateSettings, settings, t],
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

  const toggleBundleInbox = useCallback(async () => {
    const enabling = !bundleInbox;
    await updatePreferences({ bundleInbox: enabling });
    // 启用聚合时，服务器会选取默认分组。
    if (enabling) mutateSettings();
  }, [bundleInbox, mutateSettings, updatePreferences]);

  // 侧边栏的选择会限定整个列表的范围，从而替换分组标签页——
  // 分组是切分收件箱的方式，而不是切分任意视图的方式。
  // 只解析一次，确保标签栏与获取到的行不会不一致。
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
    // 打开设置会清除已输入的搜索，否则它会隐藏所预览的标签页。
    setupParam,
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
  // 定时发送保存在我们自己的数据库中，因此此视图没有可获取的会话列表。
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
  // 选择已打开的视图不会改变 URL，因此未提交的搜索会继续过滤列表。
  const discardSearchDraft = useCallback(() => setSearchDraft(undefined), []);

  const combinedLabelSplits = useMemo(
    () => getPortableLabelSplits(settings?.splits ?? [], userLabels),
    [settings?.splits, userLabels],
  );

  const splits = useMemo(() => {
    // 存储的名称保持用户保存时的样子；只翻译应用自身添加的标签页。
    const getDisplayName = (split: MailSplit) => {
      if (isDefaultAllMailSplit(split)) return t`全部`;
      const { name } = split;
      if (isGoogle && name.trim().toLowerCase() === "other")
        return t`${name}（自定义）`;
      return name;
    };
    return [
      ...(settings?.splits ?? []).map((split) => ({
        ...split,
        name: getDisplayName(split),
        // 排除项仅对 Gmail 提供，与“其他”的限制相同。
        hideFromAll: isGoogle && !isAllAccounts && split.hideFromAll,
      })),
      ...(isGoogle && !isAllAccounts
        ? [
            {
              id: OTHER_SPLIT_ID,
              name: t`其他`,
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
    );
  }, [settings?.splits, isAllAccounts, combinedLabelSplits, isGoogle, t]);
  const splitTabs = useMemo(
    () =>
      splits.map((split) => ({
        ...split,
        deletable: split.filters.length > 0,
        reorderable: split.id !== "all" && split.id !== OTHER_SPLIT_ID,
        bundleEligible:
          split.id !== OTHER_SPLIT_ID && isBundleEligibleSplit(split),
      })),
    [splits],
  );
  const activeSplit =
    splits.find((split) => split.id === activeSplitId) ??
    splits.find((split) => split.id === settings?.defaultSplitId) ??
    splits[0];
  const displayedActiveSplitId = activeSplit?.id ?? null;
  const activeCombinedLabelNames = combinedLabelSplits.find(
    (split) => split.id === displayedActiveSplitId,
  )?.labelNames;
  const query: ThreadsQuery = useMemo(() => {
    // 搜索会覆盖分组与范围并覆盖整个邮箱，与 Gmail 和 Outlook 自带搜索框的默认行为一致。
    if (searchQuery) return { q: searchQuery };
    if (scopeQuery) return scopeQuery;

    return activeSplit
      ? splitToThreadsQuery(activeSplit, splits)
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
  const { isSyncing } = isAllAccounts
    ? combinedThreadState
    : accountThreadState;
  const { threads: listedThreads, archive: optimisticArchive } =
    useOptimisticArchive(
      searchSettled ? remoteThreads : EMPTY_SEARCH_THREADS,
      isAllAccounts ? !searchQuery : threadListQueryRequiresInbox(query),
      JSON.stringify([emailAccountId, isAllAccounts]),
    );
  const isInboxView =
    !isAllAccounts &&
    !searchQuery &&
    !scopeQuery &&
    !!activeSplit &&
    !activeSplit.filters.length &&
    activeSplit.id !== OTHER_SPLIT_ID;
  const [expandedBundleIds, setExpandedBundleIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const toggleBundle = useCallback((bundleId: string) => {
    setExpandedBundleIds((current) => {
      const next = new Set(current);
      if (!next.delete(bundleId)) next.add(bundleId);
      return next;
    });
  }, []);
  const { rows: threads, rowBundles } = useMemo(
    () =>
      bundleInbox && isInboxView
        ? bundleInboxThreads({
            threads: listedThreads,
            splits: settings?.splits ?? [],
            expandedBundleIds,
            // 现在需要登录验证码，因此绝不能让它等待在聚合项中。
            keepVisible: (thread) => isOtpThread(thread, userLabels),
          })
        : { rows: listedThreads, rowBundles: undefined },
    [
      bundleInbox,
      isInboxView,
      listedThreads,
      settings?.splits,
      expandedBundleIds,
      userLabels,
    ],
  );
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
  let emptyListMessage: ReactNode;
  if (isSyncing) {
    emptyListMessage = (
      <span className="inline-flex items-center gap-2">
        <LoadingMiniSpinner />
        <Trans>正在同步你的邮件…</Trans>
      </span>
    );
  } else if (searchQuery) {
    emptyListMessage = t`未找到邮件`;
  } else if (!scopeQuery) {
    emptyListMessage = (
      <InboxZeroCelebration
        splitName={activeSplit?.id === "all" ? undefined : activeSplit?.name}
      />
    );
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
    ? listedThreads.find((thread) => getListThreadKey(thread) === openThreadKey)
    : undefined;
  const readAttemptedForOpenThread = useRef<string | null>(null);
  const warmThread = useWarmNeighbourThreads({
    threads,
    activeThreadKey:
      openThreadKey ?? (focusedThread ? getListThreadKey(focusedThread) : null),
    emailAccountId,
  });

  // 将两者作为一个值延迟更新：渲染新 id 却配旧账号，比在 J/K 跨账号行移动时
  // 立即获取更糟。
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
  // 延迟的 id 追上之前暂不展示，因此快速按 J/K 不会把新会话的标题与上一会话的正文配对。
  const openMessages = readerSelectionSettled
    ? (openThreadData?.thread.messages ?? NO_MESSAGES)
    : NO_MESSAGES;
  const { setAmbientContext, setMailView, setMailScreenActionHandler } =
    useChat();
  const hiddenDraftMessageIds = useHiddenDraftMessageIds(emailAccountId);
  const currentChatMessage =
    openThreadSelection?.emailAccountId === emailAccountId && !openThreadError
      ? latestShownMessage(openMessages, hiddenDraftMessageIds)
      : undefined;
  useEffect(() => {
    const parsedContext = currentChatMessage
      ? emailMessageContextSchema.safeParse({
          type: "email",
          message: currentChatMessage,
        })
      : null;
    setAmbientContext(parsedContext?.success ? parsedContext.data : null);
    return () => setAmbientContext(null);
  }, [currentChatMessage, setAmbientContext]);
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
  const readerEmail = readerEmailAccount?.email;
  const lastReceivedMessage = useMemo(() => {
    if (!readerEmail) return null;
    return (
      openMessages.findLast(
        (message) =>
          !message.labelIds?.includes(GmailLabel.DRAFT) &&
          !isSameEmailAddress(message.headers.from, readerEmail),
      ) ?? null
    );
  }, [openMessages, readerEmail]);
  const printOpenThread = useMemo(() => {
    const messages = openMessages.filter(
      (message) => !message.labelIds?.includes(GmailLabel.DRAFT),
    );
    if (!messages.length) return;
    return () =>
      printMessages({
        subject: getConversationSubject(messages) ?? "",
        messages,
        i18n,
      });
  }, [i18n, openMessages]);
  const teamCommentsAvailable = useTeamCommentsAvailable(readerEmailAccountId);
  const openTeamComments = useMemo(
    () =>
      // 监听器随会话的邮件一起挂载，因此更早的请求会被丢弃。
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
      labelIds: [
        ...new Set(openMessages.flatMap((message) => message.labelIds ?? [])),
      ],
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
    const listTargets = listedThreads.map((thread) => ({
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

    const targets = resolveThreadActionTargets({
      focusedKey: focusedThread ? getListThreadKey(focusedThread) : undefined,
      listTargets,
      openTarget,
      selectedKeys: [...selection.selectedIds],
    });
    if (!rowBundles) return targets;
    // 折叠的聚合行会对其代表的每个会话执行操作。
    const targetsByKey = new Map(
      listTargets.map((target) => [target.key, target]),
    );
    return [
      ...new Map(
        targets
          .flatMap((target) => {
            const bundleRow = rowBundles.get(target.key);
            // 打开的邮件仅在作为隐式目标时单独操作；
            // 选中的聚合行始终表示整个聚合项。
            if (
              bundleRow?.kind !== "collapsed" ||
              (target.key === openThreadKey && !selection.hasSelection)
            )
              return [target];
            return bundleRow.bundle.threads.flatMap((thread) => {
              const memberTarget = targetsByKey.get(getListThreadKey(thread));
              return memberTarget ? [memberTarget] : [];
            });
          })
          .map((target) => [target.key, target]),
      ).values(),
    ];
  }, [
    listedThreads,
    rowBundles,
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
  ]);
  // 撤销会把会话带回列表，因此将焦点返回给它，若有阅读器正在显示也返回给阅读器，
  // 而不是留在归档推进后的位置。
  const [restoredFocusKey, setRestoredFocusKey] = useState<string>();
  // 归档最后一行会关闭阅读器，因此必须在操作前记住打开状态，而不是在撤销时读取。
  const removedOpenThreadKeyRef = useRef<string | null>(null);
  const focusRestoredThread = useStableCallback(
    (targets: ThreadActionTarget[]) => {
      const wasOpen = targets.find(
        (target) => target.key === removedOpenThreadKeyRef.current,
      );
      const target = wasOpen ?? targets[0];
      if (!target) return;
      const selection = {
        emailAccountId: target.emailAccountId,
        threadId: target.threadId,
      };
      setRestoredFocusKey(
        isAllAccounts
          ? (getThreadSelectionKey(selection) ?? undefined)
          : selection.threadId,
      );
      if (wasOpen || layout === "split" || openThreadId) {
        setReplyToMessageId(undefined);
        setForwardToMessageId(undefined);
        setOpenThread(selection);
      }
    },
  );
  useLayoutEffect(() => {
    if (!restoredFocusKey) return;
    const index = orderedIds.indexOf(restoredFocusKey);
    if (index < 0) return;
    setFocusedIndex(index);
    setRestoredFocusKey(undefined);
  }, [orderedIds, restoredFocusKey]);
  const {
    applyLabel,
    archive,
    moveToFolder,
    moveToInbox,
    trash,
    markSpam,
    setReadState,
    setStarredState,
    snooze,
    undo,
    waitForPendingUndoable,
  } = useThreadActions({
    emailAccountId,
    onRestore: focusRestoredThread,
    readerTarget,
    // 折叠的聚合项只在行中隐藏其会话，不会从操作中隐藏。
    threads: listedThreads,
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

  // 让获取到的快照决定初始已读状态。一旦尝试过标记已读，
  // 乐观修补后的行就是保持同步的副本，而获取到的快照可能仍是旧的。
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
  const getFocusedIndex = useStableCallback(() => focusedIndex);
  /** 阅读器停留的位置：打开的邮件行、关闭时所在的聚合行，或为空。 */
  const advanceReaderPast = useStableCallback(
    (
      currentThreadKey: string,
      removedThreadKeys: string[],
    ): { openedKey: string } | { bundleIndex: number } | null => {
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
      // 聚合行并不代表单封邮件，因此阅读器会停留在它上面并关闭。
      const opensRow =
        nextRow &&
        rowBundles?.get(getListThreadKey(nextRow))?.kind !== "collapsed";
      setOpenThread(
        opensRow ? getListThreadSelection(nextRow, emailAccountId) : null,
      );
      if (opensRow) return { openedKey: getListThreadKey(nextRow) };
      return nextRow && nextThread ? { bundleIndex: nextThread.index } : null;
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
      const removedOpenThreadKey =
        removeFromList && openThreadKey && ids.includes(openThreadKey)
          ? openThreadKey
          : null;
      if (removedOpenThreadKey) {
        removedOpenThreadKeyRef.current = removedOpenThreadKey;
      }
      // 在列表移除该行之前推进，让焦点直接移到下一行，
      // 而不是短暂落在空处。
      const advancedTo =
        removedOpenThreadKey && autoAdvanceReader
          ? advanceReaderPast(removedOpenThreadKey, ids)
          : null;
      const queuedThreadKeys = await action(ids);
      const queuedOpenThread =
        removedOpenThreadKey !== null &&
        queuedThreadKeys.includes(removedOpenThreadKey);
      // 如果未进入队列，则回退，除非用户此后已移开。
      // 停留在聚合行上关闭的阅读器说明焦点也留在了原处；
      // 因其他原因关闭的阅读器则无法区分停留与离开。
      const stayedWhereAdvanced =
        advancedTo !== null &&
        ("openedKey" in advancedTo
          ? getOpenThreadKey() === advancedTo.openedKey
          : getOpenThreadKey() === null &&
            getFocusedIndex() === advancedTo.bundleIndex);
      if (removedOpenThreadKey && !queuedOpenThread && stayedWhereAdvanced) {
        setFocusedIndex(focusedIndex);
        setOpenThread(openThreadSelection);
      }
      if (!queuedThreadKeys.length && !hadSelection) return;
      if (
        queuedOpenThread &&
        !autoAdvanceReader &&
        getOpenThreadKey() === removedOpenThreadKey
      ) {
        setOpenThread(null);
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
    const bundleRow = rowBundles?.get(getListThreadKey(thread));
    if (bundleRow?.kind === "collapsed") {
      // 选择的是整个聚合项；展开后它只代表其中一个成员。
      selection.clear();
      setOpenThread(null);
      setFocusedIndex(index);
      toggleBundle(bundleRow.bundle.id);
      return;
    }
    setFocusedIndex(index);
    setReplyToMessageId(undefined);
    setForwardToMessageId(undefined);
    selection.clear();
    setOpenThread(getListThreadSelection(thread, emailAccountId));
  });

  const collapseBundle = useStableCallback((bundleId: string) => {
    const members = [...(rowBundles?.values() ?? [])].find(
      (row) => row.bundle.id === bundleId,
    )?.bundle.threads;
    const leadIndex = members?.[0]
      ? orderedIds.indexOf(getListThreadKey(members[0]))
      : -1;
    // 这些成员即将被隐藏，因此阅读器不能停留在一个成员上。
    if (
      openThreadKey &&
      members?.some((thread) => getListThreadKey(thread) === openThreadKey)
    )
      setOpenThread(null);
    selection.clear();
    if (leadIndex >= 0) setFocusedIndex(leadIndex);
    toggleBundle(bundleId);
  });

  const move = useCallback(
    (delta: number) => {
      const next = clampIndex(clampedIndex + delta);
      setFocusedIndex(next);
      // 阅读器打开后，导航会让其内容和位置保持同步。
      // 列表视图关闭时，J/K 仍可单独移动行光标——
      // 此时光标仍表示意图，因此预先准备该行以便按下 Enter。
      const nextThread = threads[next];
      if ((layout === "split" || openThreadId) && nextThread) {
        setReplyToMessageId(undefined);
        setForwardToMessageId(undefined);
        // 聚合行不是单封邮件，因此阅读器不会为其显示内容。
        const isBundleRow =
          rowBundles?.get(getListThreadKey(nextThread))?.kind === "collapsed";
        setOpenThread(
          isBundleRow
            ? null
            : getListThreadSelection(nextThread, emailAccountId),
        );
      }
    },
    [
      rowBundles,
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

    // 记住持久化尝试，使此阅读器在发件箱等待连接或服务商恢复时不会重复排队。
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
    () => runOn((ids) => optimisticArchive(ids, archive), true, true),
    [archive, optimisticArchive, runOn],
  );
  // 再次归档不会产生效果，因此归档过的目标会提供返回方式。
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
  // Outlook 类别使用与 Gmail 标签相同的引擎成员关系命令。
  const canLabel =
    currentLabelTargets.length > 0 &&
    (isGoogleProvider(labelAccount?.account.provider) ||
      isMicrosoftProvider(labelAccount?.account.provider)) &&
    currentLabelTargets.every(
      (target) => target.emailAccountId === labelAccountId,
    );
  const openLabelPicker = useStableCallback(() => {
    if (canLabel)
      setLabelPicker({
        mode: "label",
        threadKeys: actionTargets.map((target) => target.key),
        targets: currentLabelTargets,
      });
  });
  const openMovePicker = useStableCallback(() => {
    if (canLabel)
      setLabelPicker({
        mode: "move",
        threadKeys: actionTargets.map((target) => target.key),
        targets: currentLabelTargets,
      });
  });
  const senderSplits = useMemo(
    () => (settings?.splits ?? []).filter((split) => split.filters.length > 0),
    [settings?.splits],
  );
  const canAddToSplit =
    !isAllAccounts &&
    actionTargets.length > 0 &&
    senderSplits.some(canAddSendersToSplit);
  const openSplitPicker = useStableCallback(() => {
    if (canAddToSplit)
      setSplitPickerThreads(actionTargets.map((target) => target.messages));
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
        addToSplit: canAddToSplit ? openSplitPicker : undefined,
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
      canAddToSplit,
      openSplitPicker,
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
    sidebarState.includes("chat-sidebar") ||
    isHelpOpen ||
    isPaletteOpen ||
    Boolean(labelPicker) ||
    Boolean(splitPickerThreads) ||
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

  // 打开期间列表被占用时，字段可能已渲染但没有交互，
  // 因此请求会保持等待，直到焦点真正落到其上。
  const focusPendingSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    if (document.activeElement !== input) return;
    pendingSearchFocusRef.current = false;
    input.select();
  }, []);

  const closeReader = useCallback(() => {
    setOpenThread(null);
  }, [setOpenThread]);

  const goToInbox = useCallback(() => {
    selection.clear();
    setOpenThread(null);
    setScopeType("inbox");
    setScopeLabelId(null);
    setScopeFolderId(null);
  }, [
    selection.clear,
    setOpenThread,
    setScopeFolderId,
    setScopeLabelId,
    setScopeType,
  ]);

  const senderCommands =
    senderCommandContext?.emailAccountId ===
      singleActionTarget?.selection.emailAccountId &&
    senderCommandContext?.threadId === singleActionTarget?.selection.threadId
      ? senderCommandContext
      : null;
  const onToggleAssistant = useStableCallback(() =>
    toggleSidebar(["chat-sidebar"]),
  );
  // `useShortcuts` 将处理函数保存在 ref 中，因此这些无需记忆化。
  // 从列表打开时，阅读器会在屏幕外准备邮件并让列表保持显示，
  // 因此完成的邮件会在一帧内替换它。
  // 会话显示后，阅读器会自行缓冲会话间的移动。
  const readerPreparing =
    layout === "list" &&
    Boolean(openReaderThreadKey && readerEmailAccount) &&
    visibleReaderThreadKey === undefined;
  if (layout === "list" && !openReaderThreadKey && visibleReaderThreadKey) {
    setVisibleReaderThreadKey(undefined);
  }
  const showList =
    layout === "split" || !openThreadSelection || readerPreparing;
  const showSplitTabs = !isScoped && !searchQuery;
  const canShowSetup = showSplitTabs && !isAllAccounts && !!settings;
  const isSetupOpen =
    canShowSetup &&
    (setupParam !== null || settings.setup === MailSetupState.PENDING);
  const closeSetup = () => {
    setSetupParam(null);
    if (settings?.setup !== MailSetupState.DONE)
      updatePreferences({ setup: MailSetupState.DONE });
  };
  const canCycleSplits = showSplitTabs && showList;
  const cycleSplit = (step: 1 | -1) => {
    const index = splits.findIndex(
      (split) => split.id === displayedActiveSplitId,
    );
    const target = splits[(index + step + splits.length) % splits.length];
    if (target) setActiveSplitId(target.id);
  };
  const handlers: ShortcutHandlers = (() => {
    if (
      sidePanelThreadId ||
      previewThreadId ||
      labelPicker ||
      splitPickerThreads
    )
      return {};
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
            else if (isScoped) goToInbox();
          },
      // 隐藏的标签页会在视线之外改变分组。
      nextSplit: canCycleSplits ? () => cycleSplit(1) : undefined,
      previousSplit: canCycleSplits ? () => cycleSplit(-1) : undefined,
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
      selectAll: (event) => {
        const reader = openThreadId
          ? findSelectAllReader(event, { readerFillsView: layout === "list" })
          : null;
        if (reader) selectThreadText(reader);
        else selection.selectAll();
      },
      // 光标随扩展移动；否则每次重复都会从同一行重新扩展，范围永远不会增大。
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
        await waitForPendingUndoable();
        if (await undoLatestToast()) return;
        await undo();
      },
      toggleLayout,
      togglePreview,
      toggleAssistant: onToggleAssistant,
      help: () => setIsHelpOpen(true),
      search: isMailOverlayOpen
        ? undefined
        : () => {
            if (selection.hasSelection) selection.clear();
            if (layout === "list" && openThreadId) closeReader();
            pendingSearchFocusRef.current = true;
            focusPendingSearch();
          },
    };
  })();

  useLayoutEffect(() => {
    // 选择清除或列表返回时，搜索字段会重新挂载，
    // 因此在真正渲染它的那次提交之后消费待处理的 `/` 焦点。
    if (pendingSearchFocusRef.current) focusPendingSearch();
  });

  useShortcuts(handlers, { isDesktopApp });

  useEffect(() => {
    document.addEventListener("copy", copySelectedThreadText);
    return () => document.removeEventListener("copy", copySelectedThreadText);
  }, []);

  // 阅读器实际对应的发件人，使“Describe it”能将人名转换为地址，而不是猜测域名。
  const getSplitSenders = useStableCallback(() => {
    const seen = new Set<string>();
    for (const thread of listedThreads) {
      const from = thread.messages.at(-1)?.headers.from;
      const address = from ? extractEmailAddress(from) : null;
      if (address && address !== userEmail) seen.add(address);
      if (seen.size >= 50) break;
    }
    return [...seen];
  });

  const onMailboxItemDeleted = useCallback(
    async (item: MailboxItem, deleted: Promise<boolean>) => {
      const isActive =
        item.kind === "folder"
          ? scopeFolderId === item.id
          : scopeLabelId === item.id;
      const deletedActiveSplit =
        item.kind === "label" &&
        settings?.splits?.some(
          (split) =>
            split.id === activeSplitId &&
            // 删除标签会移除仅由它定义的分组。
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
      // 删除操作会在服务商删除标签后将其从已保存的分组中移除，
      // 因此分组仅在那之后重新加载。
      if (item.kind === "label" && (await deleted)) await mutateSettings();
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
        toast.error(admissionRejectionCopy(admission.code) ?? t`无法移除标签`);
      }
    } catch {
      toast.error(t`无法移除标签`);
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
      // 暂缓的发送会在撤销窗口后确定，那时用户可能已离开；
      // 仅当用户仍在该会话上时才跟随回复。
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
  const searchFolders = useMemo(
    () =>
      isOutlook && !isAllAccounts
        ? getMailSearchFolders(folders)
        : NO_SEARCH_OPTIONS,
    [folders, isAllAccounts, isOutlook],
  );
  // 侧边栏折叠为边栏条时，这是列表不是收件箱的唯一标志。
  const scopeTitle =
    isScoped && !searchQuery
      ? getScopeTitle({
          scopeType,
          scopeLabelId,
          scopeFolderId,
          labels: allLabels,
          folders,
          isGoogle,
          isOutlook,
          i18n,
        })
      : null;
  const chatMailView = useMemo(
    () =>
      buildChatMailView({
        emailAccountId,
        isAllAccounts,
        searchQuery,
        scope: isScoped
          ? {
              labelId: scopeLabelId,
              folderId: scopeFolderId,
              type: scopeType,
              title: scopeTitle,
            }
          : null,
        activeSplit,
        userLabels,
        selectedTargets: selection.hasSelection ? actionTargets : [],
        hiddenDraftMessageIds,
      }),
    [
      emailAccountId,
      isAllAccounts,
      searchQuery,
      isScoped,
      scopeLabelId,
      scopeFolderId,
      scopeType,
      scopeTitle,
      activeSplit,
      userLabels,
      selection.hasSelection,
      actionTargets,
      hiddenDraftMessageIds,
    ],
  );
  useEffect(() => {
    setMailView(chatMailView);
    return () => setMailView(null);
  }, [chatMailView, setMailView]);

  // 助手要求选择的会话，会保持到它们出现在列表中（例如刚执行的搜索之后）、
  // 等待超时，或用户自行更改选择为止。
  const [assistantSelection, setAssistantSelection] = useState<string[] | null>(
    null,
  );
  const appliedAssistantKeys = useRef<ReadonlySet<string>>(new Set());
  const applyMailScreenAction = useStableCallback(
    (action: MailScreenAction) => {
      // 搜索或选择会落在列表中，否则打开的邮件或预览会一直遮住它。
      const revealList = () => {
        setPreview(null);
        if (layout === "list") setOpenThread(null);
      };
      switch (action.action) {
        case "open_thread":
          setOpenThread({ emailAccountId, threadId: action.threadId });
          return;
        case "search":
          revealList();
          setSearch(action.query);
          return;
        case "select_threads":
          revealList();
          // 直接替换选择，因此若请求的行没有出现，旧选择也不会看起来像助手的挑选。
          appliedAssistantKeys.current = new Set();
          selection.clear();
          setAssistantSelection(action.threadIds);
          return;
        case "show_split":
          // 聊天可能在用户切换账号后才完成。
          if (action.emailAccountId !== emailAccountId) return;
          // 分组标签页只在此账号未限定范围、未搜索的收件箱中显示。
          revealList();
          setAssistantSelection(null);
          appliedAssistantKeys.current = new Set();
          selection.clear();
          setSearch("");
          setScopeType(null);
          setScopeLabelId(null);
          setScopeFolderId(null);
          setAccountScope(null);
          setActiveSplitId(action.splitId);
          return;
      }
    },
  );
  useEffect(() => {
    setMailScreenMounted(true);
    return () => {
      setMailScreenMounted(false);
      setPreview(null);
    };
  }, [setMailScreenMounted, setPreview]);
  const closePreview = useCallback(() => setPreview(null), [setPreview]);
  const navigatePreview = useCallback(
    (threadId: string) => setPreview({ emailAccountId, threadId }),
    [emailAccountId, setPreview],
  );
  const openPreviewInReader = useCallback(() => {
    if (!previewThreadId) return;
    setOpenThread({ emailAccountId, threadId: previewThreadId });
    setPreview(null);
  }, [emailAccountId, previewThreadId, setOpenThread, setPreview]);
  useEffect(() => {
    setMailScreenActionHandler(applyMailScreenAction);
    return () => setMailScreenActionHandler(null);
  }, [applyMailScreenAction, setMailScreenActionHandler]);
  useEffect(() => {
    if (!assistantSelection) return;
    const timeout = setTimeout(
      () => setAssistantSelection(null),
      ASSISTANT_SELECTION_WAIT_MS,
    );
    return () => clearTimeout(timeout);
  }, [assistantSelection]);
  const { replace: replaceSelection, selectedIds } = selection;
  useEffect(() => {
    if (!assistantSelection) return;
    const applied = appliedAssistantKeys.current;
    const visibleKeys = new Set(orderedIds);
    // 离开列表的行（例如进入折叠的聚合项）会自动退出选择，
    // 因此只有可见部分反映用户的编辑。
    if (
      !hasSameKeys(
        onlyKeys(applied, visibleKeys),
        onlyKeys(selectedIds, visibleKeys),
      )
    ) {
      setAssistantSelection(null);
      return;
    }
    const wanted = new Set(assistantSelection);
    const keys = listedThreads
      .filter(
        (thread) =>
          wanted.has(thread.id) &&
          getListThreadSelection(thread, emailAccountId).emailAccountId ===
            emailAccountId,
      )
      .map(getListThreadKey)
      .filter((key) => visibleKeys.has(key));
    const keySet = new Set(keys);
    if (keys.length && !hasSameKeys(keySet, applied)) {
      appliedAssistantKeys.current = keySet;
      replaceSelection(keys);
    }
    if (keys.length === wanted.size) setAssistantSelection(null);
  }, [
    assistantSelection,
    emailAccountId,
    listedThreads,
    orderedIds,
    replaceSelection,
    selectedIds,
  ]);
  const threadCount = threads.length;
  const { selectedCount, selectAll, clear: clearSelection } = selection;
  // 仅在选中内容后提供，否则标签页会紧贴显示。
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
          threadKeys={labelPicker.threadKeys}
          mode={labelPicker.mode}
          onClose={() => setLabelPicker(null)}
          onApply={async (threadKeys, target) => {
            const isMove = labelPicker.mode === "move";
            const applied =
              target.kind === "folder"
                ? await moveToFolder(threadKeys, target.id)
                : await applyLabel(threadKeys, target.id, { archive: isMove });
            if (isMove && applied.length) {
              // 仅当阅读器正在显示且此次移动确实移除了该会话时，撤销才会重新打开阅读器。
              removedOpenThreadKeyRef.current =
                openThreadKey && applied.includes(openThreadKey)
                  ? openThreadKey
                  : null;
              if (openThreadKey && applied.includes(openThreadKey)) {
                advanceReaderPast(openThreadKey, applied);
              }
              selection.clear();
            }
            return applied;
          }}
        />
      </EmailAccountScopeProvider>
    ) : null;

  const splitPickerDialog = splitPickerThreads ? (
    <SplitPickerDialog
      splits={senderSplits}
      threads={splitPickerThreads}
      onClose={() => setSplitPickerThreads(null)}
      onApplied={() => {
        setSplitPickerThreads(null);
        selection.clear();
        mutateSettings();
        refetchThreadList();
      }}
    />
  ) : null;

  return (
    <MailProductFrame
      floating={senderCommandsPanel}
      dialogs={
        <>
          {labelPickerDialog}
          {splitPickerDialog}
          {isSetupOpen && (
            <MailSetupPanel
              splits={splits}
              layout={layout}
              bundleInbox={bundleInbox}
              defaultSplitId={settings.defaultSplitId}
              onUpdatePreferences={updatePreferences}
              onToggleBundleInbox={toggleBundleInbox}
              onSelectSplit={setActiveSplitId}
              onClose={closeSetup}
              canHideFromAll={isGoogle}
              supportsStarred={!isOutlook}
            />
          )}
        </>
      }
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
        isMobileNavOpen={isMailNavOpen}
        onMobileNavOpenChange={setIsMailNavOpen}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MailEngineConnectionBanner />
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {showList && (
            <MailListPanel
              layout={layout}
              inert={readerPreparing || Boolean(previewThreadId)}
            >
              <ListToolbar
                onOpenMailNav={() => setIsMailNavOpen(true)}
                layout={layout}
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
                bundleInbox={bundleInbox}
                onToggleBundleInbox={
                  isInboxView ? toggleBundleInbox : undefined
                }
                onToggleAssistant={onToggleAssistant}
                onOpenSetup={
                  canShowSetup && !isSetupOpen
                    ? () => {
                        // 已清空的邮箱仍可能保留已提交的搜索，
                        // 它会返回并隐藏设置预览。
                        setSearchParam(null);
                        setSetupParam("1");
                      }
                    : undefined
                }
                isSetupSuggested={settings?.setup !== MailSetupState.DONE}
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
                onAddToSplitSelected={
                  canAddToSplit ? openSplitPicker : undefined
                }
                onClearSelection={selection.clear}
              />
              <div data-split-cycle-zone className="contents">
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
                    labelsByAccount={
                      isAllAccounts ? labelsByAccount : undefined
                    }
                    showDivider={isListScrolled}
                  />
                )}
                {scopeTitle ? (
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <Tooltip
                      shortcuts={[{ id: "backToList", label: t`前往收件箱` }]}
                    >
                      <button
                        type="button"
                        onClick={goToInbox}
                        aria-label={t`前往收件箱`}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronLeftIcon className="size-4" />
                      </button>
                    </Tooltip>
                    <h2 className="truncate font-semibold text-base">
                      {scopeTitle}
                    </h2>
                  </div>
                ) : null}
                {isAllAccounts &&
                combinedThreadState.failedAccountIds.length ? (
                  <div className="border-border border-b bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:bg-amber-950/30 dark:text-amber-200">
                    <Trans>
                      部分收件箱无法加载。请稍后重试，或检查其连接。
                    </Trans>
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
                  title={t`无法显示邮件列表`}
                >
                  {isScheduledView ? (
                    <ScheduledEmailList />
                  ) : (
                    <>
                      {searchQuery && error && threads.length > 0 ? (
                        <div
                          role="alert"
                          className="px-6 py-3 text-destructive text-sm"
                        >
                          <Trans>
                            无法刷新搜索结果。当前显示之前加载的邮件。
                          </Trans>
                        </div>
                      ) : null}
                      <LoadingContent
                        loading={
                          !threads.length && (isLoading || !searchSettled)
                        }
                        error={
                          searchQuery && threads.length ? undefined : error
                        }
                        errorComponent={
                          searchQuery && error && !threads.length ? (
                            <div className="flex flex-col items-center pb-8">
                              <ErrorDisplay error={error} />
                              <Button
                                variant="outline"
                                onClick={() =>
                                  refetchThreadList().catch(() =>
                                    toast.error(error.error),
                                  )
                                }
                              >
                                <Trans>重试搜索</Trans>
                              </Button>
                            </div>
                          ) : undefined
                        }
                        loadingComponent={
                          <div className="px-6 py-12 text-center text-muted-foreground text-sm">
                            <span
                              className="inline-flex items-center gap-2"
                              role="status"
                            >
                              <LoadingMiniSpinner />
                              {searchQuery ? (
                                <Trans>正在搜索邮件…</Trans>
                              ) : (
                                <Trans>正在加载邮件…</Trans>
                              )}
                            </span>
                          </div>
                        }
                      >
                        <ThreadList
                          threads={threads}
                          emptyMessage={emptyListMessage}
                          layout={layout}
                          expandedPreview={expandedPreview}
                          userEmail={userEmail}
                          userLabels={isAllAccounts ? NO_LABELS : userLabels}
                          labelsByAccount={labelsByAccount}
                          focusedIndex={clampedIndex}
                          isSelected={selection.isSelected}
                          selectedCount={selection.selectedCount}
                          onOpenThread={openAt}
                          onHoverThread={warmThread}
                          onToggleSelect={selection.toggle}
                          onSelectRangeTo={selection.selectRangeTo}
                          showLoadMore={hasMore}
                          isLoadingMore={isLoadingMore}
                          onLoadMore={loadMore}
                          showSentOpenStatus={
                            scopeType === "sent" && !isAllAccounts
                          }
                          onScrolledChange={setIsListScrolled}
                          rowBundles={rowBundles}
                          onToggleBundle={collapseBundle}
                          listKey={
                            isAllAccounts
                              ? `all-accounts:${searchQuery ?? displayedActiveSplitId}`
                              : JSON.stringify(query)
                          }
                        />
                      </LoadingContent>
                    </>
                  )}
                </MailPanelErrorBoundary>
              </div>
            </MailListPanel>
          )}

          {showReader ? (
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                readerPreparing && "invisible absolute inset-0",
              )}
              // 聊天的邮件预览覆盖阅读器；不要让焦点进入其中。
              inert={Boolean(previewThreadId)}
            >
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
                lastReceivedMessage={lastReceivedMessage}
                isStarred={allStarred}
                onToggleStar={starTargets}
                onMarkSpam={markSpamTargets}
                onDelete={trashTargets}
                onLabel={canLabel ? openLabelPicker : undefined}
                onMove={canLabel ? openMovePicker : undefined}
                onTranslate={translateOpenThread}
                onComment={openTeamComments}
                onPrint={printOpenThread}
                isMenuOpen={isMenuOpen}
                onMenuOpenChange={setIsMenuOpen}
                enableMessageNavigation={!sidePanelThreadId && !previewThreadId}
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

          {previewThreadId ? (
            <MailPreviewOverlay
              threadId={previewThreadId}
              onClose={closePreview}
              onNavigate={navigatePreview}
              onOpenInReader={openPreviewInReader}
            />
          ) : null}
        </div>
      </div>
    </MailProductFrame>
  );
}

function getScopeTitle({
  scopeType,
  scopeLabelId,
  scopeFolderId,
  labels,
  folders,
  isGoogle,
  isOutlook,
  i18n,
}: {
  scopeType: string | null;
  scopeLabelId: string | null;
  scopeFolderId: string | null;
  labels: { id: string; name: string }[];
  folders: OutlookFolder[];
  isGoogle: boolean;
  isOutlook: boolean;
  i18n: I18n;
}): string | null {
  if (scopeLabelId)
    return labels.find((label) => label.id === scopeLabelId)?.name ?? null;
  if (scopeFolderId)
    return (
      flattenOutlookFolders(folders).find(
        (folder) => folder.id === scopeFolderId,
      )?.displayName ?? null
    );
  const item = [
    ...MAILBOX_ITEMS,
    ...getMailCategories({ isGoogle, isOutlook }),
  ].find((item) => item.type === scopeType);
  return item ? i18n._(item.label) : null;
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
  // 选择回调会捕获 ids；顺序不变时保留它们，
  // 使编辑一行的快照不会重新渲染每一行。
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

function onlyKeys(keys: ReadonlySet<string>, allowed: ReadonlySet<string>) {
  return new Set([...keys].filter((key) => allowed.has(key)));
}

function hasSameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((key) => b.has(key));
}
