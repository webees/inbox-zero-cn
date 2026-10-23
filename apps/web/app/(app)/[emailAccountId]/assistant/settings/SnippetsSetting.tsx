"use client";

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
  return (
    <SettingCard
      description="在草稿中输入 / 加上快捷方式即可复用已保存的回复。"
      right={
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              管理
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>片段</DialogTitle>
              <DialogDescription>
                你可以在撰写邮件时通过 / 插入的已保存回复。
              </DialogDescription>
            </DialogHeader>
            <SnippetsManager />
          </DialogContent>
        </Dialog>
      }
      title="片段"
    />
  );
}
