"use client";

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
          <DialogTitle>Webhook 载荷</DialogTitle>
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
      console.error("Failed to copy text: ", err);
    }
  };

  const payloadExample = {
    email: {
      threadId: "thread_abc123",
      messageId: "message_xyz789",
      subject: "重要合同文档",
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
        当带 Webhook 操作的规则被触发时，我们会向你的 URL 发送一个 POST
        请求，载荷如下：
      </MutedText>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Webhook 载荷结构</h4>
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
            <h5 className="font-medium mb-2">邮件字段</h5>
            <div className="space-y-1">
              <MutedText>
                <code>threadId</code> - Gmail/Outlook 会话 ID
              </MutedText>
              <MutedText>
                <code>messageId</code> - 唯一的邮件 ID
              </MutedText>
              <MutedText>
                <code>subject</code> - 邮件主题
              </MutedText>
              <MutedText>
                <code>from</code> - 发件人邮箱地址
              </MutedText>
              <MutedText>
                <code>cc/bcc</code> - 可选的抄送/密送收件人
              </MutedText>
              <MutedText>
                <code>headerMessageId</code> - 邮件的 Message-ID 头
              </MutedText>
            </div>
          </div>

          <div>
            <h5 className="font-medium mb-2">规则执行字段</h5>
            <div className="space-y-1">
              <MutedText>
                <code>id</code> - 执行 ID
              </MutedText>
              <MutedText>
                <code>ruleId</code> - 被触发的规则
              </MutedText>
              <MutedText>
                <code>reason</code> - 规则被触发的原因
              </MutedText>
              <MutedText>
                <code>automated</code> - 规则是否为自动运行
              </MutedText>
              <MutedText>
                <code>createdAt</code> - 规则执行时间（ISO 8601）
              </MutedText>
            </div>
          </div>
        </div>

        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md">
          <div className="text-sm text-blue-600 dark:text-blue-400">
            <strong>身份验证：</strong>每个请求都会在{" "}
            <code>X-Webhook-Secret</code> 头中携带你的 Webhook 密钥以供 验证。
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
        查看载荷结构
      </Button>
    </WebhookDocumentationDialog>
  );
}
