"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { toastSuccess } from "@/components/Toast";
import { BRAND_NAME, SUPPORT_EMAIL } from "@/utils/branding";

interface RequestAccessDialogProps {
  integrationName?: string;
  trigger?: React.ReactNode;
}

export function RequestAccessDialog({
  integrationName,
  trigger,
}: RequestAccessDialogProps) {
  const isGenericRequest = !integrationName;
  const title = isGenericRequest
    ? "申请集成"
    : `请求 ${integrationName} 访问权限`;
  const subject = isGenericRequest
    ? "集成请求"
    : `请求访问：${integrationName} 集成`;

  const messageBody = isGenericRequest
    ? `你好：\n\n我希望为 ${BRAND_NAME} 申请一个新的集成。\n\n集成名称：\n\n使用场景：\n\n谢谢！`
    : `你好：\n\n我有兴趣在 ${BRAND_NAME} 中使用 ${integrationName} 集成。\n\n能否告知我该集成何时可用？\n\n谢谢！`;

  const handleCopyEmail = async () => {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    toastSuccess({ description: "邮箱已复制到剪贴板" });
  };

  const handleCopyMessage = async () => {
    const message = `Subject: ${subject}\n\n${messageBody}`;
    await navigator.clipboard.writeText(message);
    toastSuccess({ description: "消息已复制到剪贴板" });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline">
            请求访问
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isGenericRequest
              ? "给我们发邮件以申请新的集成。"
              : "给我们发邮件以申请该集成的访问权限。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">邮箱</div>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm">
                {SUPPORT_EMAIL}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopyEmail}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">消息</div>
            <div className="flex flex-col gap-2 mt-1">
              <div className="rounded bg-muted px-3 py-2 text-sm">
                <div className="font-medium mb-2">主题：{subject}</div>
                <div className="whitespace-pre-wrap text-muted-foreground">
                  {messageBody}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyMessage}
                className="self-end"
              >
                <Copy className="h-4 w-4 mr-2" />
                复制消息
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
