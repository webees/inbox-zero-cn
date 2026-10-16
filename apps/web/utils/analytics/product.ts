export const PRODUCT_ANALYTICS_EVENTS = {
  pageViewed: "app_page_viewed",
  navigationClicked: "app_navigation_clicked",
  pageAction: "app_page_action",
} as const;

/**
 * 当路径或查询发生变化时会触发 `$pageview` 和 `app_page_viewed`，
 * 但会话选择或搜索文本不会触发；参见 `getPageViewSearch`。
 * 每个事件的 URL 也会剔除这些参数；参见 `stripUntrackedUrlParams`。
 *
 * 邮件应用的使用情况与速度。属性只包含 id、计数、枚举和
 * 时长：绝不包含主题、发件人、搜索文本或正文内容。
 *
 * 每个事件上的超级属性（在 PostHog 初始化时注册）：
 * - `desktop_version`：桌面应用版本，仅桌面端，从
 *   Electron user agent 解析得出。
 * - `mail_engine_transport`："desktop-ipc" | "browser" | "unavailable"。
 *
 * `mail_action`：通过键盘或命令面板执行的邮件命令。
 * 点击由自动捕获覆盖。
 * - `action`：来自 `lib/shortcuts/registry.ts` 的快捷键 id（例如 "archive"、
 *   "reply"、"snooze"）或命令面板命令 id（例如 "mail-archive"、
 *   "nav-inbox"、"rule-<ruleId>"）。
 * - `source`："shortcut" | "palette"。
 * - `shortcut`：所触发的注册表按键组合，例如 "e"、"mod+k"、"g>a"。
 *   仅限快捷键。
 *
 * `mail_navigation_summary`：列表导航快捷键（J/K、方向键、扩展
 * 选择）会被累计计数，而不是每次按下都发送。每 5 分钟
 * 以及页面被隐藏时刷写，且仅在计数非零时进行。
 * - 每个按下的快捷键对应 `<shortcutId>_count`：`next_count`、`previous_count`、
 *   `extendSelectionDown_count`、`extendSelectionUp_count`。
 * - `total_count`：各计数之和。
 *
 * `mail_performance_summary`：真实用户速度，由随机 5% 的页面
 * 加载（`sample_rate`）从首次访问邮件起发送。每 5 分钟
 * 以及页面被隐藏时刷写，且仅在存在数据时进行。每个指标
 * 都有 `<metric>_count`、`_p50_ms`、`_p75_ms`、`_p95_ms` 和 `_max_ms`：
 * - `input_event`：keydown/pointerdown/click 事件时长（输入到下一次
 *   绘制），针对至少 40ms 的事件。
 * - `long_task`：超过 50ms 的主线程任务，外加
 *   `long_task_total_blocking_ms`（超过 50ms 的时长之和）。
 * - `thread_switch`：从打开的会话发生切换（J/K、方向键、Enter、
 *   点击）到阅读器呈现它的时长。
 *
 * `desktop_health_summary`：桌面应用健康状态，由每个桌面窗口在
 * 加载约 2 分钟后发送，之后每小时发送一次。覆盖自任一窗口上一次
 * 摘要以来的时间（`interval_ms`），因此各窗口不会重复计算
 * 同一段区间。时长指标有 `<metric>_count`、`_p50_ms`、
 * `_p95_ms` 和 `_max_ms`，在没有样本时省略：
 * - `main_loop_delay`：Electron 主进程事件循环延迟。数值偏高
 *   意味着窗口输入和 IPC 被阻塞。
 * - `engine_loop_delay`：本地邮件引擎进程的同类指标。
 * - `sqlite_read` / `sqlite_write`：邮件数据库事务，从
 *   调用时开始计时，因此读取时间包含排在写入之后的排队时间。
 * - `engine_running`、`engine_restarts`（自应用启动以来恢复的引擎崩溃次数）、
 *   `mailbox_bytes`（本地数据库大小）以及
 *   `desktop_version`。
 */
export const MAIL_ANALYTICS_EVENTS = {
  action: "mail_action",
  desktopHealthSummary: "desktop_health_summary",
  navigationSummary: "mail_navigation_summary",
  performanceSummary: "mail_performance_summary",
} as const;

