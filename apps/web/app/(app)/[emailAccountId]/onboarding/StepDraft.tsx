"use client";

import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();

  const onSetDraftReplies = useCallback(
    async (value: string) => {
      const result = await enableDraftRepliesAction(emailAccountId, {
        enable: value === "yes",
      });

      if (result?.serverError) {
        toastError({
          description: t`发生错误：${result.serverError || ""}`,
        });
      }

      onNext();
    },
    [onNext, emailAccountId, t],
  );

  return (
    <div className="relative">
      <div className="xl:pr-[50%]">
        <OnboardingWrapper className="py-0">
          <IconCircle size="lg" className="mx-auto">
            <PenIcon className="size-6" />
          </IconCircle>

          <div className="text-center mt-4">
            <PageHeading>
              <Trans>要为你起草回复吗？</Trans>
            </PageHeading>
            <TypographyP className="mt-2 max-w-lg mx-auto">
              <Trans>
                草稿会出现在你的收件箱中，并使用你的语气撰写。
                <br />
                我们的 AI 会从你过去的对话中学习，为你起草最佳回复。
              </Trans>
            </TypographyP>
          </div>

          <div className="mt-4 grid gap-2">
            <OnboardingButton
              text={t`好的，请`}
              icon={<CheckIcon className="size-4" />}
              onClick={() => onSetDraftReplies("yes")}
            />

            <OnboardingButton
              text={t`不用，谢谢`}
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
            alt={t`Draft replies`}
            width={1200}
            height={800}
            className="rounded-xl border border-border"
          />
        </div>
      </div>
    </div>
  );
}
