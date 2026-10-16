"use client";

import Image from "next/image";
import { Settings2Icon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
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
            <PageHeading>你希望如何整理收件箱？</PageHeading>
            <TypographyP className="mt-2 max-w-lg mx-auto">
              我们将使用这些标签来整理你的收件箱。你可以稍后添加自定义标签并修改它们。
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
        <div className="rounded-2xl p-4 bg-slate-50 dark:bg-background border border-border">
          <Image
            src="/images/assistant/labels.png"
            alt="对邮件进行分类"
            width={1200}
            height={800}
            className="rounded-xl border border-border"
          />
        </div>
      </div>
    </div>
  );
}
