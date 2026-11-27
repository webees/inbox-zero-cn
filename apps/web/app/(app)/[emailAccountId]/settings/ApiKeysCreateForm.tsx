"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createApiKeyBody,
  type CreateApiKeyBody,
} from "@/utils/actions/api-key.validation";
import {
  createApiKeyAction,
  deactivateApiKeyAction,
} from "@/utils/actions/api-key";
import { toastError, toastSuccess } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { CopyInput } from "@/components/CopyInput";
import { SectionDescription } from "@/components/Typography";
import { Checkbox } from "@/components/ui/checkbox";
import {
  API_KEY_EXPIRY_OPTIONS,
  API_KEY_SCOPE_OPTIONS,
  DEFAULT_API_KEY_SCOPES,
} from "@/utils/api-key-scopes";
import {
  API_KEY_EXPIRY_MESSAGES,
  API_KEY_SCOPE_MESSAGES,
} from "./api-key-messages";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { useAccount } from "@/providers/EmailAccountProvider";

export function ApiKeysCreateButtonModal({ mutate }: { mutate: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Trans>创建密钥</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>创建新的密钥</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              这将为你的账号创建一个新的密钥。你需要使用此密钥来验证对 API
              的请求。
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <ApiKeysForm mutate={mutate} />
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysForm({ mutate }: { mutate: () => void }) {
  const { i18n, t } = useLingui();
  const [secretKey, setSecretKey] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<
    CreateApiKeyBody["scopes"]
  >(DEFAULT_API_KEY_SCOPES);
  const [expiresIn, setExpiresIn] =
    useState<CreateApiKeyBody["expiresIn"]>("90");
  const { emailAccountId: activeEmailAccountId } = useAccount();
  const { data: accountsData } = useAccounts();
  const emailAccounts = accountsData?.emailAccounts ?? [];
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );

  const emailAccountId =
    selectedAccountId ?? (activeEmailAccountId || emailAccounts[0]?.id || "");

  const { execute, isExecuting } = useAction(
    createApiKeyAction.bind(null, emailAccountId),
    {
      onSuccess: (result) => {
        if (!result?.data?.secretKey) {
          toastError({ description: t`Failed to create API key` });
          return;
        }

        setSecretKey(result.data.secretKey);
        toastSuccess({ description: t`API key created!` });
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: t`Failed to create API key`,
          }),
        });
      },
      onSettled: () => {
        mutate();
      },
    },
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateApiKeyBody>({
    resolver: zodResolver(createApiKeyBody),
    defaultValues: {
      scopes: DEFAULT_API_KEY_SCOPES,
      expiresIn: "90",
    },
  });

  const onSubmit = handleSubmit((data) => {
    execute({
      ...data,
      scopes: selectedScopes,
      expiresIn,
    });
  });

  const toggleScope = (
    scope: (typeof API_KEY_SCOPE_OPTIONS)[number]["value"],
    checked: boolean,
  ) => {
    setSelectedScopes((currentScopes) => {
      if (checked) return [...new Set([...currentScopes, scope])];
      return currentScopes.filter((currentScope) => currentScope !== scope);
    });
  };

  return !secretKey ? (
    <form onSubmit={onSubmit} className="space-y-4">
      {emailAccounts.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            <Trans>邮箱账号</Trans>
          </p>
          <Select value={emailAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger>
              <SelectValue placeholder={t`选择账号`} />
            </SelectTrigger>
            <SelectContent>
              {emailAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Input
        type="text"
        name="name"
        label={t`名称（可选）`}
        placeholder={t`我的 API 密钥`}
        registerProps={register("name")}
        error={errors.name}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium">
          <Trans>权限</Trans>
        </p>
        <div className="space-y-3 rounded-md border p-3">
          {API_KEY_SCOPE_OPTIONS.map((scope) => (
            <div key={scope.value} className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={selectedScopes.includes(scope.value)}
                onCheckedChange={(checked) =>
                  toggleScope(scope.value, checked === true)
                }
                aria-labelledby={`${scope.value}-label`}
              />
              <div className="space-y-1" id={`${scope.value}-label`}>
                <div className="font-medium">
                  {i18n._(API_KEY_SCOPE_MESSAGES[scope.value].label)}
                </div>
                <p className="text-muted-foreground">
                  {i18n._(API_KEY_SCOPE_MESSAGES[scope.value].description)}
                </p>
              </div>
            </div>
          ))}
        </div>
        {errors.scopes?.message ? (
          <p className="text-sm text-red-500">{errors.scopes.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          <Trans>有效期</Trans>
        </p>
        <Select
          value={expiresIn}
          onValueChange={(value: CreateApiKeyBody["expiresIn"]) =>
            setExpiresIn(value)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_KEY_EXPIRY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {i18n._(API_KEY_EXPIRY_MESSAGES[option.value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SectionDescription>
        <Trans>此密钥仅适用于所选收件箱账号。</Trans>
      </SectionDescription>

      <Button
        type="submit"
        loading={isExecuting}
        disabled={!emailAccountId || selectedScopes.length === 0}
      >
        <Trans>创建</Trans>
      </Button>
    </form>
  ) : (
    <div className="space-y-2">
      <SectionDescription>
        <Trans>此密钥仅显示一次。请复制保存。你的密钥为：</Trans>
      </SectionDescription>
      <CopyInput value={secretKey} />
    </div>
  );
}

export function ApiKeysDeactivateButton({
  id,
  emailAccountId,
  mutate,
}: {
  id: string;
  emailAccountId: string;
  mutate: () => void;
}) {
  const { t } = useLingui();
  const { execute, isExecuting } = useAction(
    deactivateApiKeyAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: t`API 密钥已停用！` });
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: t`停用 API 密钥失败`,
          }),
        });
      },
      onSettled: () => {
        mutate();
      },
    },
  );

  return (
    <Button
      variant="outline"
      size="sm"
      loading={isExecuting}
      disabled={!emailAccountId}
      onClick={() => execute({ id })}
    >
      <Trans>吊销</Trans>
    </Button>
  );
}
