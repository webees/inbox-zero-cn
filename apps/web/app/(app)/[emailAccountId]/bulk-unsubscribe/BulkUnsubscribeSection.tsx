"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { subDays } from "date-fns/subDays";
import { ChevronDown } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  HistoryIcon,
  InboxIcon,
  ListIcon,
  Loader2Icon,
  MailXIcon,
  SparklesIcon,
  ThumbsUpIcon,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { LoadingContent } from "@/components/LoadingContent";
import type {
  NewsletterStatsQuery,
  NewsletterStatsResponse,
} from "@/app/api/user/stats/newsletters/route";
import { getDateRangeParams } from "@/app/(app)/[emailAccountId]/stats/params";
import { useEmailsToIncludeFilter } from "@/app/(app)/[emailAccountId]/stats/EmailsToIncludeFilter";
import { usePremium } from "@/hooks/usePremium";
import {
  useArchiveOnUnsubscribe,
  useNewsletterFilter,
  useBulkUnsubscribeShortcuts,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/hooks";
import { SenderPanel } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/SenderPanel";
import { createSearchParams } from "@/utils/url";
import type { NewsletterFilterType } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/types";
import {
  getSuggestedModeRows,
  isUnsubscribeSuggestion,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/suggestions";
import { getUserFacingUnsubscribeLink } from "@/utils/parse/unsubscribe";
import { useStatLoader } from "@/providers/StatLoaderProvider";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { useLabels } from "@/hooks/useLabels";
import {
  BulkUnsubscribeDesktop,
  BulkUnsubscribeRowDesktop,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkUnsubscribeDesktop";
import { BulkUnsubscribeDesktopSkeleton } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkUnsubscribeSkeleton";
import { Card } from "@/components/ui/card";
import { SearchBar } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/SearchBar";
import { useToggleSelect } from "@/hooks/useToggleSelect";
import { BulkActions } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkActions";
import { ArchiveProgress } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/ArchiveProgress";
import { ClientOnly } from "@/components/ClientOnly";
import { useAccount } from "@/providers/EmailAccountProvider";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { TextLink } from "@/components/Typography";
import { DismissibleVideoCard } from "@/components/VideoCard";
import { DatePickerWithRange } from "@/components/DatePickerWithRange";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Newsletter = NewsletterStatsResponse["newsletters"][number];

const filterOptions: {
  label: string;
  value: NewsletterFilterType;
  icon: React.ReactNode;
  separatorAfter?: boolean;
}[] = [
  {
    label: "待审核",
    value: "unhandled",
    icon: <InboxIcon className="size-4" />,
  },
  {
    label: "所有发件人",
    value: "all",
    icon: <ListIcon className="size-4" />,
    separatorAfter: true,
  },
  {
    label: "已退订",
    value: "unsubscribed",
    icon: <MailXIcon className="size-4" />,
  },
  {
    label: "已自动归档",
    value: "autoArchived",
    icon: <ArchiveIcon className="size-4" />,
  },
  {
    label: "已保留",
    value: "approved",
    icon: <ThumbsUpIcon className="size-4" />,
  },
];

const selectOptions = [
  { label: "上周", value: "7" },
  { label: "上个月", value: "30" },
  { label: "最近 3 个月", value: "90" },
  { label: "去年", value: "365" },
  { label: "全部", value: "0" },
];
const defaultSelected = selectOptions[2];

export function BulkUnsubscribe() {
  const [dateDropdown, setDateDropdown] = useState<string>(
    defaultSelected.label,
  );

  const now = useMemo(() => new Date(), []);

  const onSetDateDropdown = useCallback(
    (option: { label: string; value: string }) => {
      const { label, value } = option;
      setDateDropdown(label);
      // 选择“全部”（值 "0"）时，将 dateRange 设为 undefined 以跳过日期过滤
      if (value === "0") {
        setDateRange(undefined);
      } else {
        setDateRange({
          from: subDays(now, Number.parseInt(value)),
          to: now,
        });
      }
    },
    [now],
  );

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(now, Number.parseInt(defaultSelected.value)),
    to: now,
  });

  const { isLoading: isStatsLoaderLoading, onLoad } = useStatLoader();
  const refreshInterval = isStatsLoaderLoading ? 5000 : 1_000_000;
  useEffect(() => {
    onLoad({ loadBefore: false, showToast: false });
  }, [onLoad]);

  const { emailAccountId, userEmail } = useAccount();

  const [sortColumn, setSortColumn] = useState<
    "emails" | "unread" | "unarchived"
  >("emails");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = useCallback(
    (column: "emails" | "unread" | "unarchived") => {
      if (sortColumn === column) {
        // 点击同一列时切换方向
        setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      } else {
        // 设置新列并采用默认的降序方向
        setSortColumn(column);
        setSortDirection("desc");
      }
    },
    [sortColumn],
  );

  const { typesArray } = useEmailsToIncludeFilter();
  const { filtersArray, filter, setFilter } = useNewsletterFilter();
  const posthog = usePostHog();

  const [search, setSearch] = useState("");

  const [expanded, setExpanded] = useState(false);

  const params: NewsletterStatsQuery = {
    types: typesArray,
    filters: filtersArray,
    orderBy: sortColumn,
    orderDirection: sortDirection,
    limit: expanded ? 500 : 50,
    includeMissingUnsubscribe: true,
    ...getDateRangeParams(dateRange),
    ...(search ? { search } : {}),
  };
  const urlParams = createSearchParams(params);
  const { data, isLoading, isValidating, error, mutate } = useSWR<
    NewsletterStatsResponse,
    { error: string }
  >(`/api/user/stats/newsletters?${urlParams}`, {
    refreshInterval,
    keepPreviousData: true,
  });

  // 跟踪是否正在切换视图（过滤器、排序、搜索、日期范围、展开）
  // 仅在用不同参数校验时显示骨架屏，后台刷新时不显示
  const [lastFetchedParams, setLastFetchedParams] = useState<string>("");
  const currentParamsString = urlParams.toString();
  const isParamsChanged = lastFetchedParams !== currentParamsString;
  const showSkeleton = isValidating && isParamsChanged;

  // 新参数的数据到达时更新 lastFetchedParams
  useEffect(() => {
    if (!isValidating && data) {
      setLastFetchedParams(currentParamsString);
    }
  }, [isValidating, data, currentParamsString]);

  const { hasUnsubscribeAccess, mutate: refetchPremium } = usePremium();

  const [includeWithoutUnsubscribeLink, setIncludeWithoutUnsubscribeLink] =
    useState(false);
  const [archiveOnUnsubscribe, setArchiveOnUnsubscribe] =
    useArchiveOnUnsubscribe();

  // 数据由后端过滤、排序和限制。只能屏蔽的发件人在未主动请求前会从待审核中隐藏。
  const rows = useMemo(
    () =>
      filter === "unhandled" && !includeWithoutUnsubscribeLink
        ? data?.newsletters.filter((item) =>
            getUserFacingUnsubscribeLink({
              unsubscribeLink: item.unsubscribeLink,
            }),
          )
        : data?.newsletters,
    [data?.newsletters, filter, includeWithoutUnsubscribeLink],
  );

  // 从行数据派生，使面板能反映状态变化，并在发件人离开当前视图后关闭。
  const [openedNewsletterName, setOpenedNewsletterName] = useState<string>();
  const openedNewsletter = rows?.find(
    (row) => row.name === openedNewsletterName,
  );

  const onOpenNewsletter = (newsletter: Newsletter) => {
    setOpenedNewsletterName(newsletter.name);
    posthog?.capture("Clicked Expand Sender");
  };

  const [selectedRow, setSelectedRow] = useState<Newsletter | undefined>();

  useBulkUnsubscribeShortcuts({
    newsletters: rows,
    // 面板有自己的邮件快捷键；行级的按键不应在其后方生效。
    selectedRow: openedNewsletter ? undefined : selectedRow,
    onOpenNewsletter,
    setSelectedRow,
    refetchPremium,
    hasUnsubscribeAccess,
    mutate,
    userEmail,
    emailAccountId,
  });

  const { isLoading: isStatsLoading } = useStatLoader();

  const { userLabels } = useLabels();

  const { PremiumModal, openModal } = usePremiumModal();

  const [isSuggestedMode, setIsSuggestedMode] = useState(false);

  const {
    selected,
    onToggleSelect,
    onToggleSelectItems,
    selectItems,
    clearSelection,
    deselectItem,
  } = useToggleSelect(rows?.map((item) => ({ id: item.name })) || []);

  const suggestedRows = useMemo(
    () => rows?.filter(isUnsubscribeSuggestion) ?? [],
    [rows],
  );

  const visibleRows = useMemo(
    () =>
      isSuggestedMode
        ? getSuggestedModeRows(rows ?? [], selected)
        : (rows ?? []),
    [isSuggestedMode, rows, selected],
  );
  const visibleRowIds = useMemo(
    () => visibleRows.map((row) => row.name),
    [visibleRows],
  );
  const isAllVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => selected.get(row.name));
  const isSomeVisibleSelected = visibleRows.some((row) =>
    selected.get(row.name),
  );

  const onToggleSuggestedMode = useCallback(() => {
    if (isSuggestedMode) {
      setIsSuggestedMode(false);
      return;
    }

    selectItems(suggestedRows.map((row) => row.name));
    setIsSuggestedMode(true);
    posthog?.capture("Clicked Select Suggested Unsubscribes", {
      count: suggestedRows.length,
    });
  }, [isSuggestedMode, selectItems, suggestedRows, posthog]);

  const onToggleVisibleRow = useCallback(
    (id: string, shiftKey = false) =>
      onToggleSelect(id, shiftKey, visibleRowIds),
    [onToggleSelect, visibleRowIds],
  );

  const onToggleSelectAllVisible = useCallback(
    () => onToggleSelectItems(visibleRowIds),
    [onToggleSelectItems, visibleRowIds],
  );

  // 过滤器变化时清除选择
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clearing selection when filter changes
  useEffect(() => {
    clearSelection();
    setIsSuggestedMode(false);
  }, [filter]);

  // 深层链接（例如来自收件箱健康度邮件或引导流程）：
  // ?select=suggested 会在首次加载行数据后自动选择一次建议行，
  // 随后移除该参数，以免重新渲染和过滤器变化时再次选择。
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hasAppliedSelectParamRef = useRef(false);

  useEffect(() => {
    if (hasAppliedSelectParamRef.current) return;
    if (searchParams.get("select") !== "suggested") return;
    if (!rows) return;

    hasAppliedSelectParamRef.current = true;
    selectItems(rows.filter(isUnsubscribeSuggestion).map((row) => row.name));
    setIsSuggestedMode(true);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("select");
    router.replace(nextParams.size ? `${pathname}?${nextParams}` : pathname, {
      scroll: false,
    });
  }, [searchParams, rows, selectItems, router, pathname]);

  // 排序现在由后端处理，所以我们只需按顺序映射行数据
  const tableRows = visibleRows.map((item) => {
    const readPercentage =
      item.value > 0 ? (item.readEmails / item.value) * 100 : 0;

    return (
      <BulkUnsubscribeRowDesktop
        key={item.name}
        item={item}
        userEmail={userEmail}
        emailAccountId={emailAccountId}
        onOpenNewsletter={onOpenNewsletter}
        labels={userLabels}
        mutate={mutate}
        selected={selectedRow?.name === item.name}
        onSelectRow={() => setSelectedRow(item)}
        hasUnsubscribeAccess={hasUnsubscribeAccess}
        refetchPremium={refetchPremium}
        openPremiumModal={openModal}
        checked={selected.get(item.name) || false}
        onToggleSelect={onToggleVisibleRow}
        readPercentage={readPercentage}
        filter={filter}
      />
    );
  });

  const selectedFilter = filterOptions.find((opt) => opt.value === filter);

  return (
    <PageWrapper>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="批量退订"
          video={{
            title: "批量退订入门",
            description: (
              <>
                了解如何快速批量退订并归档不需要的邮件。你可以在我们的{" "}
                <TextLink
                  href="https://docs.getinboxzero.com/essentials/bulk-email-unsubscriber"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  帮助中心
                </TextLink>
                .
              </>
            ),
            muxPlaybackId: "qxP8P5aKm7k7I01seCEMP1ZepHQAmdKCcW02x1fM7xQm00",
          }}
        />
        <ScanOlderEmailsButton />
      </div>

      <DismissibleVideoCard
        className="my-4"
        icon={<ArchiveIcon className="size-5" />}
        title="批量退订入门"
        description={"了解如何使用批量退订来退订并归档不需要的邮件。"}
        muxPlaybackId="qxP8P5aKm7k7I01seCEMP1ZepHQAmdKCcW02x1fM7xQm00"
        storageKey="bulk-unsubscribe-onboarding-video"
        videoAnalytics={{
          page: "bulk_unsubscribe",
          surface: "dismissible_card",
        }}
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full justify-between sm:w-auto"
            >
              <span className="flex items-center">
                {selectedFilter?.icon}
                <span className="ml-2">{selectedFilter?.label ?? "All"}</span>
              </span>
              <ChevronDown className="ml-2 h-4 w-4 text-gray-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[320px]">
            {filterOptions.map((option) => (
              <div key={option.value}>
                <DropdownMenuItem
                  onClick={() => setFilter(option.value)}
                  className="flex items-center justify-between"
                >
                  <span className="flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                  {filter === option.value && (
                    <CheckIcon className="h-4 w-4 text-primary" />
                  )}
                </DropdownMenuItem>
                {option.separatorAfter && <DropdownMenuSeparator />}
              </div>
            ))}
            {filter === "unhandled" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={includeWithoutUnsubscribeLink}
                  onCheckedChange={(checked) => {
                    setIncludeWithoutUnsubscribeLink(checked);
                    clearSelection();
                  }}
                  onSelect={(event) => event.preventDefault()}
                >
                  包含没有退订链接的发件人
                </DropdownMenuCheckboxItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DatePickerWithRange
          dateRange={dateRange}
          onSetDateRange={setDateRange}
          selectOptions={selectOptions}
          dateDropdown={dateDropdown}
          onSetDateDropdown={onSetDateDropdown}
          className="w-full min-w-0 sm:w-auto sm:min-w-52"
        />
        <SearchBar onSearch={setSearch} className="col-span-2 sm:w-60" />
        {(suggestedRows.length > 0 || isSuggestedMode) && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isSuggestedMode ? "secondary" : "outline"}
                  size="sm"
                  className="col-span-2 h-10 w-full sm:w-auto"
                  aria-pressed={isSuggestedMode}
                  onClick={onToggleSuggestedMode}
                >
                  <SparklesIcon className="size-4 text-amber-500" />
                  <span className="ml-2">
                    {isSuggestedMode ? "已显示" : "选择"} {suggestedRows.length}{" "}
                    条建议
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  {isSuggestedMode
                    ? "点击显示所有发件人"
                    : "你经常收到其邮件却很少打开的发件人"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="col-span-2 flex h-10 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground sm:ml-auto">
              <Switch
                id="archive-on-unsubscribe"
                size="sm"
                checked={archiveOnUnsubscribe}
                onCheckedChange={setArchiveOnUnsubscribe}
              />
              <label
                htmlFor="archive-on-unsubscribe"
                className="cursor-pointer select-none"
              >
                退订时归档
              </label>
            </div>
          </TooltipTrigger>
          <TooltipContent>退订时也归档现有邮件</TooltipContent>
        </Tooltip>
      </div>

      <ClientOnly>
        <ArchiveProgress />
      </ClientOnly>

      <Card className="mt-2 md:mt-4 max-sm:border-0 max-sm:shadow-none">
        {(isStatsLoading && !isLoading && !data?.newsletters.length) ||
        showSkeleton ? (
          <BulkUnsubscribeDesktopSkeleton />
        ) : (
          <LoadingContent
            loading={!data && isLoading}
            error={error}
            loadingComponent={<BulkUnsubscribeDesktopSkeleton />}
          >
            {tableRows?.length ? (
              <BulkUnsubscribeDesktop
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
                tableRows={tableRows}
                isAllSelected={isAllVisibleSelected}
                isSomeSelected={isSomeVisibleSelected}
                onToggleSelectAll={onToggleSelectAllVisible}
              />
            ) : (
              <EmptyState
                isReviewView={filter === "unhandled" && !search}
                onlyLinklessLeft={
                  filter === "unhandled" &&
                  !includeWithoutUnsubscribeLink &&
                  !!data?.newsletters.length
                }
                onIncludeLinkless={() => setIncludeWithoutUnsubscribeLink(true)}
              />
            )}
            {/* 仅当可能有更多结果时才显示展开/收起 */}
            {(expanded ||
              (data?.newsletters && data.newsletters.length >= 50)) && (
              <div className="mt-2 px-6 pb-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExpanded(!expanded)}
                  className="w-full"
                >
                  {expanded ? (
                    <>
                      <ChevronsUpIcon className="h-4 w-4" />
                      <span className="ml-2">收起</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownIcon className="h-4 w-4" />
                      <span className="ml-2">展开</span>
                    </>
                  )}
                </Button>
              </div>
            )}
          </LoadingContent>
        )}
      </Card>
      <BulkActions
        selected={selected}
        mutate={mutate}
        onClearSelection={clearSelection}
        deselectItem={deselectItem}
        newsletters={rows}
        filter={filter}
        dateRange={dateRange}
      />
      <SenderPanel
        newsletter={openedNewsletter}
        onClose={() => setOpenedNewsletterName(undefined)}
        refreshInterval={refreshInterval}
        mutate={mutate}
        hasUnsubscribeAccess={hasUnsubscribeAccess}
        refetchPremium={refetchPremium}
        openPremiumModal={openModal}
        filter={filter}
      />
      <PremiumModal />
    </PageWrapper>
  );
}

function ScanOlderEmailsButton() {
  const { isLoading, onLoadBatch } = useStatLoader();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => onLoadBatch({ loadBefore: true, showToast: true })}
          disabled={isLoading}
          aria-label="扫描更早的邮件"
        >
          {isLoading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <HistoryIcon className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isLoading ? "正在扫描更早的邮件…" : "扫描更早的邮件"}
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({
  isReviewView,
  onlyLinklessLeft,
  onIncludeLinkless,
}: {
  isReviewView: boolean;
  onlyLinklessLeft: boolean;
  onIncludeLinkless: () => void;
}) {
  if (onlyLinklessLeft) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-14">
        <h3 className="font-title text-xl font-medium">
          只剩下没有退订链接的发件人
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onIncludeLinkless}
        >
          显示它们
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-14">
      <h3 className="font-title text-xl font-medium">
        {isReviewView ? "没有待审核的内容" : "未找到发件人"}
      </h3>
      <p className="mt-1.5 text-center text-sm text-muted-foreground">
        {isReviewView
          ? "新发件人到达后会显示在这里。"
          : "试试其他过滤器或日期范围。"}
      </p>
    </div>
  );
}
