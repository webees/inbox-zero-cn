"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { SettingCard } from "@/components/SettingCard";
import { SnippetsManager } from "@/components/snippets/SnippetsManager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SnippetsSetting() {
  const { t } = useLingui();

  return (
    <SettingCard
      description={t`在草稿中输入 / 加快捷方式即可复用已保存的回复。`}
      right={
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Trans>管理</Trans>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                <Trans>片段</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>可在撰写邮件时输入 / 插入的已保存回复。</Trans>
              </DialogDescription>
            </DialogHeader>
            <SnippetsManager />
          </DialogContent>
        </Dialog>
      }
      title={t`片段`}
    />
  );
}
