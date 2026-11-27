"use client";

import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Card } from "@/components/ui/card";
import {
  PageSubHeading,
  TypographyH3,
  TypographyH4,
} from "@/components/Typography";
import { ConnectDrive } from "./ConnectDrive";

const steps = [
  {
    number: 1,
    title: msg`告诉我们你如何整理文件`,
    description: msg`“收据按月份归入费用。合同归入法务。”`,
  },
  {
    number: 2,
    title: msg`附件会自动归档`,
    description: msg`AI 会读取每份文档，并将其归入正确的文件夹`,
  },
  {
    number: 3,
    title: msg`一切尽在掌控`,
    description: msg`文件整理完成后会收到邮件——回复即可纠正`,
  },
];

export function DriveOnboarding() {
  const { i18n } = useLingui();

  return (
    <div className="mx-auto max-w-xl py-8">
      <TypographyH3 className="text-center">
        <Trans>工作期间自动归档附件</Trans>
      </TypographyH3>

      <div className="mt-10 space-y-6">
        {steps.map((step) => (
          <div key={step.number} className="flex gap-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {step.number}
            </div>
            <div>
              <TypographyH4>{i18n._(step.title)}</TypographyH4>
              <PageSubHeading className="mt-1">
                {i18n._(step.description)}
              </PageSubHeading>
            </div>
          </div>
        ))}
      </div>

      <Card className="mt-10 p-6">
        <TypographyH4 className="text-center">
          <Trans>希望将附件归档到哪里？</Trans>
        </TypographyH4>
        <div className="mt-4 flex justify-center">
          <ConnectDrive />
        </div>
      </Card>
    </div>
  );
}
