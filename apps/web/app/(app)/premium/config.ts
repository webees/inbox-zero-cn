import { env } from "@/env";
import type { PremiumTier } from "@/generated/prisma/enums";

type Feature = { text: string; tooltip?: string };

export type Tier = {
  name: string;
  tiers: { monthly: PremiumTier; annually: PremiumTier };
  price: { monthly: number; annually: number };
  discount: { monthly: number; annually: number };
  quantity?: number;
  description: string;
  features: Feature[];
  cta: string;
  ctaLink?: string;
  mostPopular?: boolean;
};

const pricing: Record<PremiumTier, number> = {
  BASIC_MONTHLY: 16,
  BASIC_ANNUALLY: 8,
  PRO_MONTHLY: 16,
  PRO_ANNUALLY: 10,
  STARTER_MONTHLY: 20,
  STARTER_ANNUALLY: 18,
  PLUS_MONTHLY: 35,
  PLUS_ANNUALLY: 28,
  PROFESSIONAL_MONTHLY: 50,
  PROFESSIONAL_ANNUALLY: 42,
  COPILOT_MONTHLY: 500,
  LIFETIME: 299,
};

const variantIdToTier: Record<number, PremiumTier> = {
  [env.NEXT_PUBLIC_BASIC_MONTHLY_VARIANT_ID]: "BASIC_MONTHLY",
  [env.NEXT_PUBLIC_BASIC_ANNUALLY_VARIANT_ID]: "BASIC_ANNUALLY",
  [env.NEXT_PUBLIC_PRO_MONTHLY_VARIANT_ID]: "PRO_MONTHLY",
  [env.NEXT_PUBLIC_PRO_ANNUALLY_VARIANT_ID]: "PRO_ANNUALLY",
  [env.NEXT_PUBLIC_BUSINESS_MONTHLY_VARIANT_ID]: "STARTER_MONTHLY",
  [env.NEXT_PUBLIC_BUSINESS_ANNUALLY_VARIANT_ID]: "STARTER_ANNUALLY",
  [env.NEXT_PUBLIC_COPILOT_MONTHLY_VARIANT_ID]: "COPILOT_MONTHLY",
};

export const BRIEF_MY_MEETING_PRICE_ID_MONTHLY =
  "price_1SjoaXKGf8mwZWHnOdyaf2IN";
export const BRIEF_MY_MEETING_PRICE_ID_ANNUALLY =
  "price_1SjoawKGf8mwZWHnfAeShYhb";

const INCLUDED_EMAIL_ACCOUNT_PRICE_IDS = [
  env.NEXT_PUBLIC_STRIPE_PLUS_MONTHLY_PRICE_ID,
  env.NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_MONTHLY_PRICE_ID,
];

const STRIPE_PRICE_ID_CONFIG: Record<
  PremiumTier,
  {
    // active price id
    priceId?: string;
    // Allow handling of old price ids
    oldPriceIds?: string[];
  }
> = {
  BASIC_MONTHLY: { priceId: "price_1RfeDLKGf8mwZWHn6UW8wJcY" },
  BASIC_ANNUALLY: { priceId: "price_1RfeDLKGf8mwZWHn5kfC8gcM" },
  PRO_MONTHLY: {},
  PRO_ANNUALLY: {},
  STARTER_MONTHLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID,
    oldPriceIds: [
      "price_1T9FhCKGf8mwZWHn1olNzv6X",
      "price_1S5u73KGf8mwZWHn8VYFdALA",
      "price_1RMSnIKGf8mwZWHnlHP0212n",
      "price_1RfoILKGf8mwZWHnDiUMj6no",
      "price_1RfeAFKGf8mwZWHnnnPzFEky",
      "price_1RfSoHKGf8mwZWHnxTsSDTqW",
      "price_1Rg0QfKGf8mwZWHnDsiocBVD",
      "price_1Rg0LEKGf8mwZWHndYXYg7ie",
      "price_1Rg03pKGf8mwZWHnWMNeQzLc",
      BRIEF_MY_MEETING_PRICE_ID_MONTHLY,
    ],
  },
  STARTER_ANNUALLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_BUSINESS_ANNUALLY_PRICE_ID,
    oldPriceIds: [
      "price_1S5u6uKGf8mwZWHnEvPWuQzG",
      "price_1S1QGGKGf8mwZWHnYpUcqNua",
      "price_1RMSnIKGf8mwZWHnymtuW2s0",
      "price_1RfSoxKGf8mwZWHngHcug4YM",
      // brief my meeting
      BRIEF_MY_MEETING_PRICE_ID_ANNUALLY,
    ],
  },
  PLUS_MONTHLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_PLUS_MONTHLY_PRICE_ID,
  },
  PLUS_ANNUALLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_PLUS_ANNUALLY_PRICE_ID,
  },
  PROFESSIONAL_MONTHLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_MONTHLY_PRICE_ID,
    oldPriceIds: [
      "price_1S5u6NKGf8mwZWHnZCfy4D5n",
      "price_1RMSoMKGf8mwZWHn5fAKBT19",
    ],
  },
  PROFESSIONAL_ANNUALLY: {
    priceId: env.NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_ANNUALLY_PRICE_ID,
    oldPriceIds: [
      "price_1S5u6XKGf8mwZWHnba8HX1H2",
      "price_1RMSoMKGf8mwZWHnGjf6fRmh",
    ],
  },
  COPILOT_MONTHLY: {},
  LIFETIME: {},
};

