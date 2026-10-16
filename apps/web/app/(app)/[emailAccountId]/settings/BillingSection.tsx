"use client";

import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { usePremium } from "@/hooks/usePremium";
import {
  ManageSubscription,
  ViewInvoicesButton,
} from "@/app/(app)/premium/ManageSubscription";
import { LoadingContent } from "@/components/LoadingContent";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toastError } from "@/components/Toast";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import {
  getPremiumTierName,
  shouldShowLegacyStripePricingNotice,
} from "@/app/(app)/premium/config";
import { hasActiveAppleSubscription } from "@/utils/premium";
import { getActionErrorMessage } from "@/utils/error";
import { updateStripeInvoiceEmailsAction } from "@/utils/actions/premium";

export function BillingSection() {
  const {
    data,
    premium,
    isPremium,
    isLoading,
    tier,
    mutate,
    canManageBilling,
  } = usePremium();
  const isLegacyStripePlan = shouldShowLegacyStripePricingNotice(premium);
  const hasAppleSubscription = hasActiveAppleSubscription(
    premium?.appleExpiresAt || null,
    premium?.appleRevokedAt || null,
    premium?.appleSubscriptionStatus || null,
  );
  const { execute, isExecuting } = useAction(updateStripeInvoiceEmailsAction, {
    onError: (error) => {
      toastError({
        description: getActionErrorMessage(error.error, {
          prefix: "更新发票邮件失败",
        }),
      });
    },
    onSettled: () => {
      mutate();
    },
  });

  const handleInvoiceEmailToggle = (enabled: boolean) => {
    if (!data?.premium) return;

    mutate(
      {
        ...data,
        premium: {
          ...data.premium,
          stripeInvoiceEmailsEnabled: enabled,
        },
      },
      false,
    );
    execute({ enabled });
  };

  if (!canManageBilling) return null;

  return (
    <LoadingContent loading={isLoading}>
      {premium && isPremium ? (
        <Item size="sm">
          <ItemContent>
            <ItemTitle>{getPremiumTierName(tier)} 套餐</ItemTitle>
            {hasAppleSubscription ? (
              <ItemDescription>
                此订阅通过 Apple 计费。请在你的 iPhone 或 iPad
                订阅设置中管理或取消。
              </ItemDescription>
            ) : isLegacyStripePlan ? (
              <ItemDescription>
                你使用的是老用户 Stripe
                价格。应用其他地方显示的当前套餐价格适用于新订阅。
              </ItemDescription>
            ) : premium.stripeSubscriptionStatus === "trialing" ? (
              <ItemDescription>免费试用</ItemDescription>
            ) : null}
          </ItemContent>
          <ItemActions className="flex-wrap justify-end">
            {!hasAppleSubscription && (
              <Button asChild variant="outline" size="sm">
                <Link href="/premium">更换套餐</Link>
              </Button>
            )}
            <ManageSubscription premium={premium} compact />
            {!premium.stripeSubscriptionId &&
              !premium.lemonSqueezyCustomerId && (
                <ViewInvoicesButton premium={premium} />
              )}
          </ItemActions>
        </Item>
      ) : (
        <Item size="sm">
          <ItemContent>
            <ItemTitle>无有效套餐</ItemTitle>
          </ItemContent>
          <ItemActions>
            {premium && <ViewInvoicesButton premium={premium} />}
            <Button asChild variant="outline" size="sm">
              <Link href="/premium">升级</Link>
            </Button>
          </ItemActions>
        </Item>
      )}

      {premium?.stripeCustomerId && (
        <>
          <ItemSeparator />
          <Item size="sm">
            <ItemContent>
              <ItemTitle>通过邮件发送已付款发票</ItemTitle>
              <ItemDescription>
                自动将每张 Stripe 发票发送到账单邮箱。
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label="通过邮件发送已付款的 Stripe 发票"
                checked={premium.stripeInvoiceEmailsEnabled}
                disabled={isExecuting}
                onCheckedChange={handleInvoiceEmailToggle}
              />
            </ItemActions>
          </Item>
        </>
      )}
    </LoadingContent>
  );
}
