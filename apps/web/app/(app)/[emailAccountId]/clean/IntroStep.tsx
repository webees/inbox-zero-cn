"use client";

import Image from "next/image";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { SectionDescription } from "@/components/Typography";
import { TypographyH3 } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { useStep } from "@/app/(app)/[emailAccountId]/clean/useStep";
import { CleanAction } from "@/generated/prisma/enums";
import { PremiumAlertWithData } from "@/components/PremiumAlert";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";

export function IntroStep({
  unhandledCount,
  cleanAction,
}: {
  unhandledCount: number;
  cleanAction: CleanAction;
}) {
  const { t } = useLingui();
  const { onNext } = useStep();
  const analytics = useProductAnalytics("deep_clean");

  return (
    <div>
      <PremiumAlertWithData className="mb-20" activeOnly />
      <div className="text-center">
        <Image
          src="/images/illustrations/home-office.svg"
          alt={t`清理`}
          width={200}
          height={200}
          className="mx-auto dark:brightness-90 dark:invert"
          unoptimized
        />

        <TypographyH3 className="mt-2">
          <Trans>用 5 分钟清理你的收件箱</Trans>
        </TypographyH3>

        {unhandledCount === null ? (
          <SectionDescription className="mx-auto mt-2 max-w-prose">
            <Trans>正在检查你的收件箱...</Trans>
          </SectionDescription>
        ) : (
          <>
            <SectionDescription className="mx-auto mt-2 max-w-prose">
              {cleanAction === CleanAction.ARCHIVE ? (
                <Plural
                  value={unhandledCount}
                  one="你的收件箱中有 # 封未归档邮件。"
                  other="你的收件箱中有 # 封未归档邮件。"
                />
              ) : (
                <Plural
                  value={unhandledCount}
                  one="你的收件箱中有 # 封未读邮件。"
                  other="你的收件箱中有 # 封未读邮件。"
                />
              )}
            </SectionDescription>
            <SectionDescription className="mx-auto mt-2 max-w-prose">
              <Trans>在确保重要邮件安全的同时，清理你的收件箱。</Trans>
            </SectionDescription>
          </>
        )}

        <div className="mt-6">
          <Button
            onClick={() => {
              analytics.captureAction("deep_clean_started", {
                clean_action: cleanAction,
                unhandled_count: unhandledCount,
              });
              onNext();
            }}
            disabled={unhandledCount === null}
          >
            <Trans>下一步</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
