"use client";

import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/ui/card";
import { useRules } from "@/hooks/useRules";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  STEP_KEYS,
  getOnboardingStepHref,
} from "@/app/(app)/[emailAccountId]/onboarding/onboardingFlow";

export function AllRulesDisabledBanner() {
  const { data: rules, isLoading } = useRules();
  const { emailAccountId } = useAccount();

  if (isLoading || !rules) return null;

  const allRulesDisabled = rules.every((rule) => !rule.enabled);

  if (!allRulesDisabled) return null;

  return (
    <ActionCard
      className="max-w-full mt-4"
      variant="blue"
      icon={<SettingsIcon className="h-5 w-5" />}
      title="所有规则均已停用"
      description="由于所有规则均已停用，你的 AI 助手没有在处理邮件。启用规则即可开始。"
      action={
        <Button asChild variant="primaryBlack">
          <Link
            href={getOnboardingStepHref(emailAccountId, STEP_KEYS.LABELS, {
              force: true,
            })}
          >
            设置规则
          </Link>
        </Button>
      }
    />
  );
}
