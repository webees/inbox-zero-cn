"use client";

import Image from "next/image";
import { CheckIcon, PenIcon, XIcon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { useCallback } from "react";
import { enableDraftRepliesAction } from "@/utils/actions/rule";
import { toastError } from "@/components/Toast";
import { OnboardingButton } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingButton";

export function StepDraft({
  emailAccountId,
  onNext,
}: {
  emailAccountId: string;
  provider: string;
  onNext: () => void;
}) {
  const onSetDraftReplies = useCallback(
    async (value: string) => {
      const result = await enableDraftRepliesAction(emailAccountId, {
        enable: value === "yes",
      });

      if (result?.serverError) {
        toastError({
          description: `出错了：${result.serverError || ""}`,
        });
      }

      onNext();
    },
    [onNext, emailAccountId],
  );

  return (
    <div className="relative">
      <div className="xl:pr-[50%]">
        <OnboardingWrapper className="py-0">
          <IconCircle size="lg" className="mx-auto">
            <PenIcon className="size-6" />
          </IconCircle>

          <div className="text-center mt-4">
            <PageHeading>需要为你起草回复吗？</PageHeading>
            <TypographyP className="mt-2 max-w-lg mx-auto">
              草稿会出现在你的收件箱中，并以你的语气撰写。
              <br />
              我们的 AI 会从你之前的对话中学习，从而起草最好的回复。
            </TypographyP>
          </div>

          <div className="mt-4 grid gap-2">
            <OnboardingButton
              text="好的，请"
              icon={<CheckIcon className="size-4" />}
              onClick={() => onSetDraftReplies("yes")}
            />

            <OnboardingButton
              text="不用，谢谢"
              icon={<XIcon className="size-4" />}
              onClick={() => onSetDraftReplies("no")}
            />
          </div>
        </OnboardingWrapper>
      </div>

      <div className="fixed top-0 right-0 w-1/2 h-screen bg-card items-center justify-center hidden xl:flex px-10">
        <div className="rounded-2xl p-4 bg-slate-50 dark:bg-background border border-border">
          <Image
            src="/images/onboarding/draft.png"
            alt="回复草稿"
            width={1200}
            height={800}
            className="rounded-xl border border-border"
          />
        </div>
      </div>
    </div>
  );
}
