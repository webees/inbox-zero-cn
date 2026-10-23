"use client";

import { KeyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateWebhookSecretAction } from "@/utils/actions/webhook";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAction } from "next-safe-action/hooks";
import { getActionErrorMessage } from "@/utils/error";

export function RegenerateSecretButton({
  hasSecret,
  mutate,
  onGenerated,
}: {
  hasSecret: boolean;
  mutate: () => void;
  onGenerated: (secret: string) => void;
}) {
  const { execute, isExecuting } = useAction(regenerateWebhookSecretAction, {
    onSuccess: ({ data }) => {
      if (!data?.webhookSecret) return;
      onGenerated(data.webhookSecret);
      toastSuccess({
        description: hasSecret
          ? "Webhook 密钥已重新生成。请立即复制，之后将不会再显示。"
          : "Webhook 密钥已生成。请立即复制，之后将不会再显示。",
      });
    },
    onError: (error) => {
      toastError({
        description: getActionErrorMessage(error.error),
      });
    },
    onSettled: () => {
      mutate();
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      loading={isExecuting}
      onClick={() => execute()}
    >
      <KeyIcon className="mr-2 size-4" />
      {hasSecret ? "重新生成密钥" : "生成密钥"}
    </Button>
  );
}
