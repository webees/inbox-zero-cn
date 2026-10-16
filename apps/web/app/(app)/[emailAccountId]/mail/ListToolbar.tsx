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
  ColumnsIcon,
  MailIcon,
  MailOpenIcon,
  RowsIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  StarOffIcon,
  TagIcon,
  TextIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { MailTitlebarNav } from "@/app/(app)/[emailAccountId]/mail/MailTitlebarNav";
import { MailSearchFiltersForm } from "@/app/(app)/[emailAccountId]/mail/MailSearchFilters";
import { OutlookSearchFiltersForm } from "@/app/(app)/[emailAccountId]/mail/OutlookSearchFilters";
import {
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
  isDesktopApp: boolean;
  showLayoutToggle?: boolean;
  expandedPreview: boolean;
  /** 已提交的搜索查询。 */
  searchQuery: string;
  onSearch: (query: string) => void;
  searchValue: string;
  onSearchChange: (query: string) => void;
  /** 让 `/` 在快捷键处理器中聚焦邮件搜索框。 */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  /** 搜索下拉框中提供的 Gmail 标签或 Outlook 分类。 */
  searchLabels?: { name: string }[];
  searchFolders?: { name: string }[];
  searchVariant?: "gmail" | "outlook" | "common";
  onToggleLayout: () => void;
  onTogglePreview: () => void;
  onToggleAssistant: () => void;
  /** 仅在分栏标签行未显示时渲染在此处占位。 */
  selectAll?: ReactNode;
  selectedCount: number;
  onArchiveSelected: () => void;
  /** 当所有选中的会话都已归档时设置；用于替代“归档”。 */
  onMoveToInboxSelected?: () => void;
  onDeleteSelected: () => void;
  isUnreadSelected: boolean;
  onMarkReadSelected: () => void;
  onMarkUnreadSelected: () => void;
  /** 当所有选中的会话都已加星标时为 true。 */
  isStarredSelected: boolean;
  onStarSelected: () => void;
  /** 当前视图无法添加标签（合并收件箱）时省略。 */
  onLabelSelected?: () => void;
  onClearSelection: () => void;
};

export const ListToolbar = memo(function ListToolbar({
  layout,
  isDesktopApp,
  showLayoutToggle = true,
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
  onToggleAssistant,
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
  onClearSelection,
}: ListToolbarProps) {
  const LayoutIcon = layout === "split" ? ColumnsIcon : RowsIcon;

  return (
    <MailListToolbarSurface>
      <MailTitlebarNav showHistory={isDesktopApp} />
      {selectAll}

      {/* 选择会就地替换工具栏控件，这样列表不会为新行向下移动。 */}
      {selectedCount > 0 ? (
        <>
          <span
            aria-live="polite"
            className="min-w-0 flex-1 truncate font-medium text-sm"
          >{`已选择 ${selectedCount} 项`}</span>

          {onMoveToInboxSelected ? (
            <Tooltip content="移至收件箱">
              <button
                type="button"
                onClick={onMoveToInboxSelected}
                aria-label="移至收件箱"
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
                aria-label="归档"
                className={cn(toolbarButton, "w-8 justify-center px-0")}
              >
                <ArchiveIcon className="size-3.5" />
              </button>
            </Tooltip>
          )}

          <Tooltip
            content={isUnreadSelected ? "标记为已读" : undefined}
            shortcuts={isUnreadSelected ? undefined : ["markUnread"]}
          >
            <button
              type="button"
              onClick={
                isUnreadSelected ? onMarkReadSelected : onMarkUnreadSelected
              }
              aria-label={isUnreadSelected ? "标记为已读" : "标记为未读"}
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
              aria-label={isStarredSelected ? "取消星标" : "加星标"}
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
              aria-label="删除"
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
                aria-label="标签"
                className={cn(toolbarButton, "w-8 justify-center px-0")}
              >
                <TagIcon className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}

          <Tooltip shortcuts={[{ id: "backToList", label: "清除选择" }]}>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="清除选择"
              className={cn(toolbarButton, "w-8 justify-center px-0")}
            >
              <XIcon className="size-3.5" />
            </button>
          </Tooltip>
        </>
      ) : (
        <MailSearchInput
          // 当已提交的查询变化时重置高级搜索表单。
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
        <Tooltip
          shortcuts={[
            {
              id: "togglePreview",
              label: expandedPreview ? "缩短预览文本" : "展开预览文本",
            },
          ]}
        >
          <button
            type="button"
            onClick={onTogglePreview}
            aria-label="展开或缩短预览文本"
            aria-pressed={expandedPreview}
            className={cn(
              toolbarButton,
              "w-8 justify-center px-0",
              expandedPreview && "bg-muted text-foreground",
            )}
          >
            <TextIcon className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}

      {showLayoutToggle && selectedCount === 0 ? (
        <Tooltip
          shortcuts={[{ id: "toggleLayout", label: "切换列表 / 分栏视图" }]}
        >
          <button
            type="button"
            onClick={onToggleLayout}
            aria-label="切换列表或分栏视图"
            className={cn(toolbarButton, "w-8 justify-center px-0")}
          >
            <LayoutIcon className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}

      {selectedCount === 0 ? (
        <Tooltip content="AI 助手">
          <button
            type="button"
            onClick={onToggleAssistant}
            aria-label="切换 AI 助手"
            className={cn(
              toolbarButton,
              "w-8 justify-center border-blue-600 bg-blue-600 px-0 text-white hover:border-blue-700 hover:bg-blue-700 hover:text-white dark:border-blue-700 dark:bg-blue-700 dark:hover:border-blue-800 dark:hover:bg-blue-800",
            )}
          >
            <SparklesIcon className="size-3.5" />
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
                  aria-label="显示搜索选项"
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
            </>
          }
        >
          <input
            ref={inputRef}
            value={draft}
            placeholder="搜索邮件"
            enterKeyHint="search"
            role="combobox"
            aria-label="搜索邮件"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen}
            aria-controls={suggestionsOpen ? suggestionListId : undefined}
            aria-activedescendant={
              highlightedIndex >= 0
                ? suggestionOptionId(suggestionListId, highlightedIndex)
                : undefined
            }
            // forms 插件会将未指定类型的输入框设为 1rem，因此这里必须
            // 明确尺寸，输入框才能与工具栏其他部分保持一致。
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
              // 邮件全局的 Escape 快捷键也会清除搜索，因此在此处处理的
              // 按键不应再传递给它。
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
              aria-label="清除搜索"
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

const toolbarButton =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
