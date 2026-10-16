"use client";

import useSWRInfinite from "swr/infinite";
import { useMemo, useCallback } from "react";
import { ChevronsDownIcon, SparklesIcon, StopCircleIcon } from "lucide-react";
import { ClientOnly } from "@/components/ClientOnly";
import { SendersTable } from "@/components/GroupedTable";
import { LoadingContent } from "@/components/LoadingContent";
import { Button } from "@/components/ui/button";
import type { UncategorizedSendersResponse } from "@/app/api/user/categorize/senders/uncategorized/route";
import { TopBar } from "@/components/TopBar";
import { toastError } from "@/components/Toast";
import {
  useHasProcessingItems,
  pushToAiCategorizeSenderQueueAtom,
  stopAiCategorizeSenderQueue,
} from "@/store/ai-categorize-sender-queue";
import { SectionDescription } from "@/components/Typography";
import { ButtonLoader } from "@/components/Loading";
import { PremiumTooltip } from "@/components/PremiumAlert";
import { usePremium } from "@/hooks/usePremium";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { Toggle } from "@/components/Toggle";
import { setAutoCategorizeAction } from "@/utils/actions/categorize";
import { TooltipExplanation } from "@/components/TooltipExplanation";
import type { CategoryWithRules } from "@/utils/category.server";
import { useAccount } from "@/providers/EmailAccountProvider";

export function Uncategorized({
  categories,
  autoCategorizeSenders,
}: {
  categories: CategoryWithRules[];
  autoCategorizeSenders: boolean;
}) {
  const { hasAiAccess } = usePremium();
  const { PremiumModal, openModal: openPremiumModal } = usePremiumModal();

  const { data: senderAddresses, loadMore, isLoading, hasMore } = useSenders();
  const hasProcessingItems = useHasProcessingItems();

  const senders = useMemo(
    () =>
      senderAddresses?.map((sender) => ({
        address: sender.email,
        name: sender.name,
        category: null,
      })),
    [senderAddresses],
  );

  const { emailAccountId } = useAccount();

  return (
    <LoadingContent loading={!senderAddresses && isLoading}>
      <TopBar>
        <div className="flex gap-2">
          <PremiumTooltip
            showTooltip={!hasAiAccess}
            openModal={openPremiumModal}
          >
            <Button
              loading={hasProcessingItems}
              disabled={!hasAiAccess}
              onClick={async () => {
                if (!senderAddresses?.length) {
                  toastError({ description: "没有可分类的发件人" });
                  return;
                }

                pushToAiCategorizeSenderQueueAtom({
                  pushIds: senderAddresses.map((s) => s.email),
                  emailAccountId,
                });
              }}
            >
              <SparklesIcon className="mr-2 size-4" />用 AI 分类全部
            </Button>
          </PremiumTooltip>

          {hasProcessingItems && (
            <Button
              variant="outline"
              onClick={() => {
                stopAiCategorizeSenderQueue();
              }}
            >
              <StopCircleIcon className="mr-2 size-4" />
              停止
            </Button>
          )}
        </div>

        <div className="flex items-center">
          <div className="mr-1.5">
            <TooltipExplanation
              size="sm"
              text="当新发件人给你发邮件时自动分类"
            />
          </div>
          <AutoCategorizeToggle
            autoCategorizeSenders={autoCategorizeSenders}
            emailAccountId={emailAccountId}
          />
        </div>
      </TopBar>
      <ClientOnly>
        {senders?.length ? (
          <>
            <SendersTable senders={senders} categories={categories} />
            {hasMore && (
              <Button
                variant="outline"
                className="mx-2 mb-4 mt-2 w-full"
                onClick={loadMore}
              >
                {isLoading ? (
                  <ButtonLoader />
                ) : (
                  <ChevronsDownIcon className="mr-2 size-4" />
                )}
                加载更多
              </Button>
            )}
          </>
        ) : (
          !isLoading && (
            <SectionDescription className="p-4">
              没有剩余的发件人需要分类！
            </SectionDescription>
          )
        )}
      </ClientOnly>
      <PremiumModal />
    </LoadingContent>
  );
}

function AutoCategorizeToggle({
  autoCategorizeSenders,
  emailAccountId,
}: {
  autoCategorizeSenders: boolean;
  emailAccountId: string;
}) {
  return (
    <Toggle
      name="autoCategorizeSenders"
      label="自动分类"
      enabled={autoCategorizeSenders}
      onChange={async (enabled) => {
        await setAutoCategorizeAction(emailAccountId, {
          autoCategorizeSenders: enabled,
        });
      }}
    />
  );
}

function useSenders() {
  const getKey = (
    pageIndex: number,
    previousPageData: UncategorizedSendersResponse | null,
  ) => {
    // 已到达末尾
    if (previousPageData && !previousPageData.nextOffset) return null;

    const baseUrl = "/api/user/categorize/senders/uncategorized";
    const offset = pageIndex === 0 ? 0 : previousPageData?.nextOffset;

    return `${baseUrl}?offset=${offset}`;
  };

  const { data, size, setSize, isLoading } =
    useSWRInfinite<UncategorizedSendersResponse>(getKey, {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
      persistSize: true,
      revalidateOnMount: true,
    });

  const loadMore = useCallback(() => {
    setSize(size + 1);
  }, [setSize, size]);

  // 合并所有页面中的发件人
  const allSenders = useMemo(
    () => data?.flatMap((page) => page.uncategorizedSenders),
    [data],
  );

  // 通过查看最后一页来判断是否还有更多数据可加载
  const hasMore = !!data?.[data.length - 1]?.nextOffset;

  return {
    data: allSenders,
    loadMore,
    isLoading,
    hasMore,
  };
}
