"use client";

import { DraftRepliesIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/DraftRepliesIllustration";
import { OnboardingFeatureStep } from "./OnboardingFeatureStep";

export function StepDraftReplies({ onNext }: { onNext: () => void }) {
  return (
    <OnboardingFeatureStep
      illustration={<DraftRepliesIllustration />}
      title="可直接发送的草稿"
      description={"每封需要回复的邮件都会得到一份草稿，并以你的语气撰写。"}
      onNext={onNext}
    />
  );
}
