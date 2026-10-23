import { Suspense } from "react";
import { SparklesIcon } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/utils/prisma";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { EmailLabelsProvider } from "@/providers/EmailLabelsProvider";
import { ASSISTANT_ONBOARDING_COOKIE } from "@/utils/cookies";
import { checkUserOwnsEmailAccount } from "@/utils/email-account";
import { AIChatButton } from "@/app/(app)/[emailAccountId]/assistant/AIChatButton";
import { AllRulesDisabledBanner } from "@/app/(app)/[emailAccountId]/assistant/AllRulesDisabledBanner";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { DismissibleVideoCard } from "@/components/VideoCard";
import {
  STEP_KEYS,
  getOnboardingStepHref,
} from "@/app/(app)/[emailAccountId]/onboarding/onboardingFlow";
import { AutomationTabs } from "@/app/(app)/[emailAccountId]/automation/AutomationTabs";

export const maxDuration = 300; // 适用于 actions

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  await checkUserOwnsEmailAccount({ emailAccountId });

  // 引导流程重定向
  const cookieStore = await cookies();
  const viewedOnboarding =
    cookieStore.get(ASSISTANT_ONBOARDING_COOKIE)?.value === "true";

  if (!viewedOnboarding) {
    const hasRule = await prisma.rule.findFirst({
      where: { emailAccountId },
      select: { id: true },
    });

    if (!hasRule) {
      redirect(getOnboardingStepHref(emailAccountId, STEP_KEYS.LABELS));
    }
  }

  return (
    <EmailLabelsProvider>
      <Suspense>
        <PermissionsCheck />

        <PageWrapper>
          <div className="flex items-center justify-between">
            <div>
              <PageHeader
                title="AI 助手"
                video={{
                  title: "AI 个人助手入门",
                  description: "了解如何使用 AI 个人助手自动打标签、归档等。",
                  muxPlaybackId:
                    "TYo3SIMdhg008x022H79400CxeRSiB6mLyuwHx8Szc00Rec",
                }}
              />
            </div>

            <div className="ml-4">
              <AIChatButton />
            </div>
          </div>

          <AllRulesDisabledBanner />

          <DismissibleVideoCard
            className="my-4"
            icon={<SparklesIcon className="h-5 w-5" />}
            title="AI 助手入门"
            description="了解如何使用 AI 助手自动打标签、归档等。"
            muxPlaybackId="TYo3SIMdhg008x022H79400CxeRSiB6mLyuwHx8Szc00Rec"
            storageKey="ai-assistant-onboarding-video"
            videoAnalytics={{
              page: "automation",
              surface: "dismissible_card",
            }}
          />

          <AutomationTabs />
        </PageWrapper>
      </Suspense>
    </EmailLabelsProvider>
  );
}