const APPLE_PRODUCT_ID_CONFIG: Partial<Record<PremiumTier, string>> = {
  STARTER_MONTHLY: env.NEXT_PUBLIC_APPLE_IAP_STARTER_MONTHLY_PRODUCT_ID,
  STARTER_ANNUALLY: env.NEXT_PUBLIC_APPLE_IAP_STARTER_ANNUALLY_PRODUCT_ID,
};

/**
 * App Store products sold by the native iOS app. Both grant the `pro`
 * Superwall entitlement, which is the Starter tier (the same tier Stripe's
 * business prices and Lemon's business variants map to).
 */
const APPLE_STARTER_PRODUCT_IDS: Record<string, PremiumTier> = {
  "com.getinboxzero.starter.monthly.v2": "STARTER_MONTHLY",
  "com.getinboxzero.starter.annual.v2": "STARTER_ANNUALLY",
};

export function getStripeSubscriptionTier({
  priceId,
}: {
  priceId: string;
}): PremiumTier | null {
  const entries = Object.entries(STRIPE_PRICE_ID_CONFIG);

  for (const [tier, config] of entries) {
    if (config.priceId === priceId || config.oldPriceIds?.includes(priceId)) {
      return tier as PremiumTier;
    }
  }
  return null;
}

export function getStripePriceId({
  tier,
}: {
  tier: PremiumTier;
}): string | null {
  return STRIPE_PRICE_ID_CONFIG[tier]?.priceId ?? null;
}

export function hasIncludedEmailAccountsStripePriceId(
  priceId: string | null | undefined,
): boolean {
  if (!priceId) return false;

  return INCLUDED_EMAIL_ACCOUNT_PRICE_IDS?.includes(priceId) ?? false;
}

export function getAppleSubscriptionTier({
  productId,
}: {
  productId: string;
}): PremiumTier | null {
  const starterTier = APPLE_STARTER_PRODUCT_IDS[productId];
  if (starterTier) return starterTier;

  for (const [tier, configuredProductId] of Object.entries(
    APPLE_PRODUCT_ID_CONFIG,
  )) {
    if (configuredProductId === productId) {
      return tier as PremiumTier;
    }
  }

  return null;
}

export function hasLegacyStripePriceId({
  tier,
  priceId,
}: {
  tier: PremiumTier | null | undefined;
  priceId: string | null | undefined;
}): boolean {
  if (!priceId) return false;

  const resolvedTier = tier || getStripeSubscriptionTier({ priceId });
  if (!resolvedTier) return false;

  const tierConfig = STRIPE_PRICE_ID_CONFIG[resolvedTier];
  if (!tierConfig) return false;
  // We sometimes reuse a historical price as the active price again.
  if (tierConfig.priceId === priceId) return false;

  return tierConfig.oldPriceIds?.includes(priceId) ?? false;
}

export function shouldShowLegacyStripePricingNotice(
  premium:
    | {
        tier: PremiumTier | null | undefined;
        stripePriceId: string | null | undefined;
        stripeSubscriptionStatus: string | null | undefined;
      }
    | null
    | undefined,
): boolean {
  if (!premium?.stripeSubscriptionStatus) return false;
  if (!["active", "trialing"].includes(premium.stripeSubscriptionStatus)) {
    return false;
  }

  return hasLegacyStripePriceId({
    tier: premium.tier,
    priceId: premium.stripePriceId,
  });
}

export function getPremiumTierName(
  tier: PremiumTier | null | undefined,
): string {
  if (!tier) return "高级版";

  const tierMap: Partial<Record<PremiumTier, string>> = {
    STARTER_MONTHLY: "入门版",
    STARTER_ANNUALLY: "入门版",
    PLUS_MONTHLY: "进阶版",
    PLUS_ANNUALLY: "进阶版",
    PROFESSIONAL_MONTHLY: "专业版",
    PROFESSIONAL_ANNUALLY: "专业版",
    COPILOT_MONTHLY: "企业版",
    BASIC_MONTHLY: "基础版",
    BASIC_ANNUALLY: "基础版",
    PRO_MONTHLY: "专业版",
    PRO_ANNUALLY: "专业版",
    LIFETIME: "终身版",
  };

  return tierMap[tier] ?? "高级版";
}

function discount(monthly: number, annually: number) {
  return ((monthly - annually) / monthly) * 100;
}

export const starterTierName = "入门版";

