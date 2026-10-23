"use client";

import { NotepadTextIcon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { CustomRulesIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/CustomRulesIllustration";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { ContinueButton } from "@/app/(app)/[emailAccountId]/onboarding/ContinueButton";

export function StepCustomRules({
  onNext,
}: {
  provider: string;
  onNext: () => void;
}) {
  return (
    <div className="relative">
      <div className="xl:pr-[50%]">
        <OnboardingWrapper className="py-0">
          <IconCircle size="lg" className="mx-auto">
            <NotepadTextIcon className="size-6" />
          </IconCircle>

          <div className="text-center mt-4 max-w-lg mx-auto">
            <PageHeading>自定义规则</PageHeading>
            <TypographyP className="mt-2 text-left">
              我们已经设置好了基础内容，但这只是开始。你的 AI
              助手可以处理任何你会交给真人的邮件工作流程。
            </TypographyP>
            <TypographyP className="mt-2 text-left">例如：</TypographyP>
            <ul className="list-disc list-inside space-y-1 text-left leading-7 text-muted-foreground ">
              <li>把收据转发给你的会计</li>
              <li>给新闻邮件打标签，并在一周后归档</li>
            </ul>
          </div>

          <div className="flex w-full max-w-xs mx-auto">
            <ContinueButton
              onClick={onNext}
              size="default"
              className="w-full"
            />
          </div>
        </OnboardingWrapper>
      </div>

      <div className="fixed top-0 right-0 w-1/2 h-screen bg-card items-center justify-center hidden xl:flex px-10">
        <CustomRulesIllustration />
      </div>
    </div>
  );
}
