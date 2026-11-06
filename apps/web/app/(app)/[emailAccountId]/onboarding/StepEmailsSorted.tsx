"use client";

import { EmailsSortedIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/EmailsSortedIllustration";
import { OnboardingFeatureStep } from "./OnboardingFeatureStep";

export function StepEmailsSorted({ onNext }: { onNext: () => void }) {
  return (
    <OnboardingFeatureStep
      illustration={<EmailsSortedIllustration />}
      title="自动整理的收件箱"
      description={
        "每封邮件都会得到一个标签，例如“待回复”、“新闻邮件”或“冷邮件”。"
      }
      onNext={onNext}
    />
  );
}
