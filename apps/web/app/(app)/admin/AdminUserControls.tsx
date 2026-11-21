"use client";

import { type ChangeEvent, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import {
  adminProcessHistorySchema,
  type AdminProcessHistoryOptions,
} from "@/app/(app)/admin/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  adminDeleteAccountAction,
  adminProcessHistoryAction,
  adminWatchEmailsAction,
  adminDisableAllRulesAction,
  adminCleanupDraftsAction,
  adminLoadResponseTimeDataAction,
  adminSyncAppleSubscriptionForUserAction,
  adminSyncStripeForUserAction,
} from "@/utils/actions/admin";
import { adminCheckPermissionsAction } from "@/utils/actions/permissions";
import { toastError, toastSuccess } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";

export const AdminUserControls = () => {
  const [responseTimeMaxSentMessages, setResponseTimeMaxSentMessages] =
    useState(500);
  const [appleOriginalTransactionId, setAppleOriginalTransactionId] =
    useState("");

  const { execute: processHistory, isExecuting: isProcessing } = useAction(
    adminProcessHistoryAction,
    {
      onSuccess: () => {
        toastSuccess({
          title: "历史记录已处理",
          description: "历史记录已处理",
        });
      },
      onError: () => {
        toastError({
          title: "处理历史记录时出错",
          description: "处理历史记录时出错",
        });
      },
    },
  );
  const { execute: checkPermissions, isExecuting: isCheckingPermissions } =
    useAction(adminCheckPermissionsAction, {
      onSuccess: (result) => {
        toastSuccess({
          title: "权限已检查",
          description: `权限已检查。${
            result.data?.hasAllPermissions ? "拥有所有权限" : "缺少权限"
          }`,
        });
      },
      onError: (error) => {
        console.error(error);
        toastError({
          title: "检查权限时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    });
  const { execute: watchEmails, isExecuting: isWatching } = useAction(
    adminWatchEmailsAction,
    {
      onSuccess: (result) => {
        const results = result.data?.results || [];
        const successCount = results.filter(
          (r) => r.status === "success",
        ).length;
        const errorCount = results.filter((r) => r.status === "error").length;
        const description =
          successCount > 0
            ? `${successCount} 个成功，${errorCount} 个失败`
            : errorCount > 0
              ? `0 个成功，${errorCount} 个失败`
              : "未找到可监听的邮箱账号";
        toastSuccess({
          title: "监听完成",
          description,
        });
      },
      onError: (error) => {
        toastError({
          title: "监听邮件时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );
  const { execute: syncStripe, isExecuting: isSyncingStripe } = useAction(
    adminSyncStripeForUserAction,
    {
      onSuccess: (result) => {
        toastSuccess({
          title: "Stripe 已同步",
          description: `状态：${result.data?.stripeSubscriptionStatus ?? "无"}`,
        });
      },
      onError: (error) => {
        toastError({
          title: "同步 Stripe 时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );
  const { execute: syncApple, isExecuting: isSyncingApple } = useAction(
    adminSyncAppleSubscriptionForUserAction,
    {
      onSuccess: (result) => {
        toastSuccess({
          title: "Apple 已同步",
          description: `状态：${result.data?.appleSubscriptionStatus ?? "无"}；套餐：${result.data?.tier ?? "无"}`,
        });
      },
      onError: (error) => {
        toastError({
          title: "同步 Apple 时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );
  const { execute: disableRules, isExecuting: isDisablingRules } = useAction(
    adminDisableAllRulesAction,
    {
      onSuccess: (result) => {
        toastSuccess({
          title: "规则已禁用",
          description: `已为 ${result.data?.emailAccountCount} 个账号禁用规则和跟进`,
        });
      },
      onError: (error) => {
        toastError({
          title: "禁用规则时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );
  const { execute: cleanupDrafts, isExecuting: isCleaningDrafts } = useAction(
    adminCleanupDraftsAction,
    {
      onSuccess: (result) => {
        toastSuccess({
          title: "草稿已清理",
          description: `已删除 ${result.data?.deleted ?? 0} 个草稿，跳过 ${result.data?.skippedModified ?? 0} 个已修改的`,
        });
      },
      onError: (error) => {
        toastError({
          title: "清理草稿时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );
  const { execute: loadResponseTimes, isExecuting: isLoadingResponseTimes } =
    useAction(adminLoadResponseTimeDataAction, {
      onSuccess: (result) => {
        toastSuccess({
          title: "回复时间已加载",
          description: `已分析 ${result.data?.emailsAnalyzed ?? 0} 封邮件，上限为 ${result.data?.maxEmailsCap ?? responseTimeMaxSentMessages}`,
        });
      },
      onError: (error) => {
        toastError({
          title: "加载回复时间时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    });
  const { execute: deleteAccount, isExecuting: isDeleting } = useAction(
    adminDeleteAccountAction,
    {
      onSuccess: () => {
        toastSuccess({
          title: "用户已删除",
          description: "用户已删除",
        });
      },
      onError: (error) => {
        toastError({
          title: "删除用户时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );

  const {
    register,
    formState: { errors },
    getValues,
  } = useForm<AdminProcessHistoryOptions>({
    resolver: zodResolver(adminProcessHistorySchema),
  });

  return (
    <form className="max-w-sm space-y-4">
      <Input
        type="email"
        name="email"
        label="邮箱"
        registerProps={register("email", { required: true })}
        error={errors.email}
      />
      <Input
        type="number"
        name="responseTimeMaxSentMessages"
        label="回复时间已发送邮件数"
        min={1}
        max={2000}
        step={50}
        registerProps={{
          value: responseTimeMaxSentMessages,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            setResponseTimeMaxSentMessages(Number(event.target.value)),
        }}
      />
      <Input
        type="text"
        name="appleOriginalTransactionId"
        label="Apple 原始交易 ID"
        placeholder="200000000000000"
        registerProps={{
          value: appleOriginalTransactionId,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            setAppleOriginalTransactionId(event.target.value),
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          loading={isProcessing}
          onClick={() => {
            processHistory({ emailAddress: getValues("email") });
          }}
        >
          处理历史记录
        </Button>
        <Button
          variant="outline"
          loading={isCheckingPermissions}
          onClick={() => {
            checkPermissions({ email: getValues("email") });
          }}
        >
          检查权限
        </Button>
        <Button
          variant="outline"
          loading={isWatching}
          onClick={() => {
            watchEmails({ email: getValues("email") });
          }}
        >
          监听
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={isSyncingStripe}
          onClick={() => {
            syncStripe({ email: getValues("email") });
          }}
        >
          同步 Stripe
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={isSyncingApple}
          onClick={() => {
            syncApple({
              email: getValues("email"),
              transactionId: appleOriginalTransactionId,
            });
          }}
        >
          同步 Apple
        </Button>
        <Button
          variant="outline"
          loading={isDisablingRules}
          onClick={() => {
            disableRules({ email: getValues("email") });
          }}
        >
          禁用规则
        </Button>
        <Button
          variant="outline"
          loading={isCleaningDrafts}
          onClick={() => {
            cleanupDrafts({ email: getValues("email") });
          }}
        >
          清理草稿
        </Button>
        <Button
          variant="outline"
          loading={isLoadingResponseTimes}
          onClick={() => {
            loadResponseTimes({
              email: getValues("email"),
              maxSentMessages: responseTimeMaxSentMessages,
            });
          }}
        >
          加载回复时间
        </Button>
        <Button
          variant="destructive"
          loading={isDeleting}
          onClick={() => {
            deleteAccount({ email: getValues("email") });
          }}
        >
          删除用户
        </Button>
      </div>
    </form>
  );
};
