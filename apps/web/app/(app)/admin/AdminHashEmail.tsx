"use client";

import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/Input";
import { toastSuccess, toastError } from "@/components/Toast";
import { adminHashEmailAction } from "@/utils/actions/admin";
import {
  hashEmailBody,
  type HashEmailBody,
} from "@/utils/actions/admin.validation";

export const AdminHashEmail = () => {
  const {
    execute: hashEmail,
    isExecuting,
    result,
  } = useAction(adminHashEmailAction, {
    onError: ({ error }) => {
      toastError({
        description: `哈希值出错：${error.serverError}`,
      });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<HashEmailBody>({
    resolver: zodResolver(hashEmailBody),
  });

  const onSubmit: SubmitHandler<HashEmailBody> = useCallback(
    (data) => {
      hashEmail({ email: data.email });
    },
    [hashEmail],
  );

  const copyToClipboard = () => {
    if (result.data?.hash) {
      navigator.clipboard.writeText(result.data.hash);
      toastSuccess({
        description: "哈希值已复制到剪贴板",
      });
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>日志搜索哈希</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="text"
            name="email"
            label="要哈希的值"
            placeholder="user@example.com"
            registerProps={register("email")}
            error={errors.email}
          />

          <Button type="submit" loading={isExecuting}>
            生成哈希
          </Button>

          {result.data?.hash && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  name="hashedValue"
                  label="哈希后的值"
                  registerProps={{
                    value: result.data.hash,
                    readOnly: true,
                  }}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyToClipboard}
                >
                  复制
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
};
