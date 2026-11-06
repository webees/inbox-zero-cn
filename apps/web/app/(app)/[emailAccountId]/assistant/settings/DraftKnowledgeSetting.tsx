"use client";

import { SettingCard } from "@/components/SettingCard";
import { useDraftReplies } from "@/app/(app)/[emailAccountId]/assistant/settings/DraftReplies";
import { Tooltip } from "@/components/Tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KnowledgeBase } from "@/app/(app)/[emailAccountId]/assistant/knowledge/KnowledgeBase";
import { DraftDocsSites } from "@/app/(app)/[emailAccountId]/assistant/knowledge/DraftDocsSites";

export function DraftKnowledgeSetting() {
  const { enabled, loading } = useDraftReplies();

  const isEnabled = !loading && enabled;

  const kb = <KnowledgeDialog enabled={isEnabled} />;

  return (
    <SettingCard
      title="起草知识库"
      description="助手在撰写回复时使用的信息。"
      right={
        isEnabled ? (
          kb
        ) : (
          <Tooltip content="启用起草回复以编辑知识库">
            <span>{kb}</span>
          </Tooltip>
        )
      }
    />
  );
}

function KnowledgeDialog({ enabled }: { enabled: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!enabled}>
          管理
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>起草知识库</DialogTitle>
          <DialogDescription>此内容用于帮助助手起草回复。</DialogDescription>
        </DialogHeader>
        <KnowledgeBase />
        <DraftDocsSites />
      </DialogContent>
    </Dialog>
  );
}
