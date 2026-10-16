"use client";

import { useState } from "react";
import Link from "next/link";
import { XIcon, CreditCardIcon, AlertTriangleIcon } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { isPremiumRecord } from "@/utils/premium";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils";
import { HoverCard } from "@/components/HoverCard";
import { MutedText } from "@/components/Typography";
import type { PremiumTier } from "@/generated/prisma/enums";

interface PremiumData {
  appleExpiresAt?: Date | string | null;
  appleRevokedAt?: Date | string | null;
  appleSubscriptionStatus?: string | null;
  lemonSqueezyRenewsAt?: Date | string | null;
  lemonSqueezySubscriptionId?: number | string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  tier?: PremiumTier | null;
}

interface PremiumExpiredCardProps {
  onDismiss?: () => void;
  premium: PremiumData | null | undefined;
}

export function PremiumExpiredCardContent({
  premium,
  onDismiss,
  isCollapsed = false,
}: PremiumExpiredCardProps & { isCollapsed?: boolean }) {
  const lemonSqueezyRenewsAt = premium?.lemonSqueezyRenewsAt
    ? typeof premium.lemonSqueezyRenewsAt === "string"
      ? new Date(premium.lemonSqueezyRenewsAt)
      : premium.lemonSqueezyRenewsAt
    : null;

  const isUserPremium = isPremiumRecord(premium);

  if (isUserPremium) return null;

  const getSubscriptionMessage = () => {
    const UPGRADE_MESSAGE = {
      title: "升级到高级版",
      description: "升级到高级版以启用你的 AI 邮件助手。",
    };

    if (!premium) {
      return UPGRADE_MESSAGE;
    }

    const status = premium.stripeSubscriptionStatus;
    const hasLemonSqueezyExpired =
      lemonSqueezyRenewsAt && lemonSqueezyRenewsAt < new Date();

    // 检查用户是否从未订阅过
    const hasNoSubscription =
      !status &&
      !premium.stripeSubscriptionId &&
      !premium.lemonSqueezySubscriptionId;

    if (!premium || hasNoSubscription) {
      return {
        title: "升级到高级版",
        description: "升级到高级版以启用你的 AI 邮件助手。",
      };
    }

    if (status === "past_due") {
      return {
        title: "付款逾期",
        description: "更新付款方式以继续使用服务",
      };
    }

    if (status === "canceled" || status === "cancelled") {
      return {
        title: "订阅已取消",
        description: "重新激活以恢复 AI 邮件管理",
      };
    }

    if (status === "incomplete" || status === "incomplete_expired") {
      return {
        title: "付款未完成",
        description: "完成付款以激活服务",
      };
    }

    if (status === "unpaid") {
      return {
        title: "需要付款",
        description: "更新付款方式以继续使用 AI 功能",
      };
    }

    if (hasLemonSqueezyExpired || status === "expired") {
      return {
        title: "订阅已过期",
        description: "续订以继续使用",
      };
    }

    // 默认兜底
    return {
      title: "订阅问题",
      description: "请检查你的订阅状态",
    };
  };

  const { title, description } = getSubscriptionMessage();

  const isNewUser =
    !premium ||
    (!premium.stripeSubscriptionStatus &&
      !premium.stripeSubscriptionId &&
      !premium.lemonSqueezySubscriptionId);

  const buttonText = isNewUser ? "升级" : "重新激活";
  const buttonHref = isNewUser ? "/premium" : "/settings";

  // 折叠时仅显示带悬停卡片的警告图标
  if (isCollapsed) {
    return (
      <HoverCard
        className="w-64"
        content={
          <div className="space-y-2">
            <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
              {title}
            </p>
            <MutedText>{description}</MutedText>
            <Button
              asChild
              size="sm"
              className="w-full bg-orange-600 text-white hover:bg-orange-700 border-0 shadow-sm h-8 mt-2"
            >
              <Link
                href={buttonHref}
                className="flex items-center justify-center gap-1.5"
              >
                <CreditCardIcon className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{buttonText}</span>
              </Link>
            </Button>
          </div>
        }
      >
        <Link
          href={buttonHref}
          className="flex items-center justify-center p-2 rounded-lg bg-orange-100 hover:bg-orange-200 transition-colors dark:bg-orange-900/30 dark:hover:bg-orange-900/50"
        >
          <AlertTriangleIcon className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </Link>
      </HoverCard>
    );
  }

  return (
    <Card
      className={cn(
        "border-orange-200 bg-gradient-to-tr from-transparent via-orange-50/80 to-orange-500/15 shadow-sm",
        "dark:border-orange-900 dark:from-orange-950/50 dark:via-orange-900/20 dark:to-orange-800/10",
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <AlertTriangleIcon className="h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200 leading-tight">
              {title}
            </p>
            <p className="text-xs text-orange-700/80 dark:text-orange-300/80 mt-1">
              {description}
            </p>
          </div>

          {onDismiss && (
            <button
              type="button"
              className="flex-shrink-0 rounded p-1 text-orange-600 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-colors dark:text-orange-400 dark:hover:bg-orange-900/20 dark:focus:ring-orange-700"
              onClick={onDismiss}
              aria-label="关闭横幅"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="mt-3">
          <Button
            asChild
            size="sm"
            className="w-full bg-orange-600 text-white hover:bg-orange-700 border-0 shadow-sm h-8"
          >
            <Link
              href={buttonHref}
              className="flex items-center justify-center gap-1.5"
            >
              <CreditCardIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{buttonText}</span>
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function PremiumCard({
  isCollapsed = false,
}: {
  isCollapsed?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const { data: user, isLoading } = useUser();

  if (isLoading || dismissed || !user) return null;

  return (
    <div className={cn("px-3 pt-4", isCollapsed && "flex justify-center")}>
      <PremiumExpiredCardContent
        premium={user.premium}
        onDismiss={isCollapsed ? undefined : () => setDismissed(true)}
        isCollapsed={isCollapsed}
      />
    </div>
  );
}
