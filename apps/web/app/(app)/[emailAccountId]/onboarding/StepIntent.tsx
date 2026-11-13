"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { InboxIcon, Layers, MailIcon, SparklesIcon } from "lucide-react";
import { PageHeading } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { toastError } from "@/components/Toast";
import { saveSignupIntentAction } from "@/utils/actions/onboarding";
import { getActionErrorMessage } from "@/utils/error";
import { BRAND_NAME } from "@/utils/branding";
import type { SignupIntent } from "@/generated/prisma/enums";

const options: {
  intent: SignupIntent;
  title: MessageDescriptor;
  description: MessageDescriptor;
  icon: React.ReactNode;
}[] = [
  {
    intent: "AI_ASSISTANT",
    title: msg`AI 助手`,
    description: msg`AI 会为邮件添加标签并起草回复。继续使用 Gmail 或 Outlook。`,
    icon: <SparklesIcon className="size-4" />,
  },
  {
    intent: "MAIL_CLIENT",
    title: msg`邮件应用`,
    description: msg`一款快速、免费的邮件收发应用。`,
    icon: <InboxIcon className="size-4" />,
  },
  {
    intent: "BOTH",
    title: msg`两者都要`,
    description: msg`内置 AI 助手的邮件应用。`,
    icon: <Layers className="size-4" />,
  },
];

export function StepIntent({
  onIntentSaved,
}: {
  onIntentSaved: (intent: SignupIntent) => void;
}) {
  const { i18n } = useLingui();
  const [selected, setSelected] = useState<SignupIntent | null>(null);

  const { execute, isExecuting } = useAction(saveSignupIntentAction, {
    onSuccess: ({ input }) => onIntentSaved(input.intent),
    onError: ({ error }) => {
      setSelected(null);
      toastError({ description: getActionErrorMessage(error) });
    },
  });

  return (
    <OnboardingWrapper className="py-0">
      <IconCircle size="lg" className="mx-auto">
        <MailIcon className="size-6" />
      </IconCircle>

      <PageHeading className="mt-4 text-balance text-center">
        <Trans>你想如何使用 {BRAND_NAME}？</Trans>
      </PageHeading>

      <div className="mx-auto mt-6 grid w-full max-w-md gap-3">
        {options.map((option) => (
          <button
            key={option.intent}
            type="button"
            disabled={isExecuting}
            className="flex items-center gap-4 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm transition-all hover:border-blue-600 hover:ring-2 hover:ring-blue-100 disabled:opacity-60 data-[selected=true]:border-blue-600 data-[selected=true]:ring-2 data-[selected=true]:ring-blue-100"
            data-selected={selected === option.intent}
            onClick={() => {
              setSelected(option.intent);
              execute({ intent: option.intent });
            }}
          >
            <IconCircle size="sm">{option.icon}</IconCircle>
            <div>
              <div className="font-medium">{i18n._(option.title)}</div>
              <div className="text-pretty text-sm text-muted-foreground">
                {i18n._(option.description)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </OnboardingWrapper>
  );
}
