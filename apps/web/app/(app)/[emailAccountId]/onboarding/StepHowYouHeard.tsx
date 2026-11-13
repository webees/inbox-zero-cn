"use client";

import {
  ArrowRightIcon,
  Megaphone,
  Users,
  Search,
  Sparkles,
  MoreHorizontal,
} from "lucide-react";
import {
  FacebookIcon,
  GithubIcon,
  LinkedinIcon,
  RedditIcon,
  TwitterIcon,
  YoutubeIcon,
} from "@/components/BrandIcons";
import { useAction } from "next-safe-action/hooks";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { OnboardingButton } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingButton";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import { saveOnboardingAnswersAction } from "@/utils/actions/onboarding";
import { toastError } from "@/components/Toast";
import { captureException, getActionErrorMessage } from "@/utils/error";

const OTHER_VALUE = "other";

const SOURCES = [
  {
    value: "search",
    label: msg`搜索`,
    icon: <Search className="size-4" />,
  },
  {
    value: "llm",
    label: msg`ChatGPT、Claude 或其他 AI`,
    icon: <Sparkles className="size-4" />,
  },
  {
    value: "friend",
    label: msg`朋友或同事`,
    icon: <Users className="size-4" />,
  },
  {
    value: "youtube",
    label: "YouTube",
    icon: <YoutubeIcon className="size-4" />,
  },
  {
    value: "twitter",
    label: "Twitter / X",
    icon: <TwitterIcon className="size-4" />,
  },
  {
    value: "linkedin",
    label: "LinkedIn",
    icon: <LinkedinIcon className="size-4" />,
  },
  {
    value: "reddit",
    label: "Reddit",
    icon: <RedditIcon className="size-4" />,
  },
  {
    value: "facebook",
    label: "Facebook",
    icon: <FacebookIcon className="size-4" />,
  },
  {
    value: "github",
    label: "GitHub",
    icon: <GithubIcon className="size-4" />,
  },
  {
    value: OTHER_VALUE,
    label: msg`其他`,
    icon: <MoreHorizontal className="size-4" />,
  },
];

export function StepHowYouHeard({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useLingui();
  const { executeAsync: saveSource } = useAction(saveOnboardingAnswersAction);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [customSource, setCustomSource] = useState("");

  const submitSource = useCallback(
    (source: string) => {
      onNext();

      saveSource({
        surveyId: "onboarding",
        questions: [{ key: "source", type: "single_choice" }],
        answers: { $survey_response: source },
      })
        .then((result) => {
          if (result?.serverError || result?.validationErrors) {
            captureException(new Error("保存引导流程来源失败"), {
              extra: {
                context: "onboarding",
                step: "source",
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
                  prefix: t`我们无法保存该回答，但你可以继续`,
                },
              ),
            });
          }
        })
        .catch((error) => {
          captureException(error, {
            extra: { context: "onboarding", step: "source" },
          });
          toastError({
            description: t`我们无法保存该回答，但你可以继续。`,
          });
        });
    },
    [onNext, saveSource, t],
  );

  const onSelectSource = useCallback(
    (value: string) => {
      if (value === OTHER_VALUE) {
        setShowOtherInput(true);
        return;
      }
      submitSource(value);
    },
    [submitSource],
  );

  return (
    <OnboardingWrapper className="py-0">
      <IconCircle size="lg" className="mx-auto">
        <Megaphone className="size-6" />
      </IconCircle>

      <div className="text-center mt-4">
        <PageHeading>
          <Trans>你是怎么知道 Inbox Zero 的？</Trans>
        </PageHeading>
        <TypographyP className="mt-2 max-w-lg mx-auto">
          <Trans>我们很想了解你是如何找到我们的。</Trans>
        </TypographyP>
      </div>

      <div className="mt-6 grid gap-3">
        {SOURCES.map((source) => (
          <OnboardingButton
            key={source.value}
            text={
              typeof source.label === "string"
                ? source.label
                : i18n._(source.label)
            }
            icon={source.icon}
            onClick={() => onSelectSource(source.value)}
          />
        ))}
      </div>

      {showOtherInput && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitSource(`other: ${customSource.trim()}`);
          }}
        >
          <Input
            name="customSource"
            type="text"
            placeholder={t`你在哪里听说我们的？`}
            registerProps={{
              value: customSource,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                setCustomSource(event.target.value),
              autoFocus: true,
            }}
          />
          <div className="flex w-full max-w-xs mx-auto">
            <Button
              type="submit"
              className="w-full"
              disabled={!customSource.trim()}
            >
              <Trans>继续</Trans>
              <ArrowRightIcon className="size-4 ml-2" />
            </Button>
          </div>
        </form>
      )}
    </OnboardingWrapper>
  );
}
