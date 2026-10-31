"use client";

import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/Input";
import { toastError } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { adminGetUserInfoAction } from "@/utils/actions/admin";
import {
  getUserInfoBody,
  type GetUserInfoBody,
} from "@/utils/actions/admin.validation";

export function AdminUserInfo() {
  const { execute, isExecuting, result } = useAction(adminGetUserInfoAction, {
    onError: (error) => {
      toastError({
        title: "查找用户时出错",
        description: getActionErrorMessage(error.error),
      });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GetUserInfoBody>({
    resolver: zodResolver(getUserInfoBody),
  });

  const onSubmit: SubmitHandler<GetUserInfoBody> = useCallback(
    (data) => {
      execute({ email: data.email });
    },
    [execute],
  );

  const data = result.data;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>用户信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            type="email"
            name="email"
            label="邮箱"
            placeholder="user@example.com"
            registerProps={register("email")}
            error={errors.email}
          />
          <Button type="submit" loading={isExecuting}>
            查找
          </Button>
        </form>

        {data && (
          <div className="space-y-3 text-sm">
            <InfoRow label="用户 ID" value={data.id} />
            <InfoRow label="创建时间" value={formatDate(data.createdAt)} />
            <InfoRow
              label="最后登录"
              value={data.lastLogin ? formatDate(data.lastLogin) : "从未"}
            />
            <InfoRow label="邮箱账号" value={String(data.emailAccountCount)} />
            <InfoRow label="高级版套餐" value={data.premium?.tier || "无"} />
            <InfoRow
              label="管理员授予套餐"
              value={data.premium?.adminGrantTier || "无"}
            />
            <InfoRow
              label="管理员授予到期时间"
              value={
                data.premium?.adminGrantExpiresAt
                  ? formatDate(data.premium.adminGrantExpiresAt)
                  : "不适用"
              }
            />
            <InfoRow
              label="订阅状态"
              value={data.premium?.subscriptionStatus || "不适用"}
            />
            <InfoRow
              label="续订时间"
              value={
                data.premium?.renewsAt
                  ? formatDate(data.premium.renewsAt)
                  : "不适用"
              }
            />

            {data.emailAccounts.map((ea) => (
              <div key={ea.email} className="space-y-1 rounded-md border p-3">
                <p className="font-medium">{ea.email}</p>
                <InfoRow label="提供商" value={ea.provider} />
                <InfoRow label="已断开" value={ea.disconnected ? "是" : "否"} />
                <InfoRow label="规则" value={String(ea.ruleCount)} />
                <InfoRow
                  label="上次执行规则时间"
                  value={
                    ea.lastExecutedRuleAt
                      ? formatDate(ea.lastExecutedRuleAt)
                      : "从未"
                  }
                />
                <InfoRow
                  label="监听过期时间"
                  value={
                    ea.watchExpirationDate
                      ? formatDate(ea.watchExpirationDate)
                      : "未监听"
                  }
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