const starterTier: Tier = {
  name: starterTierName,
  tiers: {
    monthly: "STARTER_MONTHLY",
    annually: "STARTER_ANNUALLY",
  },
  price: {
    monthly: pricing.STARTER_MONTHLY,
    annually: pricing.STARTER_ANNUALLY,
  },
  discount: {
    monthly: 0,
    annually: discount(pricing.STARTER_MONTHLY, pricing.STARTER_ANNUALLY),
  },
  description: "适合希望把时间买回来的个人、创业者和高管。",
  features: [
    {
      text: "为每封邮件分类并打标签",
    },
    {
      text: "以你的口吻起草回复",
    },
    {
      text: "拦截冷邮件",
    },
    {
      text: "批量退订和归档邮件",
    },
    {
      text: "邮件分析",
    },
    {
      text: "会前简报",
      tooltip:
        "在每次会议前获取 AI 简报，包含参会者调研以及来自你收件箱的上下文。",
    },
  ],
  cta: "免费试用 7 天",
  mostPopular: false,
};

const plusTier: Tier = {
  name: "进阶版",
  tiers: {
    monthly: "PLUS_MONTHLY",
    annually: "PLUS_ANNUALLY",
  },
  price: {
    monthly: pricing.PLUS_MONTHLY,
    annually: pricing.PLUS_ANNUALLY,
  },
  discount: {
    monthly: 0,
    annually: discount(pricing.PLUS_MONTHLY, pricing.PLUS_ANNUALLY),
  },
  description: "适合需要集成和更深入知识库支持的高级用户。",
  features: [
    {
      text: "包含入门版的所有功能，外加：",
    },
    {
      text: "每位用户包含 2 个邮箱账号",
      tooltip: "每位用户包含 2 个邮箱账号。额外的邮箱账号按标准席位费率计费。",
    },
    {
      text: "AI 会议记录者",
      tooltip:
        "一位记录者会加入你的视频通话，并把它变成转写、摘要、回顾邮件和跟进草稿。",
    },
    {
      text: "Slack 集成",
      tooltip: "自动把重要邮件和通知转发到你的 Slack 频道。",
    },
    {
      text: "应用集成",
      tooltip:
        "连接 Notion、Stripe、Monday.com 等，让 AI 在起草回复和会议简报时可以使用你工具中的数据。",
    },
    {
      text: "邮件摘要",
      tooltip: "把所选规则中的邮件归入一份定期摘要，而不必逐封阅读。",
    },
    {
      text: "自动归档附件",
      tooltip: "自动把邮件附件整理并归档到你偏好的存储位置。",
    },
    {
      text: "无限知识库",
      tooltip: "知识库用于帮助起草回复。在知识库中存储无限内容。",
    },
  ],
  cta: "免费试用 7 天",
  mostPopular: true,
};

const professionalTier: Tier = {
  name: "专业版",
  tiers: {
    monthly: "PROFESSIONAL_MONTHLY",
    annually: "PROFESSIONAL_ANNUALLY",
  },
  price: {
    monthly: pricing.PROFESSIONAL_MONTHLY,
    annually: pricing.PROFESSIONAL_ANNUALLY,
  },
  discount: {
    monthly: 0,
    annually: discount(
      pricing.PROFESSIONAL_MONTHLY,
      pricing.PROFESSIONAL_ANNUALLY,
    ),
  },
  description: "适合处理大量邮件的团队和成长型企业。",
  features: [
    {
      text: "包含进阶版的所有功能，外加：",
    },
    { text: "团队级分析" },
    { text: "优先支持" },
    {
      text: "专属引导经理",
      tooltip:
        "我们会在一次引导通话中帮助你完成设置。可按需预约任意多次免费通话。",
    },
  ],
  cta: "免费试用 7 天",
  mostPopular: false,
};

const enterpriseTier: Tier = {
  name: "企业版",
  tiers: {
    monthly: "COPILOT_MONTHLY",
    annually: "COPILOT_MONTHLY",
  },
  price: { monthly: 0, annually: 0 },
  discount: { monthly: 0, annually: 0 },
  description: "适合有企业级安全和合规要求的组织。",
  features: [
    {
      text: "包含团队版的所有功能，外加：",
    },
    {
      text: "SSO 登录",
    },
    {
      text: "SCIM 用户预配",
    },
    {
      text: "本地部署（可选）",
    },
    {
      text: "高级安全与 SLA",
    },
    {
      text: "专属客户经理与培训",
    },
  ],
  cta: "联系销售",
  ctaLink: "https://www.getinboxzero.com/sales",
  mostPopular: false,
};

export function getLemonSubscriptionTier({
  variantId,
}: {
  variantId: number;
}): PremiumTier {
  const tier = variantIdToTier[variantId];
  if (!tier) throw new Error(`未知的 variant id: ${variantId}`);
  return tier;
}

export const tiers: Tier[] = [starterTier, plusTier, professionalTier];
export { enterpriseTier };
