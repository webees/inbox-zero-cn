"use client";

import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  ArchiveIcon,
  MailOpenIcon,
  SettingsIcon,
  TrashIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type BulkActionType = "archive" | "markRead" | "delete";

interface BulkArchiveSettingsModalProps {
  onActionChange: (action: BulkActionType) => void;
  selectedAction: BulkActionType;
}

export function BulkArchiveSettingsModal({
  selectedAction,
  onActionChange,
}: BulkArchiveSettingsModalProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SettingsIcon className="mr-2 size-4" />
          <Trans>设置</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>批量归档设置</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-8">
            <div className="space-y-2">
              <p className="font-medium">
                <Trans>操作</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>选择点击每个分类上的操作按钮时执行的操作</Trans>
              </p>
            </div>
            <Select
              value={selectedAction}
              onValueChange={(value) => onActionChange(value as BulkActionType)}
            >
              <SelectTrigger className="w-[180px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="archive">
                  <div className="flex items-center gap-2">
                    <ArchiveIcon className="size-4" />
                    <span>
                      <Trans>归档</Trans>
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="markRead">
                  <div className="flex items-center gap-2">
                    <MailOpenIcon className="size-4" />
                    <span>
                      <Trans>标记为已读</Trans>
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="delete">
                  <div className="flex items-center gap-2">
                    <TrashIcon className="size-4" />
                    <span>
                      <Trans>删除</Trans>
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function getActionLabels(action: BulkActionType, i18n: I18n) {
  if (action === "delete") {
    return {
      buttonLabel: t(i18n)`删除`,
      allLabel: t(i18n)`全部删除`,
      countLabel: (selected: number, total: number) =>
        t(i18n)`删除 ${selected}/${total}`,
      completedLabel: t(i18n)`已删除`,
      icon: TrashIcon,
    };
  }

  if (action === "markRead") {
    return {
      buttonLabel: t(i18n)`标记为已读`,
      allLabel: t(i18n)`全部标记为已读`,
      countLabel: (selected: number, total: number) =>
        t(i18n)`将 ${selected}/${total} 标记为已读`,
      completedLabel: t(i18n)`已标记为已读`,
      icon: MailOpenIcon,
    };
  }
  return {
    buttonLabel: t(i18n)`归档`,
    allLabel: t(i18n)`全部归档`,
    countLabel: (selected: number, total: number) =>
      t(i18n)`归档 ${selected}/${total}`,
    completedLabel: t(i18n)`已归档`,
    icon: ArchiveIcon,
  };
}
