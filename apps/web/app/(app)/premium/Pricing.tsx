"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { CheckIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { env } from "@/env";
import { LoadingContent } from "@/components/LoadingContent";
import { usePremium } from "@/hooks/usePremium";
import { Button } from "@/components/ui/button";
import {
  PricingFrequencyToggle,
  frequencies,
  DiscountBadge,
  type Frequency,
} from "@/app/(app)/premium/PricingFrequencyToggle";
import { getUserTier, hasActiveAppleSubscription } from "@/utils/premium";
import {
  formatPrice,
  getExtraAccountPrice,
  getPremiumTierName,
  INCLUDED_EMAIL_ACCOUNTS_PER_PERSON,
  shouldShowLegacyStripePricingNotice,
  type Tier,
  tiers,
} from "@/app/(app)/premium/config";
import { AlertBasic } from "@/components/Alert";
import { TooltipExplanation } from "@/components/TooltipExplanation";
import { toastError } from "@/components/Toast";
import {
  generateCheckoutSessionAction,
  getBillingPortalUrlAction,
} from "@/utils/actions/premium";
import type { PremiumTier } from "@/generated/prisma/enums";
import { LoadingMiniSpinner } from "@/components/Loading";
import { cn } from "@/utils";
import { ManageSubscription } from "@/app/(app)/premium/ManageSubscription";
import { captureException } from "@/utils/error";
import { redirectToSafeUrl } from "@/utils/redirect";
import { TIER_MESSAGES } from "@/app/(app)/premium/config-messages";

export type PricingProps = {
  header?: React.ReactNode;
  showSkipUpgrade?: boolean;
  showGoToApp?: boolean;
  className?: string;
  displayTiers?: Tier[];
};

