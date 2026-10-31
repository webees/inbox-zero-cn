"use client";

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
    title: "告诉我们你如何整理文件",
    description: "“收据按月归入支出。合同归入法务。”",
  },
  {
    number: 2,
    title: "附件会被自动归档",
    description: "AI 会读取每份文档并归档到正确的文件夹",
  },
  {
    number: 3,
    title: "控制权始终在你手里",
    description: "文件归类后会收到邮件——回复即可纠正",
  },
];

export function DriveOnboarding() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <TypographyH3 className="text-center">
        在你工作时自动归档附件
      </TypographyH3>

      <div className="mt-10 space-y-6">
        {steps.map((step) => (
          <div key={step.number} className="flex gap-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {step.number}
            </div>
            <div>
              <TypographyH4>{step.title}</TypographyH4>
              <PageSubHeading className="mt-1">
                {step.description}
              </PageSubHeading>
            </div>
          </div>
        ))}
      </div>

      <Card className="mt-10 p-6">
        <TypographyH4 className="text-center">
          你的附件应该归档到哪里？
        </TypographyH4>
        <div className="mt-4 flex justify-center">
          <ConnectDrive />
        </div>
      </Card>
    </div>
  );
}
