"use client";

import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, MailIcon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { BRAND_NAME } from "@/utils/branding";

export function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 px-4 py-8 dark:bg-background">
      <div className="flex max-w-md flex-col items-center text-center duration-500 animate-in fade-in">
        <IconCircle size="lg" className="mb-4">
          <MailIcon className="size-6" />
        </IconCircle>
        <PageHeading className="mb-3">
          <Trans>欢迎使用 {BRAND_NAME}</Trans>
        </PageHeading>
        <TypographyP className="mb-8 text-pretty text-muted-foreground">
          <Trans>
            你的 AI 邮件助手。直接在 Gmail 或 Outlook
            中整理收件箱、撰写回复，并清理杂乱邮件。
          </Trans>
        </TypographyP>
        <Button className="w-full max-w-xs" onClick={onNext}>
          <Trans>了解工作原理</Trans>
          <ArrowRightIcon className="ml-2 size-4" />
        </Button>
      </div>
    </div>
  );
}
