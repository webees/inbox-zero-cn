"use client";

import { Trans } from "@lingui/react/macro";
import { useOnboarding } from "@/components/OnboardingModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CardBasic } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TagsIcon, ArchiveIcon, ZapIcon } from "lucide-react";

export function SmartCategoriesOnboarding() {
  const { isOpen, setIsOpen, onClose } = useOnboarding("SmartCategories");

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>欢迎使用发件人分类</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              自动为发件人分类，更好地管理收件箱并实现更智能的自动化。
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:gap-4">
          <CardBasic className="flex items-center">
            <TagsIcon className="mr-3 h-5 w-5" />
            <Trans>自动为发件人分类</Trans>
          </CardBasic>
          <CardBasic className="flex items-center">
            <ArchiveIcon className="mr-3 h-5 w-5" />
            <Trans>按分类批量归档</Trans>
          </CardBasic>
          <CardBasic className="flex items-center">
            <ZapIcon className="mr-3 h-5 w-5" />
            <Trans>使用分类优化 AI 助手</Trans>
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
