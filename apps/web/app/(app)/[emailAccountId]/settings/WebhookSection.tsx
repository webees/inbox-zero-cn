"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { CopyInput } from "@/components/CopyInput";
import { RegenerateSecretButton } from "@/app/(app)/[emailAccountId]/settings/WebhookGenerate";
import { useUser } from "@/hooks/useUser";
import { LoadingContent } from "@/components/LoadingContent";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { env } from "@/env";

export function WebhookSection() {
  if (env.NEXT_PUBLIC_WEBHOOK_ACTION_ENABLED === false) return null;

  return <WebhookSectionContent />;
}

function WebhookSectionContent() {
  const { t } = useLingui();
  const { data, isLoading, error, mutate } = useUser();
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          <Trans>Webhook Secret</Trans>
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setGeneratedSecret(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {data?.hasWebhookSecret ? t`管理密钥` : t`生成密钥`}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <Trans>Webhook 密钥</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  设置 Webhook 端点时，请将此密钥包含在 X-Webhook-Secret header
                  中。现有密钥不会再次显示。生成新密钥后，请在关闭此对话框前复制它。
                </Trans>
              </DialogDescription>
            </DialogHeader>
            <LoadingContent loading={isLoading} error={error}>
              {data && (
                <div className="space-y-4">
                  {generatedSecret ? (
                    <CopyInput value={generatedSecret} masked />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        生成新的 Webhook 密钥，以便显示一次供你复制。
                      </Trans>
                    </p>
                  )}
                  <RegenerateSecretButton
                    hasSecret={data.hasWebhookSecret}
                    mutate={mutate}
                    onGenerated={setGeneratedSecret}
                  />
                </div>
              )}
            </LoadingContent>
          </DialogContent>
        </Dialog>
      </ItemActions>
    </Item>
  );
}
