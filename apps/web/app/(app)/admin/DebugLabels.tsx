"use client";

import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toastSuccess, toastError } from "@/components/Toast";
import { adminGetLabelsAction } from "@/utils/actions/admin";
import {
  getLabelsBody,
  type GetLabelsBody,
} from "@/utils/actions/admin.validation";

export function DebugLabels() {
  const { execute, isExecuting, result } = useAction(adminGetLabelsAction, {
    onSuccess: () => {
      toastSuccess({ description: "找到标签！" });
    },
    onError: ({ error }) => {
      toastError({
        title: "获取标签时出错",
        description: error.serverError || "发生错误",
      });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GetLabelsBody>({
    resolver: zodResolver(getLabelsBody),
  });

  const onSubmit: SubmitHandler<GetLabelsBody> = useCallback(
    (data) => {
      execute(data);
    },
    [execute],
  );

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>调试标签</CardTitle>
        <CardDescription>获取邮箱账号的所有标签</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="text"
            name="emailAccountId"
            label="邮箱账号 ID"
            placeholder="邮箱账号 ID"
            registerProps={register("emailAccountId")}
            error={errors.emailAccountId}
          />
          <Button type="submit" loading={isExecuting}>
            获取标签
          </Button>
        </form>

        {result.data && (
          <pre className="text-sm">{JSON.stringify(result.data, null, 2)}</pre>
        )}
      </CardContent>
    </Card>
  );
}