export const PRODUCT_ANALYTICS_ACTIONS = {
  chat: {
    attachButtonClicked: "chat_attach_button_clicked",
    attachmentsAdded: "chat_attachments_added",
    generationStopped: "chat_generation_stopped",
    messageSubmitted: "chat_message_submitted",
    suggestionClicked: "chat_suggestion_clicked",
    voiceDictationStarted: "chat_voice_dictation_started",
    voiceLiveStarted: "chat_voice_live_started",
  },
  navigation: {
    tabSelected: "tab_selected",
  },
  channels: {
    channelConnectStarted: "channel_connect_started",
    channelDisconnected: "channel_disconnected",
    channelLinkCodeCreated: "channel_link_code_created",
    featureRouteToggled: "feature_route_toggled",
    ruleChannelModeChanged: "rule_channel_mode_changed",
    ruleChannelToggled: "rule_channel_toggled",
  },
  calendars: {
    bookingLinkSaved: "calendar_booking_link_saved",
    bookingLinkSaveStarted: "calendar_booking_link_save_started",
    connectFailed: "calendar_connect_failed",
    connectStarted: "calendar_connect_started",
    connectStartFailed: "calendar_connect_start_failed",
    timezoneSaved: "calendar_timezone_saved",
    timezoneSaveStarted: "calendar_timezone_save_started",
  },
  timezone: {
    autoSet: "timezone_auto_set",
    promptAccepted: "timezone_prompt_accepted",
    promptDismissed: "timezone_prompt_dismissed",
    promptShown: "timezone_prompt_shown",
  },
  meetingBriefs: {
    emailDeliverySaved: "meeting_briefs_email_delivery_saved",
    emailDeliveryToggled: "meeting_briefs_email_delivery_toggled",
    enabledSaved: "meeting_briefs_enabled_saved",
    enableStarted: "meeting_briefs_enable_started",
    toggled: "meeting_briefs_toggled",
  },
  meetingRecorder: {
    disabled: "meeting_recorder_disabled",
    enabled: "meeting_recorder_enabled",
    enableStarted: "meeting_recorder_enable_started",
    followUpDraftOpened: "meeting_recorder_follow_up_draft_opened",
    joinOverrideToggled: "meeting_recorder_join_override_toggled",
    meetingOpened: "meeting_recorder_meeting_opened",
    settingChanged: "meeting_recorder_setting_changed",
  },
  bulkUnsubscribe: {
    bulkCompleted: "bulk_unsubscribe_completed",
    bulkStarted: "bulk_unsubscribe_started",
    senderCompleted: "unsubscribe_sender_completed",
    senderFailed: "unsubscribe_sender_failed",
    senderStarted: "unsubscribe_sender_started",
  },
  bulkArchive: {
    actionChanged: "bulk_archive_action_changed",
    categorizationCompleted: "bulk_archive_categorization_completed",
    setupDialogToggled: "bulk_archive_setup_dialog_toggled",
  },
  autoFile: {
    enabled: "auto_file_enabled",
    enableFailed: "auto_file_enable_failed",
    enableStarted: "auto_file_enable_started",
    folderRemoved: "auto_file_folder_removed",
    folderSelected: "auto_file_folder_selected",
    previewFailed: "auto_file_preview_failed",
    previewFeedbackSubmitted: "auto_file_preview_feedback_submitted",
    previewItemFailed: "auto_file_preview_item_failed",
    previewItemFiled: "auto_file_preview_item_filed",
    previewItemMoved: "auto_file_preview_item_moved",
    previewItemSkipped: "auto_file_preview_item_skipped",
    previewCompleted: "auto_file_preview_completed",
    previewStarted: "auto_file_preview_started",
    promptSaveFailed: "auto_file_prompt_save_failed",
    promptSaved: "auto_file_prompt_saved",
  },
  integrations: {
    connected: "integration_connected",
    connectFailed: "integration_connect_failed",
    connectionPending: "integration_connection_pending",
    connectStarted: "integration_connect_started",
    disconnected: "integration_disconnected",
    disconnectStarted: "integration_disconnect_started",
    toggled: "integration_toggled",
    toolsExpanded: "integration_tools_expanded",
    toolToggled: "integration_tool_toggled",
  },
  analytics: {
    dateRangeChanged: "analytics_date_range_changed",
    groupingChanged: "analytics_grouping_changed",
  },
  video: {
    completed: "video_completed",
    dismissed: "video_dismissed",
    opened: "video_opened",
    progress: "video_progress",
    started: "video_started",
    viewed: "video_viewed",
  },
  deepClean: {
    started: "deep_clean_started",
  },
} as const;

export const APP_PAGES = {
  mail: { label: "邮件", area: "mail" },
  shared_conversations: { label: "与我共享", area: "mail" },
  shared_activity: { label: "动态", area: "mail" },
  assistant_chat: { label: "聊天", area: "manage" },
  automation: { label: "助手", area: "manage" },
  channels: { label: "渠道", area: "manage" },
  meetings: { label: "会议", area: "manage" },
  bulk_unsubscribe: { label: "批量退订", area: "cleanup" },
  bulk_archive: { label: "批量归档", area: "cleanup" },
  analytics: { label: "分析", area: "cleanup" },
  deep_clean: { label: "深度清理", area: "cleanup" },
  meeting_briefs: { label: "会议简报", area: "more" },
  attachments: { label: "附件", area: "more" },
  calendars: { label: "日历", area: "more" },
  integrations: { label: "集成", area: "more" },
} as const;

export type AppPage = keyof typeof APP_PAGES;
export type ProductAnalyticsAction = StringLeaf<
  typeof PRODUCT_ANALYTICS_ACTIONS
>;

