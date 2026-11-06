"use client";

import { ChatIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/ChatIllustration";
import { OnboardingFeatureStep } from "./OnboardingFeatureStep";

export function StepChat({ onNext }: { onNext: () => void }) {
  return (
    <OnboardingFeatureStep
      illustration={<ChatIllustration />}
      title="一个帮你管理邮件的聊天机器人"
      description={
        "清理收件箱、起草回复、设置规则。可在 Slack、Telegram 或此处使用，并在需要你时提醒你。"
      }
      onNext={onNext}
    />
  );
}
