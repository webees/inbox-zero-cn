"use client";

import { Trans } from "@lingui/react/macro";
import { Settings2Icon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { SplitInboxIllustration } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/SplitInboxIllustration";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { CategoriesSetup } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingCategories";

export function StepLabels({
  emailAccountId,
  provider,
  onNext,
}: {
  emailAccountId: string;
  provider: string;
  onNext: () => void;
}) {
  return (
    <div className="relative">
      <div className="xl:pr-[50%]">
        <OnboardingWrapper className="py-0">
          <IconCircle size="lg" className="mx-auto">
            <Settings2Icon className="size-6" />
          </IconCircle>

          <div className="text-center mt-4">
            <PageHeading>
              <Trans>你希望如何整理收件箱？</Trans>
            </PageHeading>
            <TypographyP className="mt-2 max-w-lg mx-auto">
              <Trans>
                我们会使用这些标签来整理你的收件箱。你可以添加自定义标签，并在之后更改。
              </Trans>
            </TypographyP>
          </div>

          <CategoriesSetup
            emailAccountId={emailAccountId}
            provider={provider}
            onNext={onNext}
          />
        </OnboardingWrapper>
      </div>

      <div className="fixed top-0 right-0 w-1/2 h-screen bg-card items-center justify-center hidden xl:flex px-10">
        <SplitInboxIllustration />
      </div>
    </div>
  );
}
