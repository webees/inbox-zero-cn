"use client";

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
import { isGoogleProvider } from "@/utils/email/provider-types";

export function PersonalSignatureSetting() {
  const { data, isLoading, error } = useEmailAccountFull();

  return (
    <SettingCard
      title="邮件签名"
      description="设置你的邮件签名，以包含在起草的邮件中。"
      right={
        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-8 w-32" />}
        >
          <SignatureDialog currentSignature={data?.signature || ""}>
            <Button variant="outline" size="sm">
              编辑
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
  const [open, setOpen] = useState(false);
  const { emailAccountId, provider } = useAccount();
  const { mutate } = useEmailAccountFull();
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<string>("");
  const [manualSignature, setManualSignature] = useState(currentSignature);

  const isGmail = isGoogleProvider(provider);

  const { execute: executeSave, isExecuting: isSaving } = useAction(
    saveSignatureAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({
          description: "签名已保存！",
        });
        setOpen(false);
      },
      onError: createSettingActionErrorHandler({
        prefix: "保存签名失败",
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
        title: `从 ${isGmail ? "Gmail" : "Outlook"} 加载签名时出错`,
        description: result.serverError,
      });
      return;
    }

    const fetchedSignatures = result?.data?.signatures || [];

    if (fetchedSignatures.length === 0) {
      toastInfo({
        title: "未找到签名",
        description: isGmail
          ? "在你的 Gmail 账号中未找到签名"
          : "在最近发送的邮件中未找到签名",
      });
      return;
    }

    setSignatures(fetchedSignatures);

    // 自动选择默认/第一个签名并填充文本框
    const defaultSig =
      fetchedSignatures.find((sig) => sig.isDefault) || fetchedSignatures[0];
    if (defaultSig) {
      setSelectedSignature(defaultSig.email);
      setManualSignature(defaultSig.signature);
    }

    toastSuccess({
      title: "签名已加载",
      description: `找到 ${fetchedSignatures.length} 个签名`,
    });
  }, [executeFetchSignatures, isGmail]);

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
          <DialogTitle>邮件签名</DialogTitle>
          <DialogDescription>
            设置你的邮件签名，以包含在所有起草的邮件中。
            {isGmail && " 你可以从 Gmail 加载签名，或手动输入。"}
            {!isGmail &&
              " 对于 Outlook，我们可以从最近发送的邮件中提取，你也可以手动输入。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={handleLoadFromProvider}
              disabled={isFetching}
            >
              {isFetching
                ? "加载中…"
                : `从 ${isGmail ? "Gmail" : "Outlook"} 加载`}
            </Button>
            {signatures.length > 1 && (
              <Select
                value={selectedSignature}
                onValueChange={handleSelectSignature}
              >
                <SelectTrigger className="w-full sm:w-[250px]">
                  <SelectValue placeholder="选择签名" />
                </SelectTrigger>
                <SelectContent>
                  {signatures.map((sig) => (
                    <SelectItem key={sig.email} value={sig.email}>
                      {sig.displayName || sig.email}
                      {sig.isDefault && "（默认）"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="signature">签名（支持 HTML）</Label>
              <Textarea
                id="signature"
                value={manualSignature}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setManualSignature(e.target.value)
                }
                placeholder="输入你的邮件签名…"
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>预览</Label>
              <SignaturePreview signature={manualSignature} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClear}>
              清除
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "保存中…" : "保存签名"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignaturePreview({ signature }: { signature: string }) {
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
        ${signature || '<em style="color: #888;">在此处显示你的签名预览…</em>'}
      </body>
    </html>
  `;

  return (
    <iframe
      title="签名预览"
      sandbox="allow-same-origin"
      srcDoc={previewHtml}
      className="min-h-[200px] w-full rounded-md border border-input bg-muted/50"
    />
  );
}
