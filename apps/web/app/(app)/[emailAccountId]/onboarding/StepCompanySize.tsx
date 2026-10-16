"use client";

import {
  Building2,
  Users,
  Building,
  Factory,
  Landmark,
  User,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { useCallback } from "react";
import { saveOnboardingAnswersAction } from "@/utils/actions/onboarding";
import { toastError } from "@/components/Toast";
import { OnboardingButton } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingButton";
import { captureException, getActionErrorMessage } from "@/utils/error";

const COMPANY_SIZES = [
  {
    value: 1,
    label: "只有我",
    icon: <User className="size-4" />,
  },
  {
    value: 5,
    label: "2-10 人",
    icon: <Users className="size-4" />,
  },
  {
    value: 50,
    label: "11-100 人",
    icon: <Building className="size-4" />,
  },
  {
    value: 500,
    label: "101-1000 人",
    icon: <Factory className="size-4" />,
  },
  {
    value: 1000,
    label: "1000+ 人",
    icon: <Landmark className="size-4" />,
  },
];

export function StepCompanySize({ onNext }: { onNext: () => void }) {
  const { executeAsync: saveCompanySize } = useAction(
    saveOnboardingAnswersAction,
  );

  const onSelectCompanySize = useCallback(
    (companySize: number) => {
      onNext();

      saveCompanySize({
        surveyId: "onboarding",
        questions: [{ key: "company_size", type: "single_choice" }],
        answers: { $survey_response: companySize },
      })
        .then((result) => {
          if (result?.serverError || result?.validationErrors) {
            captureException(new Error("保存引导流程的公司规模失败"), {
              extra: {
                context: "onboarding",
                step: "company_size",
                serverError: result?.serverError,
                validationErrors: result?.validationErrors,
              },
            });
            toastError({
              description: getActionErrorMessage(
                {
                  serverError: result?.serverError,
                  validationErrors: result?.validationErrors,
                },
                {
                  prefix: "无法保存该答案，但你可以继续",
                },
              ),
            });
          }
        })
        .catch((error) => {
          captureException(error, {
            extra: {
              context: "onboarding",
              step: "company_size",
            },
          });
          toastError({
            description: "无法保存该答案，但你可以继续。",
          });
        });
    },
    [onNext, saveCompanySize],
  );

  return (
    <OnboardingWrapper className="py-0">
      <IconCircle size="lg" className="mx-auto">
        <Building2 className="size-6" />
      </IconCircle>

      <div className="text-center mt-4">
        <PageHeading>你的公司规模有多大？</PageHeading>
        <TypographyP className="mt-2 max-w-lg mx-auto">
          这有助于我们根据你组织的需求定制体验。
        </TypographyP>
      </div>

      <div className="mt-6 grid gap-3">
        {COMPANY_SIZES.map((size) => (
          <OnboardingButton
            key={size.value}
            text={size.label}
            icon={size.icon}
            onClick={() => onSelectCompanySize(size.value)}
          />
        ))}
      </div>
    </OnboardingWrapper>
  );
}
