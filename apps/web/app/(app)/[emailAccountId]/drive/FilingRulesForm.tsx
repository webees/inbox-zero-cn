"use client";

import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { toastSuccess, toastError } from "@/components/Toast";
import { updateFilingPromptAction } from "@/utils/actions/drive";
import {
  updateFilingPromptBody,
  type UpdateFilingPromptBody,
} from "@/utils/actions/drive.validation";
import { LoadingContent } from "@/components/LoadingContent";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";

export function FilingRulesForm({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { data, isLoading, error, mutate } = useEmailAccountFull();

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data && (
        <FilingRulesFormContent
          emailAccountId={emailAccountId}
          initialPrompt={data.filingPrompt || ""}
          mutateEmail={mutate}
        />
      )}
    </LoadingContent>
  );
}

function FilingRulesFormContent({
  emailAccountId,
  initialPrompt,
  mutateEmail,
}: {
  emailAccountId: string;
  initialPrompt: string;
  mutateEmail: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateFilingPromptBody>({
    resolver: zodResolver(updateFilingPromptBody),
    defaultValues: {
      filingPrompt: initialPrompt,
    },
  });

  const onSubmit: SubmitHandler<UpdateFilingPromptBody> = useCallback(
    async (data) => {
      const result = await updateFilingPromptAction(emailAccountId, data);

      if (result?.serverError) {
        toastError({
          title: "保存规则时出错",
          description: result.serverError,
        });
      } else {
        toastSuccess({ description: "归档规则已保存" });
        mutateEmail();
      }
    },
    [emailAccountId, mutateEmail],
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>归档规则</CardTitle>
        <CardDescription>我们应该如何整理你的文件？</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Input
            type="textarea"
            name="filingPrompt"
            placeholder="收据按月归入支出。合同归入法务。"
            registerProps={register("filingPrompt")}
            error={errors.filingPrompt}
            autosizeTextarea
            rows={3}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={isSubmitting}>
              保存
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
