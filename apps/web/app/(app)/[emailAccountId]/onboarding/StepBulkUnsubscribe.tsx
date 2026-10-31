"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { subDays } from "date-fns/subDays";
import { startOfDay } from "date-fns/startOfDay";
import { ArrowRightIcon, MailXIcon, SparklesIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { ButtonLoader } from "@/components/Loading";
import { Skeleton } from "@/components/ui/skeleton";
import { BulkUnsubscribeIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/BulkUnsubscribeIllustration";
import { UnsubscribeSuggestionRow } from "@/app/(app)/[emailAccountId]/onboarding/UnsubscribeSuggestionRow";
import {
  getUnsubscribeSuggestions,
  hasAutomaticUnsubscribeLink,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/suggestions";
import { useBulkUnsubscribe } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/hooks";
import type {
  NewsletterStatsQuery,
  NewsletterStatsResponse,
} from "@/app/api/user/stats/newsletters/route";
import { useAccount } from "@/providers/EmailAccountProvider";
import { usePremium } from "@/hooks/usePremium";
import { createSearchParams } from "@/utils/url";

type Newsletter = NewsletterStatsResponse["newsletters"][number];

const PREVIEW_COUNT = 5;
const SKELETON_ROW_KEYS = Array.from(
  { length: PREVIEW_COUNT },
  (_, index) => `skeleton-row-${index}`,
);

export function StepBulkUnsubscribe({ onNext }: { onNext: () => void }) {
  const { emailAccountId } = useAccount();
  const posthog = usePostHog();
  const { hasUnsubscribeAccess, mutate: refetchPremium } = usePremium();

  // 以天为边界的日期范围可让 SWR key 在多次挂载间保持稳定，
  // 因此重新访问此步骤（前进/后退）时会复用缓存结果。
  const fromDate = useMemo(() => +subDays(startOfDay(new Date()), 90), []);
  // 与批量退订页面的默认值保持一致：最近 3 个月、未处理的发件人、
  // 所有邮件类型，按邮件数量排序。
  const params: NewsletterStatsQuery = {
    types: [],
    filters: ["unhandled"],
    orderBy: "emails",
    orderDirection: "desc",
    limit: 50,
    includeMissingUnsubscribe: true,
    fromDate,
  };
  const urlParams = createSearchParams(params);
  const { data, isLoading, mutate } = useSWR<NewsletterStatsResponse>(
    emailAccountId
      ? [`/api/user/stats/newsletters?${urlParams}`, emailAccountId]
      : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    },
  );

  const lowReadSuggestions = useMemo(
    () => getUnsubscribeSuggestions(data?.newsletters ?? []),
    [data],
  );
  const suggestions = useMemo(
    () =>
      getUnsubscribeSuggestions(data?.newsletters ?? [], {
        requireAutomaticUnsubscribeLink: true,
      }),
    [data],
  );
  const previewSenders = useMemo(
    () => suggestions.slice(0, PREVIEW_COUNT),
    [suggestions],
  );
  const lowReadSuggestionsWithAutomaticUnsubscribe = useMemo(
    () => lowReadSuggestions.filter(hasAutomaticUnsubscribeLink).length,
    [lowReadSuggestions],
  );

  // 记录用户取消勾选了哪些预览发件人，这样选择状态无需 effect 来同步
  // 异步数据加载（所有预览项初始都为已选中）。
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const { onBulkUnsubscribe } = useBulkUnsubscribe<Newsletter>({
    hasUnsubscribeAccess,
    mutate,
    posthog,
    refetchPremium,
    emailAccountId,
    filter: "unhandled",
  });

  const selectedSenders = previewSenders.filter(
    (item) => !deselected.has(item.name),
  );

  // 记录（一次）用户实际看到建议列表的时机，以便衡量数据及时就绪的频率。
  const suggestionsShownRef = useRef(false);
  useEffect(() => {
    if (suggestionsShownRef.current) return;
    if (!previewSenders.length) return;
    suggestionsShownRef.current = true;
    posthog?.capture("onboarding_unsubscribe_suggestions_shown", {
      shownCount: previewSenders.length,
      totalSuggestions: suggestions.length,
      lowReadSuggestionCount: lowReadSuggestions.length,
      lowReadSuggestionWithAutomaticUnsubscribeCount:
        lowReadSuggestionsWithAutomaticUnsubscribe,
      lowReadSuggestionMissingAutomaticUnsubscribeCount:
        lowReadSuggestions.length - lowReadSuggestionsWithAutomaticUnsubscribe,
    });
  }, [
    previewSenders.length,
    suggestions.length,
    lowReadSuggestions.length,
    lowReadSuggestionsWithAutomaticUnsubscribe,
    posthog,
  ]);

  if (!emailAccountId) return null;

  // 保持列表的形状而非静态内容，这样当个性化版本到达时，屏幕不会在用户眼前突然切换。
  if (isLoading && !data) return <LoadingBulkUnsubscribeStep />;

  // 出错或没有可建议内容时，回退到静态营销内容——
  // 引导流程绝不能让用户觉得出了问题。
  if (!suggestions.length) {
    return <StaticBulkUnsubscribeStep onNext={onNext} />;
  }

  const onToggle = (name: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const onSkip = () => {
    posthog?.capture("onboarding_unsubscribe_skipped", {
      selectedCount: selectedSenders.length,
      totalSuggestions: suggestions.length,
    });
    onNext();
  };

  const onUnsubscribeSelected = async () => {
    if (!selectedSenders.length) {
      onSkip();
      return;
    }

    posthog?.capture("onboarding_unsubscribe_cta_clicked", {
      selectedCount: selectedSenders.length,
      totalSuggestions: suggestions.length,
      hasUnsubscribeAccess,
    });

    posthog?.capture("onboarding_unsubscribe_clicked", {
      count: selectedSenders.length,
      totalSuggestions: suggestions.length,
    });

    setSubmitting(true);
    try {
      await onBulkUnsubscribe(selectedSenders);
    } finally {
      setSubmitting(false);
      onNext();
    }
  };

  const hasMore = suggestions.length > previewSenders.length;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 dark:bg-background px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <PageHeading className="mb-3">
            我们发现你很少阅读的 {suggestions.length} 个发件人
          </PageHeading>
          <TypographyP className="text-muted-foreground">
            我们会为你退订并归档这些发件人。取消勾选任何你想保留的项。
          </TypographyP>
        </div>

        <section
          aria-label="你很少阅读的发件人"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <ul className="divide-y divide-slate-100 dark:divide-border py-1.5">
            {previewSenders.map((item) => (
              <UnsubscribeSuggestionRow
                key={item.name}
                sender={item}
                checked={!deselected.has(item.name)}
                onToggle={() => onToggle(item.name)}
                className="px-4 py-2.5"
              />
            ))}
          </ul>
        </section>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
          <SparklesIcon className="size-3.5 text-amber-500" />
          {hasMore
            ? `显示你的前 ${previewSenders.length} 个。随着你使用 Inbox Zero，我们会继续发现更多。`
            : "随着你使用 Inbox Zero，我们会继续发现更多。"}
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          <Button
            size="lg"
            className="w-full max-w-xs"
            onClick={onUnsubscribeSelected}
            disabled={submitting}
          >
            {submitting && <ButtonLoader />}
            {selectedSenders.length > 0 ? (
              <>
                <MailXIcon className="size-4 mr-2" />
                退订 {selectedSenders.length} 个
              </>
            ) : (
              <>
                继续
                <ArrowRightIcon className="size-4 ml-2" />
              </>
            )}
          </Button>
          {selectedSenders.length > 0 && (
            <Button
              variant="link"
              size="sm"
              onClick={onSkip}
              disabled={submitting}
            >
              暂时跳过
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingBulkUnsubscribeStep() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 dark:bg-background px-4 py-10">
      <output className="w-full max-w-xl" aria-label="正在加载发件人">
        <div className="mb-6 flex flex-col items-center">
          <Skeleton className="mb-3 h-8 w-80 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <ul className="divide-y divide-slate-100 dark:divide-border py-1.5">
            {SKELETON_ROW_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="size-5 shrink-0 rounded-md" />
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32 max-w-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="hidden h-1.5 w-16 shrink-0 sm:block" />
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-7 flex justify-center">
          <Skeleton className="h-11 w-full max-w-xs rounded-md" />
        </div>
      </output>
    </div>
  );
}

function StaticBulkUnsubscribeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 dark:bg-background px-4 py-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="mb-6 h-[240px] flex items-end justify-center">
          <BulkUnsubscribeIllustration />
        </div>

        <PageHeading className="mb-3">批量退订并归档</PageHeading>

        <TypographyP className="text-muted-foreground mb-8">
          查看你从未阅读的邮件。一键批量退订并归档。
        </TypographyP>

        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Button className="w-full" onClick={onNext}>
            继续
            <ArrowRightIcon className="size-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