export default function Pricing(props: PricingProps) {
  const posthog = usePostHog();
  const { t } = useLingui();
  const { premium, isPremium, isLoading, error, data, canManageBilling } =
    usePremium();
  const hasTrackedPricingView = useRef(false);

  const isLoggedIn = !!data?.id;
  const pricingSource = props.showSkipUpgrade
    ? "welcome_upgrade"
    : "app_premium";
  const displayedTiers = props.displayTiers || tiers;
  const hasActiveAppleManagedSubscription = hasActiveAppleSubscription(
    premium?.appleExpiresAt || null,
    premium?.appleRevokedAt || null,
    premium?.appleSubscriptionStatus || null,
  );
  const hasExistingSubscription = Boolean(
    isPremium ||
      premium?.stripeSubscriptionId ||
      premium?.lemonSqueezyCustomerId ||
      hasActiveAppleManagedSubscription,
  );
  const isLegacyStripePlan = shouldShowLegacyStripePricingNotice(premium);
  const legacyTierName = getPremiumTierName(premium?.tier);

  const defaultFrequency = frequencies[1];
  const [chosenFrequency, setFrequency] = useState<
    (typeof frequencies)[number] | null
  >(null);
  const frequency = chosenFrequency ?? defaultFrequency;

  const userPremiumTier = getUserTier(premium);

  const header = props.header || (
    <div className="mb-12">
      <div className="mx-auto max-w-2xl text-center lg:max-w-4xl">
        <h2 className="font-title text-base leading-7 text-blue-600">
          <Trans>定价</Trans>
        </h2>
        <p className="mt-2 font-title text-4xl text-gray-900 sm:text-5xl">
          <Trans>免费试用，付费套餐价格实惠</Trans>
        </p>
      </div>
      <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-8 text-gray-600">
        <Trans>无隐藏费用，可随时取消。</Trans>
      </p>
    </div>
  );

  const router = useRouter();

  useEffect(() => {
    if (isLoading || hasTrackedPricingView.current) {
      return;
    }

    hasTrackedPricingView.current = true;
    posthog.capture("pricing_page_viewed", {
      source: pricingSource,
      isLoggedIn,
      hasExistingSubscription,
      showSkipUpgrade: Boolean(props.showSkipUpgrade),
      displayedTiers: displayedTiers.map((tier) => tier.name),
      frequency: frequency.value,
      defaultFrequency: defaultFrequency.value,
      frequencySource: chosenFrequency ? "user_selected" : "default",
    });
  }, [
    chosenFrequency,
    defaultFrequency.value,
    displayedTiers,
    frequency.value,
    hasExistingSubscription,
    isLoading,
    isLoggedIn,
    posthog,
    pricingSource,
    props.showSkipUpgrade,
  ]);

  if (isLoggedIn && !canManageBilling) {
    const isPlanManagedElsewhere =
      data?.billingAccessDenial === "plan_managed_elsewhere";
    const supportEmail = env.NEXT_PUBLIC_SUPPORT_EMAIL;

    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        {isPlanManagedElsewhere ? (
          <AlertBasic
            variant="blue"
            title={t`你的套餐由其他账号管理`}
            description={t`你的访问权限来自他人设置的套餐。如需自行管理账单，请联系 ${supportEmail}。`}
          />
        ) : (
          <AlertBasic
            variant="blue"
            title={t`账单访问受限`}
            description={t`只有组织所有者和管理员可以管理账单。`}
          />
        )}
      </div>
    );
  }

  return (
    <LoadingContent loading={isLoading} error={error}>
      <div
        id="pricing"
        className={cn(
          "relative isolate mx-auto max-w-7xl bg-white px-6 pt-6 sm:pt-10 lg:px-8",
          props.className,
        )}
      >
        {header}

        {hasExistingSubscription && (
          <div className="mb-8 mt-8 flex flex-wrap justify-center gap-2">
            <ManageSubscription premium={premium ?? null} />

            {/* Only pages without the app sidebar need a way back in. */}
            {userPremiumTier && props.showGoToApp && (
              <Button asChild>
                <Link href="/setup">
                  <SparklesIcon className="mr-2 h-4 w-4" />
                  <Trans>前往应用</Trans>
                </Link>
              </Button>
            )}

            {hasActiveAppleManagedSubscription && (
              <div className="mt-2 w-full max-w-2xl basis-full text-left">
                <AlertBasic
                  variant="blue"
                  title={t`由 App Store 管理`}
                  description={t`此订阅由 Apple 收费。如需变更或取消，请使用你的 iPhone 或 iPad 订阅设置。`}
                />
              </div>
            )}

            {isLegacyStripePlan && (
              <div className="mt-2 w-full max-w-2xl basis-full text-left">
                <AlertBasic
                  variant="blue"
                  title={t`保留原有定价`}
                  description={t`你使用的是旧版 ${legacyTierName} Stripe 套餐，价格保持不变。下方价格适用于新订阅。`}
                />
              </div>
            )}
          </div>
        )}

        <PricingFrequencyToggle
          frequency={frequency}
          setFrequency={(nextFrequency) => {
            posthog.capture("pricing_frequency_changed", {
              source: pricingSource,
              previousFrequency: frequency.value,
              frequency: nextFrequency.value,
              defaultFrequency: defaultFrequency.value,
            });
            setFrequency(nextFrequency);
          }}
        >
          <div className="ml-1">
            <DiscountBadge>
              <Trans>最高可省 20%</Trans>
            </DiscountBadge>
          </div>
        </PricingFrequencyToggle>

        <div
          className={cn(
            "isolate mx-auto mt-6 grid grid-cols-1 gap-y-8 gap-4 sm:mt-10",
            displayedTiers.length === 2
              ? "max-w-3xl lg:grid-cols-2"
              : "max-w-7xl lg:mx-0 lg:max-w-none lg:grid-cols-3",
          )}
        >
          {displayedTiers.map((tier) => (
            <PriceTier
              key={tier.name}
              tier={tier}
              userPremiumTier={userPremiumTier}
              frequency={frequency}
              defaultFrequency={defaultFrequency}
              frequencySource={chosenFrequency ? "user_selected" : "default"}
              stripeSubscriptionId={premium?.stripeSubscriptionId}
              stripeSubscriptionStatus={premium?.stripeSubscriptionStatus}
              hasActiveAppleManagedSubscription={
                hasActiveAppleManagedSubscription
              }
              isLoggedIn={isLoggedIn}
              router={router}
              userId={data?.id}
              pricingSource={pricingSource}
            />
          ))}
        </div>
      </div>
    </LoadingContent>
  );
}

