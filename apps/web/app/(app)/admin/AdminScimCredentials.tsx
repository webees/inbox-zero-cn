"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import {
  createScimConnectionAction,
  revokeScimCredentialAction,
} from "@/utils/actions/scim";
import { getActionErrorMessage } from "@/utils/error";

export function AdminScimCredentials() {
  const [credential, setCredential] = useState<{
    token: string;
    connectionId: string;
    credentialId: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{
    providerId: string;
    expiresAt: string;
  }>();
  const { execute, isExecuting } = useAction(createScimConnectionAction, {
    onSuccess: ({ data }) => {
      setCredential({
        token: data.token,
        connectionId: data.connection.connectionId,
        credentialId: data.credential.credentialId,
      });
    },
    onError: (error) =>
      toastError({
        title: "无法创建 SCIM 凭据",
        description: getActionErrorMessage(error.error),
      }),
  });

  return (
    <section aria-labelledby="scim-heading" className="max-w-xl space-y-4">
      <h2 id="scim-heading" className="text-lg font-semibold">
        SCIM 配置
      </h2>
      <p className="text-sm text-muted-foreground">
        为已注册的组织 SSO
        提供商创建连接。请妥善保存令牌和标识符；令牌只显示一次。
      </p>
      <form
        className="space-y-3"
        onSubmit={handleSubmit(({ providerId, expiresAt }) =>
          execute({
            providerId,
            expiresAt: new Date(expiresAt),
            creationRequestId: crypto.randomUUID(),
          }),
        )}
      >
        <Input
          name="scim-provider"
          label="SSO 提供商 ID"
          type="text"
          registerProps={register("providerId", { required: true })}
          error={errors.providerId}
        />
        <Input
          name="scim-expiry"
          label="凭据过期时间"
          type="datetime-local"
          registerProps={register("expiresAt", { required: true })}
          error={errors.expiresAt}
        />
        <Button type="submit" loading={isExecuting} disabled={!!credential}>
          创建 SCIM 连接
        </Button>
      </form>
      {credential && (
        <div className="space-y-2 rounded-md border p-4">
          <label
            htmlFor="scim-issued-credential"
            className="text-sm font-medium"
          >
            新的 SCIM 凭据——离开前请先保存
          </label>
          <textarea
            id="scim-issued-credential"
            className="w-full rounded border p-2 text-sm"
            rows={6}
            readOnly
            value={`Bearer 令牌：${credential.token}\n连接 ID：${credential.connectionId}\n凭据 ID：${credential.credentialId}`}
          />
          <Button variant="outline" onClick={() => setCredential(null)}>
            从屏幕清除已保存的凭据
          </Button>
        </div>
      )}
      <RevokeScimCredentialForm />
    </section>
  );
}

function RevokeScimCredentialForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{
    providerId: string;
    connectionId: string;
    credentialId: string;
  }>();
  const { execute, isExecuting } = useAction(revokeScimCredentialAction, {
    onSuccess: () => {
      reset();
      toastSuccess({ description: "SCIM 凭据已撤销" });
    },
    onError: (error) =>
      toastError({
        title: "无法撤销 SCIM 凭据",
        description: getActionErrorMessage(error.error),
      }),
  });
  return (
    <form className="space-y-3 border-t pt-4" onSubmit={handleSubmit(execute)}>
      <h3 className="font-medium">撤销凭据</h3>
      <Input
        name="scim-revoke-provider"
        label="要撤销的 SSO 提供商 ID"
        type="text"
        registerProps={register("providerId", { required: true })}
        error={errors.providerId}
      />
      <Input
        name="scim-revoke-connection"
        label="连接 ID"
        type="text"
        registerProps={register("connectionId", { required: true })}
        error={errors.connectionId}
      />
      <Input
        name="scim-revoke-credential"
        label="凭据 ID"
        type="text"
        registerProps={register("credentialId", { required: true })}
        error={errors.credentialId}
      />
      <Button type="submit" variant="destructive" loading={isExecuting}>
        撤销 SCIM 凭据
      </Button>
    </form>
  );
}
