"use client";

import Link from "next/link";
import { Trans, useLingui } from "@lingui/react/macro";
import { env } from "@/env";
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
  const { t } = useLingui();
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
          prefix: t`Failed to update invoice emails`,
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
            <ItemTitle>
              <Trans>{getPremiumTierName(tier)} 套餐</Trans>
            </ItemTitle>
            {hasAppleSubscription ? (
              <ItemDescription>
                <Trans>
                  此订阅通过 Apple 计费。请在 iPhone 或 iPad 的订阅设置中管理或
                  取消。
                </Trans>
              </ItemDescription>
            ) : isLegacyStripePlan ? (
              <ItemDescription>
                <Trans>
                  你使用的是旧版 Stripe 价格。应用其他位置显示的当前套餐价格
                  适用于新订阅。
                </Trans>
              </ItemDescription>
            ) : premium.stripeSubscriptionStatus === "trialing" ? (
              <ItemDescription>
                <Trans>免费试用</Trans>
              </ItemDescription>
            ) : null}
          </ItemContent>
          <ItemActions className="flex-wrap justify-end">
            {!hasAppleSubscription && (
              <Button asChild variant="outline" size="sm">
                <Link href="/premium">
                  <Trans>更改套餐</Trans>
                </Link>
              </Button>
            )}
            <ManageSubscription premium={premium} compact />
            {!premium.stripeSubscriptionId &&
              !premium.lemonSqueezyCustomerId && (
                <ViewInvoicesButton premium={premium} />
              )}
          </ItemActions>
        </Item>
      ) : premium?.stripeSubscriptionStatus === "paused" ? (
        <Item size="sm">
          <ItemContent>
            <ItemTitle>
              <Trans>{getPremiumTierName(premium.tier)} 套餐</Trans>
            </ItemTitle>
            {/* Customers can't pause or resume in the Stripe portal, so a
                paused subscription is resumed by support. */}
            <ItemDescription>
              <Trans>
                已暂停。请联系{" "}
                <a
                  href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}
                  className="underline"
                >
                  {env.NEXT_PUBLIC_SUPPORT_EMAIL}
                </a>{" "}
                以恢复订阅。
              </Trans>
            </ItemDescription>
          </ItemContent>
          <ItemActions className="flex-wrap justify-end">
            <ManageSubscription premium={premium} compact />
          </ItemActions>
        </Item>
      ) : (
        <Item size="sm">
          <ItemContent>
            <ItemTitle>
              <Trans>无有效套餐</Trans>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            {premium && <ViewInvoicesButton premium={premium} />}
            <Button asChild variant="outline" size="sm">
              <Link href="/premium">
                <Trans>升级</Trans>
              </Link>
            </Button>
          </ItemActions>
        </Item>
      )}

      {premium?.stripeCustomerId && (
        <>
          <ItemSeparator />
          <Item size="sm">
            <ItemContent>
              <ItemTitle>
                <Trans>通过邮件发送已付发票</Trans>
              </ItemTitle>
              <ItemDescription>
                <Trans>自动将每张 Stripe 发票发送至账单邮箱。</Trans>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={t`通过邮件发送已付的 Stripe 发票`}
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