const APP_ROUTE_SEGMENTS: Array<{ segment: string; page: AppPage }> = [
  { segment: "mail", page: "mail" },
  { segment: "compose", page: "mail" },
  // Before "shared", which also appears in /shared/activity.
  { segment: "activity", page: "shared_activity" },
  { segment: "shared", page: "shared_conversations" },
  { segment: "assistant", page: "assistant_chat" },
  { segment: "automation", page: "automation" },
  { segment: "channels", page: "channels" },
  { segment: "meetings", page: "meetings" },
  { segment: "bulk-unsubscribe", page: "bulk_unsubscribe" },
  { segment: "bulk-archive", page: "bulk_archive" },
  { segment: "quick-bulk-archive", page: "bulk_archive" },
  { segment: "stats", page: "analytics" },
  { segment: "clean", page: "deep_clean" },
  { segment: "briefs", page: "meeting_briefs" },
  { segment: "drive", page: "attachments" },
  { segment: "calendars", page: "calendars" },
  { segment: "integrations", page: "integrations" },
];

const UNTRACKED_PAGE_VIEW_PARAMS = [
  "thread-id",
  "thread-account-id",
  "side-panel-thread-id",
  "q",
];

const NAV_ITEM_PAGES: Record<string, AppPage> = {
  Inbox: "mail",
  Drafts: "mail",
  Sent: "mail",
  Archived: "mail",
  Personal: "mail",
  Social: "mail",
  Updates: "mail",
  Forums: "mail",
  Promotions: "mail",
  Chat: "assistant_chat",
  "Shared with me": "shared_conversations",
  Activity: "shared_activity",
  Assistant: "automation",
  Channels: "channels",
  Meetings: "meetings",
  "Bulk Unsubscribe": "bulk_unsubscribe",
  "Bulk Archive": "bulk_archive",
  Analytics: "analytics",
  "Deep Clean": "deep_clean",
  "Meeting Briefs": "meeting_briefs",
  Attachments: "attachments",
  Calendars: "calendars",
  Integrations: "integrations",
};

export function getAppPageFromPathname(
  pathname: string | null | undefined,
): AppPage | null {
  if (!pathname) return null;

  const segments = pathname.split("/").filter(Boolean);
  const route = APP_ROUTE_SEGMENTS.find(({ segment }) =>
    segments.includes(segment),
  );

  return route?.page ?? null;
}

export function getAppPageFromNavItem({
  name,
  href,
}: {
  name: string;
  href: string;
}): AppPage | null {
  if (NAV_ITEM_PAGES[name]) return NAV_ITEM_PAGES[name];

  const hrefPath = href.startsWith("?") ? null : href.split("?")[0];
  return getAppPageFromPathname(hrefPath);
}

export function getAppPageProperties(page: AppPage | null) {
  if (!page) return {};

  const config = APP_PAGES[page];
  return {
    app_page: page,
    app_page_label: config.label,
    app_area: config.area,
  };
}

export function getAppPageViewProperties({
  pathname,
  searchParams,
}: {
  pathname: string | null | undefined;
  searchParams?: Pick<URLSearchParams, "get"> | null;
}) {
  const page = getAppPageFromPathname(pathname);
  if (!page) return null;

  const tab = searchParams?.get("tab") || undefined;
  const mailType = searchParams?.get("type") || undefined;

  return {
    ...getAppPageProperties(page),
    route: pathname,
    ...(tab ? { tab } : {}),
    ...(mailType ? { mail_type: mailType } : {}),
  };
}

/**
 * 页面浏览记录所依据的查询字符串。打开会话或使用
 * J/K 移动会重写会话参数，这并不算作新页面，而且 id 和搜索
 * 文本也不应出现在分析 URL 中。
 */
const URL_PROPERTY_KEYS = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
];

/**
 * PostHog 会把页面 URL 附加到每个事件上（包括自动捕获），
 * 否则查询中的会话 id 和搜索文本就会传到那里。
 */
export function stripUntrackedUrlParams<
  T extends {
    properties?: Record<string, unknown>;
    $set?: Record<string, unknown>;
    $set_once?: Record<string, unknown>;
  } | null,
>(event: T): T {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const key of URL_PROPERTY_KEYS) {
      const value = bag[key];
      if (typeof value === "string") bag[key] = withoutUntrackedParams(value);
    }
  }
  return event;
}

export function getPageViewSearch(
  searchParams: Pick<URLSearchParams, "toString"> | null | undefined,
): string {
  const params = new URLSearchParams(searchParams?.toString());
  for (const param of UNTRACKED_PAGE_VIEW_PARAMS) params.delete(param);
  return params.toString();
}

type StringLeaf<T> = T extends string
  ? T
  : T extends Record<string, unknown>
    ? StringLeaf<T[keyof T]>
    : never;

function withoutUntrackedParams(value: string) {
  try {
    const url = new URL(value);
    for (const param of UNTRACKED_PAGE_VIEW_PARAMS)
      url.searchParams.delete(param);
    return url.toString();
  } catch {
    return value;
  }
}
