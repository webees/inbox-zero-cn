"use client";

import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const { enabled, loading } = useDraftReplies();

  const isEnabled = !loading && enabled;

  const kb = <KnowledgeDialog enabled={isEnabled} />;

  return (
    <SettingCard
      title={t`Draft knowledge base`}
      description={t`AI 助手撰写回复时使用的信息。`}
      right={
        isEnabled ? (
          kb
        ) : (
          <Tooltip content={t`启用草稿回复后才能编辑知识库`}>
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
          <Trans>管理</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>草稿知识库</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>用于帮助 AI 助手撰写回复草稿。</Trans>
          </DialogDescription>
        </DialogHeader>
        <KnowledgeBase />
        <DraftDocsSites />
      </DialogContent>
    </Dialog>
  );
}
