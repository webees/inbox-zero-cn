"use client";

import { useState } from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import type { PostHog } from "posthog-js";
import { Label, Radio, RadioGroup } from "@headlessui/react";
import { Sparkle } from "@/components/new-landing/icons/Sparkle";
import { Zap } from "@/components/new-landing/icons/Zap";
import { Check } from "@/components/new-landing/icons/Check";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  Button,
  type ButtonVariant,
} from "@/components/new-landing/common/Button";
import { Card, CardContent } from "@/components/new-landing/common/Card";
import {
  Paragraph,
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";
import {
  Badge,
  type BadgeVariant,
} from "@/components/new-landing/common/Badge";
import { Chat } from "@/components/new-landing/icons/Chat";
import { type Tier, tiers } from "@/app/(app)/premium/config";
import { Briefcase } from "@/components/new-landing/icons/Briefcase";
import { Mail } from "@/components/new-landing/icons/Mail";
import { landingPageAnalytics } from "@/hooks/useAnalytics";
import { cn } from "@/utils";
import { MAIL_CLIENT_SIGNUP_PATH } from "@/utils/config";

type PricingTier = Tier & {
  badges?: {
    message: string;
    variant?: BadgeVariant;
    annualOnly?: boolean;
  }[];
  button: {
    content: string;
    variant?: ButtonVariant;
    icon?: React.ReactNode;
    href: string;
    target?: string;
  };
  icon: React.ReactNode;
};

const pricingTiers: PricingTier[] = [
  {
    ...tiers[0],
    badges: [{ message: "省 10%", annualOnly: true }],
    button: {
      variant: "secondary-two",
      content: "免费试用 7 天",
      href: "/login",
    },
    icon: <Briefcase />,
  },
  {
    ...tiers[1],
    badges: [
      { message: "省 20%", annualOnly: true },
      { message: "热门", variant: "green" },
    ],
    button: {
      content: "免费试用 7 天",
      href: "/login",
    },
    icon: <Zap />,
  },
  {
    ...tiers[2],
    badges: [{ message: "省 16%", annualOnly: true }],
    button: {
      variant: "secondary-two",
      content: "免费试用 7 天",
      href: "/login",
    },
    icon: <Sparkle />,
  },
];

const frequencies = ["annually", "monthly"] as const;
type PricingFrequency = (typeof frequencies)[number];

export function Pricing() {
  const defaultFrequency: PricingFrequency = "annually";
  const [chosenFrequency, setFrequency] = useState<PricingFrequency | null>(
    null,
  );
  const frequency = chosenFrequency ?? defaultFrequency;
  const posthog = usePostHog();

  return (
    <Section id="pricing">
      <SectionHeading>免费试用，价格实惠的付费套餐</SectionHeading>
      <SectionSubtitle>没有隐藏费用。随时取消。</SectionSubtitle>
      <SectionContent
        noMarginTop
        className="mt-6 flex flex-col items-center justify-center"
      >
        <RadioGroup
          value={frequency}
          onChange={(nextFrequency: PricingFrequency) => {
            posthog.capture("pricing_frequency_changed", {
              source: "landing_page",
              previousFrequency: frequency,
              frequency: nextFrequency,
              defaultFrequency,
            });
            setFrequency(nextFrequency);
          }}
          className="w-fit rounded-full p-1.5 text-xs font-semibold leading-5 ring-1 ring-inset ring-gray-200 mb-6 shadow-[0_0_7px_0_rgba(0,0,0,0.0.07)]"
        >
          <Label className="sr-only">付款频率</Label>
          {frequencies.map((value) => (
            <Radio
              key={value}
              value={value}
              className={({ checked }) =>
                cn(
                  checked ? "bg-black text-white" : "text-gray-500",
                  "cursor-pointer rounded-full px-6 py-1",
                )
              }
            >
              <span>{value.charAt(0).toUpperCase() + value.slice(1)}</span>
            </Radio>
          ))}
        </RadioGroup>
        <div className="grid w-full grid-cols-1 lg:grid-cols-3 gap-6">
          {pricingTiers.map((tier, index) => (
            <CardWrapper key={tier.name}>
              <PricingCard
                tier={tier}
                tierIndex={index}
                frequency={frequency}
                defaultFrequency={defaultFrequency}
                frequencySource={chosenFrequency ? "user_selected" : "default"}
                posthog={posthog}
              />
            </CardWrapper>
          ))}
        </div>
        <CardWrapper className="mt-6 w-full">
          <Card variant="extra-rounding">
            <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-gray-400">
                  <Mail />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-title text-lg">邮件应用</h3>
                    <Badge variant="blue">新</Badge>
                  </div>
                  <Paragraph size="sm" className="mt-1">
                    一款适用于 Gmail 和 Outlook 的快速邮件应用。在网页、桌面端和
                    iPhone 上免费使用。
                  </Paragraph>
                </div>
              </div>
              <Button size="lg" asChild>
                <Link
                  href={MAIL_CLIENT_SIGNUP_PATH}
                  className="shrink-0 whitespace-nowrap"
                  onClick={() =>
                    landingPageAnalytics.pricingCtaClicked(posthog, {
                      tier: "Email app",
                      cta: "Get started free",
                      frequency,
                      defaultFrequency,
                      frequencySource: chosenFrequency
                        ? "user_selected"
                        : "default",
                    })
                  }
                >
                  <span className="relative z-10">免费开始</span>
                </Link>
              </Button>
            </CardContent>
          </Card>
        </CardWrapper>
        <CardWrapper className="mt-6 w-full">
          <Card variant="extra-rounding">
            <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-gray-400">
                  <Sparkle />
                </div>
                <div>
                  <h3 className="font-title text-lg">企业版</h3>
                  <Paragraph size="sm" className="mt-1">
                    需要 SSO、SCIM、本地部署或专属客户经理吗？
                  </Paragraph>
                </div>
              </div>
              <Button variant="secondary-two" size="lg" asChild>
                <Link
                  href="https://www.getinboxzero.com/sales"
                  onClick={() =>
                    landingPageAnalytics.pricingCtaClicked(posthog, {
                      tier: "Enterprise",
                      cta: "Speak to sales",
                      frequency,
                      defaultFrequency,
                      frequencySource: chosenFrequency
                        ? "user_selected"
                        : "default",
                    })
                  }
                >
                  <Chat />
                  <span className="relative z-10">联系销售</span>
                </Link>
              </Button>
            </CardContent>
          </Card>
        </CardWrapper>
      </SectionContent>
    </Section>
  );
}

interface PricingCardProps {
  defaultFrequency: PricingFrequency;
  frequency: PricingFrequency;
  frequencySource: "default" | "user_selected";
  posthog: PostHog;
  tier: PricingTier;
  tierIndex: number;
}

function PricingCard({
  tier,
  tierIndex,
  frequency,
  defaultFrequency,
  frequencySource,
  posthog,
}: PricingCardProps) {
  const { name, description, features } = tier;
  const isAnnual = frequency === "annually";
  const price = isAnnual ? tier.price.annually : tier.price.monthly;
  const isFirstTier = !tierIndex;

  return (
    <Card
      title={name}
      description={description}
      icon={tier.icon}
      variant="extra-rounding"
      addon={
        <div className="h-0 flex items-center gap-1.5">
          {tier.badges
            ?.filter(({ annualOnly }) => !annualOnly || isAnnual)
            .map((badge) => (
              <Badge key={badge.message} variant={badge.variant}>
                {badge.message}
              </Badge>
            ))}
        </div>
      }
      className="h-full"
    >
      <div className="pt-0 px-6 pb-6">
        <div className="space-y-6">
          <div className="flex gap-2 items-end">
            {price ? (
              <>
                <div className="font-title text-[#242424] text-[1.7rem] md:text-[2.5rem] leading-tight">
                  ${price}
                </div>
                <Paragraph size="xs" color="light" className="-translate-y-1">
                  /用户/月
                </Paragraph>
              </>
            ) : (
              <div className="font-title text-[#242424] text-[1.7rem] md:text-[2.5rem] leading-tight">
                联系我们
              </div>
            )}
          </div>
          <Button auto size="lg" variant={tier.button.variant} asChild>
            <Link
              href={tier.button.href}
              target={tier.button.target}
              onClick={() =>
                landingPageAnalytics.pricingCtaClicked(posthog, {
                  tier: tier.name,
                  cta: tier.button.content,
                  frequency,
                  defaultFrequency,
                  frequencySource,
                })
              }
            >
              {tier.button.icon}
              {/* z-10 keeps text above gradient background on hover to prevent color shift */}
              <span className="relative z-10">{tier.button.content}</span>
            </Link>
          </Button>
        </div>
      </div>
      <CardContent className="border-t border-[#E7E7E780]">
        {isFirstTier ? null : (
          <Paragraph size="sm" className="font-medium mb-4">
            {tier.features[0].text}
          </Paragraph>
        )}
        <ul className="space-y-3">
          {features
            .filter((_, index) => !!isFirstTier || index > 0)
            .map((feature) => (
              <li
                className="text-gray-500 flex items-center gap-2 text-sm"
                key={feature.text}
              >
                <div className="text-blue-500">
                  <Check />
                </div>
                {feature.text}
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}
