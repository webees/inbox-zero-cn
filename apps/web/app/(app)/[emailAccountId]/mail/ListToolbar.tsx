"use client";

import {
  MailListToolbarSurface,
  MailSearchSurface,
} from "@inboxzero/mail-ui/MailListToolbarSurface";
import {
  memo,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  MailIcon,
  MailOpenIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SplitIcon,
  StarIcon,
  StarOffIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { MailSearchFiltersForm } from "@/app/(app)/[emailAccountId]/mail/MailSearchFilters";
import { OutlookSearchFiltersForm } from "@/app/(app)/[emailAccountId]/mail/OutlookSearchFilters";
import {
  MailSearchHint,
  MailSearchSuggestionList,
  suggestionOptionId,
  useMailSearchSuggestions,
} from "@/app/(app)/[emailAccountId]/mail/MailSearchSuggestions";
import {
  readRecentSearches,
  rememberRecentSearch,
} from "@/store/mail-search-history";
import { parseMailSearchQuery } from "@/app/(app)/[emailAccountId]/mail/mail-search-query";
import { parseOutlookSearchQuery } from "@/app/(app)/[emailAccountId]/mail/outlook-search-query";
import type { MailLayoutMode } from "@/app/(app)/[emailAccountId]/mail/types";
import { Tooltip } from "@/components/Tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { getShortcutHint } from "@/lib/shortcuts/registry";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAccount } from "@/providers/EmailAccountProvider";
import { cn } from "@/utils";

export type ListToolbarProps = {
  layout: MailLayoutMode;
  expandedPreview: boolean;
  /** Committed search query. */
  searchQuery: string;
  onSearch: (query: string) => void;
  searchValue: string;
  onSearchChange: (query: string) => void;
  /** 让 `/` 可从快捷键处理器聚焦邮件搜索框。 */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  /** 搜索下拉框中提供的 Gmail 标签或 Outlook 类别。 */
  searchLabels?: { name: string }[];
  searchFolders?: { name: string }[];
  searchVariant?: "gmail" | "outlook" | "common";
  onToggleLayout: () => void;
  onTogglePreview: () => void;
  bundleInbox: boolean;
  /** 在单账号收件箱之外省略，因为那里从不应用归集。 */
  onToggleBundleInbox?: () => void;
  onToggleAssistant: () => void;
  onOpenAllSettings?: () => void;
  /** 在设置卡片不适用或已打开时省略。 */
  onOpenSetup?: () => void;
  /** 在读者完成一次设置之前标记视图选项菜单。 */
  isSetupSuggested: boolean;
  /** 仅当分栏标签页行未显示并承载它时在此渲染。 */
  selectAll?: ReactNode;
  selectedCount: number;
  onArchiveSelected: () => void;
  /** 选中的每个会话都已归档时设置；替代归档。 */
  onMoveToInboxSelected?: () => void;
  onDeleteSelected: () => void;
  isUnreadSelected: boolean;
  onMarkReadSelected: () => void;
  onMarkUnreadSelected: () => void;
  /** 选中的每个会话都已加星标时为真。 */
  isStarredSelected: boolean;
  onStarSelected: () => void;
  /** 当前视图无法添加标签（合并收件箱）时省略。 */
  onLabelSelected?: () => void;
  /** 没有发件人可加入的分栏时省略。 */
  onAddToSplitSelected?: () => void;
  onClearSelection: () => void;
  /** 在屏幕过窄而无法显示侧栏时打开邮件导航面板。 */
  onOpenMailNav: () => void;
};

export const ListToolbar = memo(function ListToolbar({
  layout,
  expandedPreview,
  searchQuery = "",
  onSearch,
  onSearchChange,
  searchValue,
  searchInputRef,
  searchLabels,
  searchFolders,
  searchVariant = "gmail",
  onToggleLayout,
  onTogglePreview,
  bundleInbox,
  onToggleBundleInbox,
  onToggleAssistant,
  onOpenAllSettings,
  onOpenSetup,
  isSetupSuggested,
  selectAll,
  selectedCount,
  onArchiveSelected,
  onMoveToInboxSelected,
  onDeleteSelected,
  isUnreadSelected,
  onMarkReadSelected,
  onMarkUnreadSelected,
  isStarredSelected,
  onStarSelected,
  onLabelSelected,
  onAddToSplitSelected,
  onClearSelection,
  onOpenMailNav,
}: ListToolbarProps) {
  const { t } = useLingui();
  const { state } = useSidebar();
  const isSidebarCollapsed = !state.includes("left-sidebar");

  return (
    <MailListToolbarSurface
      className={cn(
        // The collapsed rail is narrower than the mac traffic lights, so the
        // toolbar starts after them and the sidebar toggle lifted beside them.
        isSidebarCollapsed &&
          "lg:pl-[max(0.75rem,calc(var(--desktop-traffic-lights-width,0px)-0.75rem))]",
      )}
    >
      <button
        type="button"
        onClick={onOpenMailNav}
        aria-label={t`打开导航`}
        className={cn(toolbarButton, "w-8 justify-center px-0 lg:hidden")}
      >
        <PanelLeftIcon className="size-3.5" />
      </button>
      {selectAll}

      {/* 选择会就地替换工具栏控件，让列表不会
          为了给新行腾出空间而向下移动。 */}
      {selectedCount > 0 ? (
        <>
          <span
            aria-live="polite"
            className="min-w-0 flex-1 truncate font-medium text-sm"
          >
            <Plural
              value={selectedCount}
              one="已选择 # 项"
              other="已选择 # 项"
            />
          </span>

          {onMoveToInboxSelected ? (
            <Tooltip content={t`移至收件箱`}>
              <button
                type="button"
                onClick={onMoveToInboxSelected}
                aria-label={t`移至收件箱`}
                className={cn(toolbarButton, "w-8 justify-center px-0")}
              >
                <ArchiveRestoreIcon className="size-3.5" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip shortcuts={["archive"]}>
              <button
                type="button"
                onClick={onArchiveSelected}
                aria-label={t`归档`}
                className={cn(toolbarButton, "w-8 justify-center px-0")}
              >
                <ArchiveIcon className="size-3.5" />
              </button>
            </Tooltip>
          )}

          <Tooltip
            content={isUnreadSelected ? t`标记为已读` : undefined}
            shortcuts={isUnreadSelected ? undefined : ["markUnread"]}
          >
            <button
              type="button"
              onClick={
                isUnreadSelected ? onMarkReadSelected : onMarkUnreadSelected
              }
              aria-label={isUnreadSelected ? t`标记为已读` : t`标记为未读`}
              className={cn(toolbarButton, "w-8 justify-center px-0")}
            >
              {isUnreadSelected ? (
                <MailOpenIcon className="size-3.5" />
              ) : (
                <MailIcon className="size-3.5" />
              )}
            </button>
          </Tooltip>

          <Tooltip shortcuts={["star"]}>
            <button
              type="button"
              onClick={onStarSelected}
              aria-label={isStarredSelected ? t`取消星标` : t`加星标`}
              className={cn(toolbarButton, "w-8 justify-center px-0")}
            >
              {isStarredSelected ? (
                <StarOffIcon className="size-3.5" />
              ) : (
                <StarIcon className="size-3.5" />
              )}
            </button>
          </Tooltip>

          <Tooltip shortcuts={["delete"]}>
            <button
              type="button"
              onClick={onDeleteSelected}
              aria-label={t`删除`}
              className={cn(
                toolbarButton,
                "w-8 justify-center px-0 hover:bg-destructive/10 hover:text-destructive",
              )}
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </Tooltip>

          {onLabelSelected ? (
            <Tooltip shortcuts={["label"]}>
              <button
                type="button"
                onClick={onLabelSelected}
                aria-label={t`标签`}
                className={cn(toolbarButton, "w-8 justify-center px-0")}
              >
                <TagIcon className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}

          {onAddToSplitSelected ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t`更多选择操作`}
                  className={cn(toolbarButton, "w-8 justify-center px-0")}
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onAddToSplitSelected}>
                  <SplitIcon className="mr-2 size-4" />
                  <Trans>将发件人添加到分栏</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Tooltip shortcuts={[{ id: "backToList", label: t`清除选择` }]}>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label={t`清除选择`}
              className={cn(toolbarButton, "w-8 justify-center px-0")}
            >
              <XIcon className="size-3.5" />
            </button>
          </Tooltip>
        </>
      ) : (
        <MailSearchInput
          // Reset the advanced-search form when the committed query changes.
          key={searchQuery}
          searchQuery={searchQuery}
          onSearch={onSearch}
          onSearchChange={onSearchChange}
          searchValue={searchValue}
          inputRef={searchInputRef}
          searchLabels={searchLabels}
          searchFolders={searchFolders}
          searchVariant={searchVariant}
        />
      )}

      {selectedCount === 0 ? (
        <ViewOptionsMenu
          layout={layout}
          expandedPreview={expandedPreview}
          onToggleLayout={onToggleLayout}
          onTogglePreview={onTogglePreview}
          bundleInbox={bundleInbox}
          onToggleBundleInbox={onToggleBundleInbox}
          onOpenAllSettings={onOpenAllSettings}
          onOpenSetup={onOpenSetup}
          isSetupSuggested={isSetupSuggested}
        />
      ) : null}

      {selectedCount === 0 ? (
        <Tooltip shortcuts={["toggleAssistant"]}>
          <button
            type="button"
            onClick={onToggleAssistant}
            aria-label={t`切换 AI 助手`}
            className={cn(
              toolbarButton,
              "w-8 justify-center bg-blue-500/10 px-0 text-blue-600 hover:bg-blue-500/20 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
            )}
          >
            <SparklesIcon className="size-4" />
          </button>
        </Tooltip>
      ) : null}
    </MailListToolbarSurface>
  );
});

function MailSearchInput({
  searchQuery,
  onSearch,
  onSearchChange,
  searchValue,
  inputRef: inputRefProp,
  searchLabels = [],
  searchFolders = [],
  searchVariant = "gmail",
}: {
  searchQuery: string;
  onSearch: (query: string) => void;
  searchValue: string;
  onSearchChange: (query: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  searchLabels?: { name: string }[];
  searchFolders?: { name: string }[];
  searchVariant?: "gmail" | "outlook" | "common";
}) {
  const { t } = useLingui();
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = inputRefProp ?? localRef;
  const { emailAccountId } = useAccount();
  const suggestionListId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState(searchQuery);
  const draft = searchValue;
  const [focused, setFocused] = useState(false);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const suggestions = useMailSearchSuggestions({
    draft,
    emailAccountId,
    enabled: focused && !filtersOpen && !suggestionsDismissed,
    recentSearches,
  });
  const suggestionsOpen = suggestions.length > 0;
  const hintOpen =
    focused &&
    !draft &&
    !suggestionsOpen &&
    !filtersOpen &&
    !suggestionsDismissed;
  const highlightedIndex = activeIndex < suggestions.length ? activeIndex : -1;

  const commitSearch = (query: string) => {
    const trimmed = query.trim();
    if (trimmed) rememberRecentSearch(emailAccountId, trimmed);
    onSearch(trimmed);
  };

  return (
    <Popover
      modal
      open={filtersOpen}
      onOpenChange={(open) => {
        if (open) setFilterDraft(draft);
        setFiltersOpen(open);
      }}
    >
      <PopoverAnchor asChild>
        <MailSearchSurface
          active={filtersOpen}
          searchIcon={<SearchIcon className="size-3.5 shrink-0" />}
          onSubmit={(event) => {
            event.preventDefault();
            commitSearch(draft);
          }}
          controls={
            <>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t`显示搜索选项`}
                  aria-expanded={filtersOpen}
                  className={cn(
                    "flex h-full w-7 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    filtersOpen && "text-foreground",
                  )}
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-3.5 transition-transform",
                      filtersOpen && "rotate-180",
                    )}
                  />
                </button>
              </PopoverTrigger>
              {suggestionsOpen ? (
                <MailSearchSuggestionList
                  activeIndex={highlightedIndex}
                  id={suggestionListId}
                  onSelect={(suggestion) => commitSearch(suggestion.query)}
                  suggestions={suggestions}
                />
              ) : null}
              {hintOpen ? <MailSearchHint /> : null}
            </>
          }
        >
          <input
            ref={inputRef}
            value={draft}
            placeholder={t`搜索邮件`}
            enterKeyHint="search"
            role="combobox"
            aria-label={t`搜索邮件`}
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen}
            aria-controls={suggestionsOpen ? suggestionListId : undefined}
            aria-activedescendant={
              highlightedIndex >= 0
                ? suggestionOptionId(suggestionListId, highlightedIndex)
                : undefined
            }
            // 表单插件会将未设置类型的输入框设为 1rem，因此需要显式
            // 设置尺寸，让该字段与工具栏其余部分保持一致。
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground text-sm outline-none focus:ring-0 placeholder:text-muted-foreground"
            onChange={(event) => {
              onSearchChange(event.target.value);
              setActiveIndex(-1);
              setSuggestionsDismissed(false);
            }}
            onFocus={() => {
              setRecentSearches(readRecentSearches(emailAccountId));
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
              setActiveIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && suggestionsOpen) {
                event.preventDefault();
                setActiveIndex(
                  Math.min(highlightedIndex + 1, suggestions.length - 1),
                );
                return;
              }
              if (event.key === "ArrowUp" && suggestionsOpen) {
                event.preventDefault();
                setActiveIndex(Math.max(highlightedIndex - 1, -1));
                return;
              }
              if (event.key === "Enter" && highlightedIndex >= 0) {
                event.preventDefault();
                commitSearch(suggestions[highlightedIndex].query);
                return;
              }
              if (event.key !== "Escape") return;
              // 邮件全局的 Escape 快捷键也会清空搜索，因此这里
              // 处理过的按键必须不能传给全局快捷键。
              if (suggestionsOpen || filtersOpen || draft || searchQuery) {
                event.preventDefault();
              }
              if (suggestionsOpen) {
                setSuggestionsDismissed(true);
                setActiveIndex(-1);
                return;
              }
              if (filtersOpen) {
                setFiltersOpen(false);
                return;
              }
              if (draft || searchQuery) {
                onSearchChange("");
                onSearch("");
              } else {
                inputRef.current?.blur();
              }
            }}
          />
          {draft || searchQuery ? (
            <button
              type="button"
              aria-label={t`清除搜索`}
              onClick={() => onSearch("")}
              className="shrink-0 rounded p-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </MailSearchSurface>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(34rem,calc(100vw-1.5rem))] p-4"
        onPointerDownOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-radix-select-viewport]")) {
            event.preventDefault();
          }
        }}
      >
        {filtersOpen ? (
          <AdvancedSearchForm
            filterDraft={filterDraft}
            searchFolders={searchFolders}
            searchLabels={searchLabels}
            searchVariant={searchVariant}
            onSearch={(query) => {
              commitSearch(query);
              setFiltersOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function AdvancedSearchForm({
  filterDraft,
  searchFolders,
  searchLabels,
  searchVariant,
  onSearch,
}: {
  filterDraft: string;
  searchFolders: { name: string }[];
  searchLabels: { name: string }[];
  searchVariant: "gmail" | "outlook" | "common";
  onSearch: (query: string) => void;
}) {
  if (searchVariant === "outlook") {
    return (
      <OutlookSearchFiltersForm
        key={filterDraft}
        initialFields={parseOutlookSearchQuery(filterDraft)}
        folders={searchFolders}
        categories={searchLabels}
        onSearch={onSearch}
      />
    );
  }

  return (
    <MailSearchFiltersForm
      key={filterDraft}
      initialFields={parseMailSearchQuery(filterDraft)}
      extraLocations={searchLabels}
      variant={searchVariant === "common" ? "common" : "gmail"}
      onSearch={onSearch}
    />
  );
}

function ViewOptionsMenu({
  layout,
  expandedPreview,
  onToggleLayout,
  onTogglePreview,
  bundleInbox,
  onToggleBundleInbox,
  onOpenAllSettings,
  onOpenSetup,
  isSetupSuggested,
}: Pick<
  ListToolbarProps,
  | "layout"
  | "expandedPreview"
  | "onToggleLayout"
  | "onTogglePreview"
  | "bundleInbox"
  | "onToggleBundleInbox"
  | "onOpenAllSettings"
  | "onOpenSetup"
  | "isSetupSuggested"
>) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <Tooltip content={t`视图选项`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t`视图选项`}
            className={cn(toolbarButton, "relative w-8 justify-center px-0")}
          >
            <SlidersHorizontalIcon className="size-3.5" />
            {isSetupSuggested && onOpenSetup ? (
              <span className="absolute top-1 right-1 flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        {onToggleBundleInbox ? (
          <DropdownMenuCheckboxItem
            checked={bundleInbox}
            onCheckedChange={onToggleBundleInbox}
          >
            <Trans>归集低优先级邮件</Trans>
          </DropdownMenuCheckboxItem>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={expandedPreview}
          onCheckedChange={onTogglePreview}
        >
          <Trans>展开预览文本</Trans>
          <DropdownMenuShortcut>
            {getShortcutHint("togglePreview")}
          </DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={layout === "split"}
          onCheckedChange={onToggleLayout}
        >
          <Trans>分栏视图</Trans>
          <DropdownMenuShortcut>
            {getShortcutHint("toggleLayout")}
          </DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        {(onOpenAllSettings || onOpenSetup) && <DropdownMenuSeparator />}
        {onOpenAllSettings && (
          <DropdownMenuItem onSelect={onOpenAllSettings} inset>
            <Trans>选择全部显示的内容</Trans>
          </DropdownMenuItem>
        )}
        {onOpenSetup && (
          <DropdownMenuItem onSelect={onOpenSetup}>
            <SettingsIcon className="size-4" />
            {isSetupSuggested ? (
              <Trans>设置你的收件箱</Trans>
            ) : (
              <Trans>重新运行邮件设置</Trans>
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const toolbarButton =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
