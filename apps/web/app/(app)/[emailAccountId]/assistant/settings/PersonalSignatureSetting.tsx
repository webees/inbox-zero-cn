"use client";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess, toastInfo } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingCard } from "@/components/SettingCard";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useAction } from "next-safe-action/hooks";
import { fetchSignaturesFromProviderAction } from "@/utils/actions/email-account";
import { saveSignatureAction } from "@/utils/actions/user";
import { createSettingActionErrorHandler } from "@/utils/actions/error-handling";
import type { EmailSignature } from "@/utils/email/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils";
import { isGoogleProvider } from "@/utils/email/provider-types";

export function PersonalSignatureSetting() {
  const { t } = useLingui();
  const { data, isLoading, error } = useEmailAccountFull();

  return (
    <SettingCard
      title={t`邮件签名`}
      description={t`设置邮件签名，以便包含在草稿消息中。`}
      right={
        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-8 w-32" />}
        >
          <SignatureDialog currentSignature={data?.signature || ""}>
            <Button variant="outline" size="sm">
              <Trans>编辑</Trans>
            </Button>
          </SignatureDialog>
        </LoadingContent>
      }
    />
  );
}

function SignatureDialog({
  children,
  currentSignature,
}: {
  children: React.ReactNode;
  currentSignature: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { emailAccountId, provider } = useAccount();
  const { mutate } = useEmailAccountFull();
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<string>("");
  const [manualSignature, setManualSignature] = useState(currentSignature);

  const isGmail = isGoogleProvider(provider);
  const providerName = isGmail ? "Gmail" : "Outlook";

  const { execute: executeSave, isExecuting: isSaving } = useAction(
    saveSignatureAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({
          description: t`Signature saved!`,
        });
        setOpen(false);
      },
      onError: createSettingActionErrorHandler({
        prefix: t`Failed to save signature`,
      }),
      onSettled: () => {
        mutate();
      },
    },
  );

  const { executeAsync: executeFetchSignatures, isExecuting: isFetching } =
    useAction(fetchSignaturesFromProviderAction.bind(null, emailAccountId));

  const handleLoadFromProvider = useCallback(async () => {
    const result = await executeFetchSignatures();

    if (result?.serverError) {
      toastError({
        title: t`从 ${providerName} 加载签名时出错`,
        description: result.serverError,
      });
      return;
    }

    const fetchedSignatures = result?.data?.signatures || [];

    if (fetchedSignatures.length === 0) {
      toastInfo({
        title: t`未找到签名`,
        description: isGmail
          ? t`在你的 Gmail 账号中未找到签名`
          : t`在最近的已发送邮件中未找到签名`,
      });
      return;
    }

    setSignatures(fetchedSignatures);

    // Auto-select the default/first signature and populate the textarea
    const defaultSig =
      fetchedSignatures.find((sig) => sig.isDefault) || fetchedSignatures[0];
    if (defaultSig) {
      setSelectedSignature(defaultSig.email);
      setManualSignature(defaultSig.signature);
    }

    toastSuccess({
      title: t`签名已加载`,
      description: t`Found ${plural(fetchedSignatures.length, {
        one: "# 个签名",
        other: "# 个签名",
      })}`,
    });
  }, [executeFetchSignatures, isGmail, providerName, t]);

  const handleSelectSignature = useCallback(
    (signatureEmail: string) => {
      setSelectedSignature(signatureEmail);
      const signature = signatures.find((sig) => sig.email === signatureEmail);
      if (signature) {
        setManualSignature(signature.signature);
      }
    },
    [signatures],
  );

  const handleSave = useCallback(() => {
    executeSave({ signature: manualSignature });
  }, [executeSave, manualSignature]);

  const handleClear = useCallback(() => {
    setManualSignature("");
    executeSave({ signature: "" });
  }, [executeSave]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>邮件签名</Trans>
          </DialogTitle>
          <DialogDescription>
            {isGmail ? (
              <Trans>
                设置邮件签名，以便包含在所有草稿消息中。你可以从 Gmail
                加载签名，也可以手动输入。
              </Trans>
            ) : (
              <Trans>
                设置邮件签名，以便包含在所有草稿消息中。对于
                Outlook，我们可以从最近的已发送邮件中提取，也可以手动输入。
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={handleLoadFromProvider}
              disabled={isFetching}
            >
              {isFetching ? (
                <Trans>加载中…</Trans>
              ) : (
                <Trans>从 {providerName} 加载</Trans>
              )}
            </Button>
            {signatures.length > 1 && (
              <Select
                value={selectedSignature}
                onValueChange={handleSelectSignature}
              >
                <SelectTrigger className="w-full sm:w-[250px]">
                  <SelectValue placeholder={t`选择签名`} />
                </SelectTrigger>
                <SelectContent>
                  {signatures.map((sig) => (
                    <SelectItem key={sig.email} value={sig.email}>
                      {sig.displayName || sig.email}
                      {sig.isDefault && (
                        <>
                          {" "}
                          <Trans>（默认）</Trans>
                        </>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="signature">
                <Trans>签名（支持 HTML）</Trans>
              </Label>
              <Textarea
                id="signature"
                value={manualSignature}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setManualSignature(e.target.value)
                }
                placeholder={t`输入你的邮件签名…`}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>
                <Trans>预览</Trans>
              </Label>
              <SignaturePreview signature={manualSignature} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClear}>
              <Trans>清空</Trans>
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Trans>保存中…</Trans> : <Trans>保存签名</Trans>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SignaturePreview({
  signature,
  className,
}: {
  signature: string;
  className?: string;
}) {
  const { t } = useLingui();
  const emptyPreview = t`你的签名预览将显示在这里…`;
  const previewHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        ${signature || `<em style="color: #888;">${emptyPreview}</em>`}
      </body>
    </html>
  `;

  return (
    <iframe
      title={t`Signature Preview`}
      sandbox="allow-same-origin"
      srcDoc={previewHtml}
      className={cn(
        "min-h-[200px] w-full rounded-md border border-input bg-muted/50",
        className,
      )}
    />
  );
}
