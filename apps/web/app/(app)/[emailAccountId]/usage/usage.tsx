"use client";

import { BotIcon, CoinsIcon, CpuIcon } from "lucide-react";
import { formatStat } from "@/utils/stats";
import { StatsCards } from "@/components/StatsCards";
import { usePremium } from "@/hooks/usePremium";
import { LoadingContent } from "@/components/LoadingContent";
import { env } from "@/env";
import { isPremiumRecord } from "@/utils/premium";
import type { RedisUsage } from "@/utils/redis/usage";

export function Usage(props: { usage: RedisUsage | null }) {
  const { premium, unsubscribeCreditsRemaining, isLoading, error } =
    usePremium();

  return (
    <LoadingContent loading={isLoading} error={error}>
      <StatsCards
        stats={[
          {
            name: "退订额度",
            value: isPremiumRecord(premium)
              ? "无限制"
              : formatStat(
                  unsubscribeCreditsRemaining ??
                    env.NEXT_PUBLIC_FREE_UNSUBSCRIBE_CREDITS,
                ),
            subvalue: "额度",
            icon: <CoinsIcon className="h-4 w-4" />,
          },
          {
            name: "LLM API 调用",
            value: formatStat(props.usage?.calls),
            subvalue: "次调用",
            icon: <BotIcon className="h-4 w-4" />,
          },
          {
            name: "已用 LLM Token",
            value: formatStat(props.usage?.tokensUsed),
            subvalue: "Token",
            icon: <CpuIcon className="h-4 w-4" />,
          },
        ]}
      />
    </LoadingContent>
  );
}
