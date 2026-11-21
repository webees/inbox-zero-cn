"use client";

import { ArchiveIcon, Layers3Icon, BarChartBigIcon } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnboarding } from "@/components/OnboardingModal";
import { CardBasic } from "@/components/ui/card";

export function StatsOnboarding() {
  const { isOpen, setIsOpen, onClose } = useOnboarding("Stats");

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>欢迎使用邮件分析</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>从海量邮件中获取洞察，并立即清理收件箱。</Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:gap-4">
          <CardBasic className="flex items-center">
            <BarChartBigIcon className="mr-3 h-5 w-5" />
            <Trans>可视化你的数据</Trans>
          </CardBasic>
          <CardBasic className="flex items-center">
            <Layers3Icon className="mr-3 h-5 w-5" />
            <Trans>了解是什么占满了你的收件箱</Trans>
          </CardBasic>
          <CardBasic className="flex items-center">
            <ArchiveIcon className="mr-3 h-5 w-5" />
            <Trans>退订并批量归档</Trans>
          </CardBasic>
        </div>
        <div>
          <Button className="w-full" onClick={onClose}>
            <Trans>开始使用</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
