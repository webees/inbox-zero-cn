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
import { adminConvertGmailUrlAction } from "@/utils/actions/admin";
import {
  convertGmailUrlBody,
  type ConvertGmailUrlBody,
} from "@/utils/actions/admin.validation";
import { internalDateToDate } from "@/utils/date";

export function GmailUrlConverter() {
  const {
    execute: convertUrl,
    isExecuting,
    result,
  } = useAction(adminConvertGmailUrlAction, {
    onSuccess: () => {
      toastSuccess({ description: "找到邮件！" });
    },
    onError: ({ error }) => {
      toastError({
        title: "查找邮件时出错",
        description: error.serverError || "发生错误",
      });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConvertGmailUrlBody>({
    resolver: zodResolver(convertGmailUrlBody),
  });

  const onSubmit: SubmitHandler<ConvertGmailUrlBody> = useCallback(
    (data) => {
      convertUrl(data);
    },
    [convertUrl],
  );

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>邮件查找</CardTitle>
        <CardDescription>
          使用邮件头中的 RFC822 Message-ID 查找会话/消息 ID
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="text"
            name="rfc822MessageId"
            label="RFC822 Message-ID"
            placeholder="<abc123@email.example.com>"
            registerProps={register("rfc822MessageId")}
            error={errors.rfc822MessageId}
          />
          <Input
            type="email"
            name="email"
            label="邮箱地址"
            placeholder="user@example.com"
            registerProps={register("email")}
            error={errors.email}
          />
          <Button type="submit" loading={isExecuting}>
            查找
          </Button>
        </form>

        {result.data && (
          <div className="space-y-2">
            <div>
              <span className="text-sm font-medium">会话 ID： </span>
              <code className="text-sm">{result.data.threadId}</code>
            </div>
            <div>
              <span className="text-sm font-medium">消息： </span>
              <div className="space-y-1">
                {result.data.messages.map((msg) => (
                  <div key={msg.id} className="text-sm">
                    <code>{msg.id}</code>
                    {msg.date && (
                      <span className="ml-2 text-muted-foreground">
                        ({internalDateToDate(msg.date).toLocaleString()})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
