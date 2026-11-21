"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import type { Properties } from "posthog-js";
import { survey } from "@/app/(landing)/welcome/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { env } from "@/env";
import {
  completedOnboardingAction,
  saveOnboardingAnswersAction,
} from "@/utils/actions/onboarding";
import { useOnboardingAnalytics } from "@/hooks/useAnalytics";
import { useSignUpEvent } from "@/hooks/useSignupEvent";
import { usePremium } from "@/hooks/usePremium";

const surveyId = env.NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_ID;

type Inputs = Record<"$survey_response" | `$survey_response_${number}`, string>;

export const OnboardingForm = (props: { questionIndex: number }) => {
  const { questionIndex } = props;

  const posthog = usePostHog();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showOtherInput, setShowOtherInput] = useState(false);
  const { isPremium } = usePremium();

  const analytics = useOnboardingAnalytics("welcome");
  const hasTrackedStart = useRef(false);

  useSignUpEvent();

  useEffect(() => {
    const currentQuestion = survey.questions[questionIndex];

    if (questionIndex === 0 && !hasTrackedStart.current) {
      hasTrackedStart.current = true;
      analytics.onStart({
        step: questionIndex + 1,
        stepKey: currentQuestion.key,
        totalSteps: survey.questions.length,
      });
    }

    analytics.onStepViewed({
      step: questionIndex + 1,
      stepKey: currentQuestion.key,
      totalSteps: survey.questions.length,
      isOptional: Boolean(currentQuestion.skippable),
    });
  }, [analytics, questionIndex]);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Inputs>();

  const name =
    questionIndex === 0
      ? "$survey_response"
      : (`$survey_response_${questionIndex}` as const);

  const isFinalQuestion = questionIndex === survey.questions.length - 1;
  const currentQuestion = survey.questions[questionIndex];

  const submitPosthog = useCallback(
    (responses: Properties) => {
      analytics.onComplete({
        step: questionIndex + 1,
        stepKey: currentQuestion.key,
        totalSteps: survey.questions.length,
        destination: isPremium ? "setup" : "welcome-upgrade",
      });
      // 基于索引的 `$survey_response` / `$survey_response_N` 键——仍支持旧版 PostHog
      // 格式。迁移到基于 ID 的键需要来自 PostHog 调查的问题 UUID，
      // 并且会破坏历史响应映射。
      if (!surveyId) return;
      posthog.capture("survey sent", { ...responses, $survey_id: surveyId });
    },
    [posthog, analytics, questionIndex, currentQuestion.key, isPremium],
  );

  const onSubmit: SubmitHandler<Inputs> = useCallback(
    async (data) => {
      const answer = data[name];

      // 请用户填写其他输入
      if (answer === "Other") {
        setShowOtherInput(true);
        setValue(name, "");
        return;
      }
      setShowOtherInput(false);

      const newSeachParams = new URLSearchParams(searchParams);
      newSeachParams.set("question", (questionIndex + 1).toString());
      newSeachParams.set(name, answer);

      const stepProperties = {
        step: questionIndex + 1,
        stepKey: currentQuestion.key,
        totalSteps: survey.questions.length,
        nextStep: isFinalQuestion ? undefined : questionIndex + 2,
        nextStepKey: survey.questions[questionIndex + 1]?.key,
        isOptional: Boolean(currentQuestion.skippable),
      };

      if (!answer && currentQuestion.skippable) {
        analytics.onSkip(stepProperties);
      } else {
        analytics.onNext(stepProperties);
      }

      const responses = getResponses(newSeachParams);
      await saveOnboardingAnswersAction({
        surveyId,
        questions: survey.questions,
        answers: responses,
      });

      // 在最后一个问题上提交
      if (isFinalQuestion) {
        submitPosthog(responses);
        await completedOnboardingAction();

        if (isPremium) {
          router.push("/setup");
        } else {
          router.push("/welcome-upgrade");
        }
      } else {
        router.push(`/welcome?${newSeachParams}`);
      }
    },
    [
      name,
      questionIndex,
      router,
      searchParams,
      submitPosthog,
      setValue,
      isFinalQuestion,
      analytics,
      currentQuestion.key,
      currentQuestion.skippable,
      isPremium,
    ],
  );

  const question = currentQuestion;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex justify-center">
      <div>
        <div className="my-4 text-lg">{question.question}</div>
        {question.choices && (
          <div className="grid gap-2">
            {question.choices?.map((answer) => (
              <Button
                key={answer}
                variant={
                  watch(name)?.includes(answer) ? "secondary" : "outline"
                }
                type="button"
                // 简易的单选按钮实现
                onClick={(e) => {
                  if (question.type === "multiple_choice") {
                    const values = new Set(getValues(name)?.split(","));
                    if (values.has(answer)) {
                      values.delete(answer);
                    } else {
                      values.add(answer);
                    }

                    const newValue = Array.from(values).join(",");
                    setValue(name, newValue);
                  } else {
                    setValue(name, answer);
                    handleSubmit(onSubmit)(e);
                  }
                }}
              >
                {answer === "Other" ? "其他" : answer}
              </Button>
            ))}

            {showOtherInput && (
              <Input
                type="text"
                name={name}
                registerProps={register(name)}
                error={errors[name]}
              />
            )}
          </div>
        )}
        {question.type === "open" && (
          <div>
            <Input
              type="text"
              autosizeTextarea
              rows={3}
              name={name}
              registerProps={register(name)}
              error={errors[name]}
              placeholder="可选"
            />
            <Button
              className="mt-4 w-full"
              type="submit"
              loading={isSubmitting}
            >
              开始使用
            </Button>
          </div>
        )}

        {(question.type === "multiple_choice" ||
          showOtherInput ||
          question.skippable) && (
          <Button className="mt-4 w-full" type="submit" loading={isSubmitting}>
            {question.skippable ? "跳过" : "下一步"}
          </Button>
        )}
      </div>
    </form>
  );
};

function getResponses(seachParams: URLSearchParams): Record<string, string> {
  const responses = survey.questions.reduce(
    (acc, _q, i) => {
      const name =
        i === 0 ? "$survey_response" : (`$survey_response_${i}` as const);
      acc[name] = seachParams.get(name) ?? "";
      return acc;
    },
    {} as Record<string, string>,
  );

  return responses;
}
