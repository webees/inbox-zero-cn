"use client";

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
          设置
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>批量归档设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-8">
            <div className="space-y-2">
              <p className="font-medium">操作</p>
              <p className="text-sm text-muted-foreground">
                选择点击每个类别上的操作按钮时会发生什么
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
                    <span>归档</span>
                  </div>
                </SelectItem>
                <SelectItem value="markRead">
                  <div className="flex items-center gap-2">
                    <MailOpenIcon className="size-4" />
                    <span>标记为已读</span>
                  </div>
                </SelectItem>
                <SelectItem value="delete">
                  <div className="flex items-center gap-2">
                    <TrashIcon className="size-4" />
                    <span>删除</span>
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

export function getActionLabels(action: BulkActionType) {
  if (action === "delete") {
    return {
      buttonLabel: "删除",
      allLabel: "全部删除",
      countLabel: (selected: number, total: number) =>
        `删除 ${selected}/${total}`,
      completedLabel: "已删除",
      icon: TrashIcon,
    };
  }

  if (action === "markRead") {
    return {
      buttonLabel: "标记为已读",
      allLabel: "全部标记为已读",
      countLabel: (selected: number, total: number) =>
        `将 ${selected}/${total} 标记为已读`,
      completedLabel: "已标记为已读",
      icon: MailOpenIcon,
    };
  }
  return {
    buttonLabel: "归档",
    allLabel: "全部归档",
    countLabel: (selected: number, total: number) =>
      `归档 ${selected}/${total}`,
    completedLabel: "已归档",
    icon: ArchiveIcon,
  };
}