function PriceTier({
  tier,
  userPremiumTier,
  frequency,
  defaultFrequency,
  frequencySource,
  stripeSubscriptionId,
  stripeSubscriptionStatus,
  hasActiveAppleManagedSubscription,
  isLoggedIn,
  router,
  userId,
  pricingSource,
}: {
  tier: Tier;
  userPremiumTier: PremiumTier | null;
  frequency: Frequency;
  defaultFrequency: Frequency;
  frequencySource: "default" | "user_selected";
  stripeSubscriptionId: string | null | undefined;
  stripeSubscriptionStatus: string | null | undefined;
  hasActiveAppleManagedSubscription: boolean;
  isLoggedIn: boolean;
  router: ReturnType<typeof useRouter>;
  userId: string | null | undefined;
  pricingSource: "welcome_upgrade" | "app_premium";
}) {
  const posthog = usePostHog();
  const { t, i18n } = useLingui();
  const [loading, setLoading] = useState(false);
  const tierMessages = TIER_MESSAGES[tier.name];
  const supportEmail = env.NEXT_PUBLIC_SUPPORT_EMAIL;

  const isCurrentPlan = tier.tiers[frequency.value] === userPremiumTier;
  const discountPercent = tier.discount?.[frequency.value]?.toFixed(0);
  const hasActiveStripeSubscription =
    !!stripeSubscriptionId &&
    !!stripeSubscriptionStatus &&
    // 已暂停的订阅在 Stripe 中仍然存在，因此套餐变更要通过客户门户完成，而不是新建结账。
    ["active", "trialing", "paused"].includes(stripeSubscriptionStatus);

  // `text` 保留英文供分析使用；`label` 是按钮实际显示的文案。
  function getCTA() {
    if (isCurrentPlan) return { text: "Current plan", label: t`当前套餐` };
    if (userPremiumTier && !tier.ctaLink) {
      return { text: "Switch to this plan", label: t`切换到此套餐` };
    }
    return {
      text: tier.cta,
      label: tierMessages ? i18n._(tierMessages.cta) : tier.cta,
    };
  }

  return (
    <div className="flex flex-col rounded-3xl bg-white p-6 ring-1 ring-gray-200 sm:p-8 xl:p-10">
      <div className="flex-1">
        <div className="flex items-center justify-between gap-x-4">
          <h3
            id={tier.name}
            className={cn(
              tier.mostPopular ? "text-blue-600" : "text-gray-900",
              "font-title text-lg leading-8",
            )}
          >
            {tier.name}
          </h3>
          {tier.mostPopular ? (
            <DiscountBadge>
              <Trans>热门</Trans>
            </DiscountBadge>
          ) : null}
        </div>
        <p className="mt-4 text-sm leading-6 text-gray-600">
          {tierMessages ? i18n._(tierMessages.description) : tier.description}
        </p>
        <p className="mt-6 flex items-baseline gap-x-1">
          {tier.price[frequency.value] === 0 ? (
            <span className="text-4xl font-bold tracking-tight text-gray-900">
              <Trans>联系我们</Trans>
            </span>
          ) : (
            <>
              <span className="text-4xl font-bold tracking-tight text-gray-900">
                {formatPrice(tier.price[frequency.value])}
              </span>
              <span className="text-sm font-semibold leading-6 text-gray-600">
                <Trans>/用户</Trans>
              </span>
            </>
          )}

          {!!tier.discount?.[frequency.value] && (
            <DiscountBadge>
              <span className="tracking-wide">
                <Trans>SAVE {discountPercent}%</Trans>
              </span>
            </DiscountBadge>
          )}
        </p>

        <p className="mt-2 text-sm leading-6 text-gray-600">
          {tier.price[frequency.value]
            ? i18n._(frequency.priceSuffix)
            : "\u00A0"}
        </p>

        {!!tier.price[frequency.value] && (
          <ExtraAccountPricing price={tier.price[frequency.value]} />
        )}

        <ul className="mt-8 space-y-3 text-sm leading-6 text-gray-600">
          {tier.features.map((feature) => {
            const featureMessages = tierMessages?.features[feature.text];
            const tooltip = featureMessages?.tooltip
              ? i18n._(featureMessages.tooltip)
              : feature.tooltip;
            return (
              <li key={feature.text} className="flex gap-x-3">
                <CheckIcon
                  className="h-6 w-5 flex-none text-blue-600"
                  aria-hidden="true"
                />
                <span className="flex items-center gap-2">
                  {featureMessages
                    ? i18n._(featureMessages.text)
                    : feature.text}
                  {tooltip && <TooltipExplanation text={tooltip} />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          const upgradeToTier = tier.tiers[frequency.value];

          posthog.capture("pricing_cta_clicked", {
            source: pricingSource,
            tier: tier.name,
            billingTier: upgradeToTier ?? null,
            frequency: frequency.value,
            defaultFrequency: defaultFrequency.value,
            frequencySource,
            cta: getCTA().text,
            isCurrentPlan,
            isLoggedIn,
            hasExternalCta: Boolean(tier.ctaLink),
            hasActiveStripeSubscription,
          });

          // Handle enterprise tier differently - redirect to sales page
          if (tier.ctaLink) {
            redirectToSafeUrl(tier.ctaLink, { allowExternal: true });
            return;
          }

          if (!isLoggedIn) {
            router.push("/login");
            return;
          }

          setLoading(true);

          async function load() {
            if (tier.tiers[frequency.value] === userPremiumTier) {
              toast.info(t`You are already on this plan`);
              return;
            }

            if (hasActiveAppleManagedSubscription) {
              toast.info(
                t`This subscription is managed through the App Store. To change or cancel it, use your iPhone or iPad subscription settings.`,
              );
              return;
            }

            let result:
              | Awaited<ReturnType<typeof getBillingPortalUrlAction>>
              | Awaited<ReturnType<typeof generateCheckoutSessionAction>>;

            if (hasActiveStripeSubscription) {
              result = await getBillingPortalUrlAction({ tier: upgradeToTier });
            } else {
              result = await generateCheckoutSessionAction({
                tier: upgradeToTier,
              });
            }

            if (!result?.data?.url || result?.serverError) {
              const description = hasActiveStripeSubscription
                ? t`We couldn't open the plan change page. Your subscription has not been changed. Please contact support at ${supportEmail}`
                : result?.serverError ||
                  t`Error creating checkout session. Please contact support at ${supportEmail}`;

              captureException(new Error("Error opening Stripe billing flow"), {
                extra: {
                  tier: upgradeToTier,
                  frequency: frequency.value,
                  userId,
                  serverError: result?.serverError,
                  result,
                },
              });
              toastError({
                description,
              });
              return;
            }

            redirectToSafeUrl(result.data.url, { allowExternal: true });
          }

          try {
            await load();
          } catch (error) {
            console.error(error);
            toastError({
              description:
                error instanceof Error
                  ? error.message
                  : t`Error creating checkout session. Please contact support at ${supportEmail}`,
            });
          } finally {
            setLoading(false);
          }
        }}
        aria-describedby={tier.name}
        className={cn(
          tier.mostPopular
            ? "bg-blue-600 text-white shadow-sm hover:bg-blue-500"
            : "text-blue-600 ring-1 ring-inset ring-blue-200 hover:ring-blue-300",
          "mt-8 block rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center py-1">
            <LoadingMiniSpinner />
          </div>
        ) : (
          getCTA().label
        )}
      </button>
    </div>
  );
}

function ExtraAccountPricing({ price }: { price: number }) {
  const { t } = useLingui();
  const formattedPrice = formatPrice(getExtraAccountPrice(price));
  const extraAccountPrice = t`${formattedPrice}/月`;

  return (
    <p className="mt-1 flex items-center gap-2 text-sm leading-6 text-gray-600">
      <Plural
        value={INCLUDED_EMAIL_ACCOUNTS_PER_PERSON}
        one={`包含 # 个邮箱账号，之后每个 ${extraAccountPrice}`}
        other={`包含 # 个邮箱账号，之后每个 ${extraAccountPrice}`}
      />
      <TooltipExplanation
        text={t`免费连接你的个人和工作邮箱。每个额外邮箱账号为 ${extraAccountPrice}。每位团队成员按单独用户计费。`}
      />
    </p>
  );
}
