"use client";

import Link from "next/link";
import { CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/hooks/usePremium";
import { Tooltip } from "@/components/Tooltip";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import type { PremiumTier } from "@/generated/prisma/enums";
import { starterTierName } from "@/app/(app)/premium/config";
import { ActionCard } from "@/components/ui/card";
import { EndTrialButton } from "@/components/EndTrialButton";
import { isActivePremium } from "@/utils/premium";

export function PremiumAiAssistantAlert({
  showSetApiKey,
  className,
  tier,
  stripeSubscriptionStatus,
  activeOnly,
}: {
  showSetApiKey: boolean;
  className?: string;
  tier?: PremiumTier | null;
  stripeSubscriptionStatus?: string | null;
  activeOnly?: boolean;
}) {
  const { PremiumModal, openModal } = usePremiumModal();

  const isBasicPlan = tier === "BASIC_MONTHLY" || tier === "BASIC_ANNUALLY";

  if (activeOnly && stripeSubscriptionStatus === "trialing") {
    return (
      <div className={className}>
        <ActionCard
          icon={<CrownIcon className="h-5 w-5" />}
          title="需要有效订阅"
          description="此功能在免费试用期间不可用。请开始付费套餐后使用。"
          action={<EndTrialButton variant="primaryBlack" />}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      {isBasicPlan ? (
        <ActionCard
          icon={<CrownIcon className="h-5 w-5" />}
          title={`需要 ${starterTierName} 套餐`}
          description={`切换到 ${starterTierName} 套餐以使用此功能。`}
          action={
            <Button variant="primaryBlack" onClick={openModal}>
              切换套餐
            </Button>
          }
        />
      ) : showSetApiKey ? (
        <ActionCard
          icon={<CrownIcon className="h-5 w-5" />}
          title="需要 API 密钥"
          description="你需要设置 AI API 密钥才能使用此功能。"
          action={
            <Button variant="primaryBlack" asChild>
              <Link href="/settings">设置 API 密钥</Link>
            </Button>
          }
        />
      ) : (
        <ActionCard
          icon={<CrownIcon className="h-5 w-5" />}
          title="高级版功能"
          description={`这是高级版功能。请升级到 ${starterTierName} 套餐。`}
          action={
            <Button variant="primaryBlack" onClick={openModal}>
              升级
            </Button>
          }
        />
      )}
      <PremiumModal />
    </div>
  );
}

export function PremiumAlertWithData({
  className,
  activeOnly,
}: {
  className?: string;
  activeOnly?: boolean;
}) {
  const {
    hasAiAccess,
    isLoading: isLoadingPremium,
    isProPlanWithoutApiKey,
    tier,
    premium,
  } = usePremium();

  const needsActiveSubscription = activeOnly && !isActivePremium(premium);

  if (!isLoadingPremium && (!hasAiAccess || needsActiveSubscription)) {
    return (
      <PremiumAiAssistantAlert
        showSetApiKey={isProPlanWithoutApiKey}
        className={className}
        tier={tier}
        stripeSubscriptionStatus={premium?.stripeSubscriptionStatus || null}
        activeOnly={activeOnly}
      />
    );
  }

  return null;
}

export function PremiumTooltip(props: {
  children: React.ReactElement;
  showTooltip: boolean;
  openModal: () => void;
}) {
  if (!props.showTooltip) return props.children;

  return (
    <Tooltip
      contentComponent={<PremiumTooltipContent openModal={props.openModal} />}
    >
      <span>{props.children}</span>
    </Tooltip>
  );
}

export function PremiumTooltipContent({
  openModal,
}: {
  openModal: () => void;
}) {
  return (
    <div className="text-center">
      <p>你已达到免费版上限 🥺</p>
      <p>升级以解锁完整访问权限。</p>
      <Button className="mt-1" onClick={openModal} size="xs">
        升级
      </Button>
    </div>
  );
}
