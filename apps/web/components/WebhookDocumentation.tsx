"use client";

import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MutedText } from "@/components/Typography";

export function WebhookDocumentationDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Webhook 载荷</Trans>
          </DialogTitle>
        </DialogHeader>
        <WebhookPayloadDocumentation />
      </DialogContent>
    </Dialog>
  );
}

export function WebhookPayloadDocumentation() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("复制文本失败：", err);
    }
  };

  const payloadExample = {
    email: {
      threadId: "thread_abc123",
      messageId: "message_xyz789",
      subject: "重要合同文件",
      from: "client@company.com",
      cc: "team@company.com",
      bcc: "archive@company.com",
      headerMessageId: "<CAF=4sK9...@mail.gmail.com>",
    },
    executedRule: {
      id: "exec_rule_123",
      ruleId: "rule_456",
      reason: "邮件匹配规则：归档合同",
      automated: true,
      createdAt: "2024-01-15T10:30:00.000Z",
    },
  };

  const payloadJson = JSON.stringify(payloadExample, null, 2);

  return (
    <div className="space-y-4">
      <MutedText>
        <Trans>
          当带有 Webhook 操作的规则触发时，我们会向你的 URL 发送包含以下载荷的
          POST 请求：
        </Trans>
      </MutedText>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">
            <Trans>Webhook 载荷结构</Trans>
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(payloadJson)}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
          <code>{payloadJson}</code>
        </pre>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h5 className="font-medium mb-2">
              <Trans>邮件字段</Trans>
            </h5>
            <div className="space-y-1">
              <MutedText>
                <Trans>
                  <code>threadId</code> - Gmail/Outlook 会话 ID
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>messageId</code> - 唯一消息 ID
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>subject</code> - 邮件主题
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>from</code> - 发件人邮箱地址
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>cc/bcc</code> - 可选的抄送/密送收件人
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>headerMessageId</code> - 邮件 Message-ID 标头
                </Trans>
              </MutedText>
            </div>
          </div>

          <div>
            <h5 className="font-medium mb-2">
              <Trans>规则执行字段</Trans>
            </h5>
            <div className="space-y-1">
              <MutedText>
                <Trans>
                  <code>id</code> - 执行 ID
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>ruleId</code> - 被触发的规则
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>reason</code> - 规则被触发的原因
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>automated</code> - 规则是否自动运行
                </Trans>
              </MutedText>
              <MutedText>
                <Trans>
                  <code>createdAt</code> - 规则执行时间（ISO 8601）
                </Trans>
              </MutedText>
            </div>
          </div>
        </div>

        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md">
          <div className="text-sm text-blue-600 dark:text-blue-400">
            <Trans>
              <strong>身份验证：</strong>每个请求都会包含带有你的 Webhook 密钥的{" "}
              <code>X-Webhook-Secret</code> 标头，用于验证。
            </Trans>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebhookDocumentationLink() {
  return (
    <WebhookDocumentationDialog>
      <Button
        variant="link"
        size="xs"
        className="h-auto p-0 text-xs text-blue-600 hover:text-blue-800"
      >
        <Trans>查看载荷结构</Trans>
      </Button>
    </WebhookDocumentationDialog>
  );
}
