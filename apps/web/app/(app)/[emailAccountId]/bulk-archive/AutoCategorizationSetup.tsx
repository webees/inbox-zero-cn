"use client";

import { useState, useCallback } from "react";
import { toastError, toastSuccess } from "@/components/Toast";
import { ArchiveIcon, RotateCcwIcon, TagsIcon } from "lucide-react";
import { SetupDialog } from "@/components/SetupCard";
import { Button } from "@/components/ui/button";
import { bulkCategorizeSendersAction } from "@/utils/actions/categorize";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useCategorizeProgress } from "@/app/(app)/[emailAccountId]/smart-categories/CategorizeProgress";

const features = [
  {
    icon: <TagsIcon className="size-4 text-blue-500" />,
    title: "自动归类",
    description: "我们会将发件人归类，例如简报、收据和营销邮件",
  },
  {
    icon: <ArchiveIcon className="size-4 text-blue-500" />,
    title: "按类别归档",
    description: "一次清理整个类别，而不是一封封处理",
  },
  {
    icon: <RotateCcwIcon className="size-4 text-blue-500" />,
    title: "始终可撤销",
    description: "邮件会被归档而非删除——你随时都能找到它们",
  },
];

export function AutoCategorizationSetup({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { emailAccountId } = useAccount();
  const { setIsBulkCategorizing } = useCategorizeProgress();

  const [isEnabling, setIsEnabling] = useState(false);

  const enableFeature = useCallback(async () => {
    setIsEnabling(true);
    setIsBulkCategorizing(true);

    try {
      const result = await bulkCategorizeSendersAction(emailAccountId);

      if (result?.serverError) {
        throw new Error(result.serverError);
      }

      if (!result?.data) {
        toastSuccess({
          description: "归类已开始。",
        });
        onOpenChange?.(false);
      } else if (result.data.totalUncategorizedSenders) {
        toastSuccess({
          description: `正在归类 ${result.data.totalUncategorizedSenders} 个发件人…这可能需要几分钟。`,
        });
        onOpenChange?.(false);
      } else {
        toastSuccess({
          description: "目前没有需要归类的发件人了。",
        });
        setIsBulkCategorizing(false);
        onOpenChange?.(false);
      }
    } catch (error) {
      toastError({
        description: `启用功能失败：${error instanceof Error ? error.message : "未知错误"}`,
      });
      setIsBulkCategorizing(false);

      if (isUpgradeError(error)) {
        onOpenChange?.(false);
      }
    } finally {
      setIsEnabling(false);
    }
  }, [emailAccountId, onOpenChange, setIsBulkCategorizing]);

  return (
    <SetupDialog
      open={open}
      onOpenChange={onOpenChange}
      dialogContentProps={{
        hideCloseButton: true,
        onInteractOutside: (event) => event.preventDefault(),
        onEscapeKeyDown: (event) => event.preventDefault(),
      }}
      imageSrc="/images/illustrations/working-vacation.svg"
      imageAlt="批量归档"
      title="批量归档"
      description="只需点击几下即可归档数千封邮件。"
      features={features}
    >
      <Button onClick={enableFeature} loading={isEnabling}>
        开始使用
      </Button>
    </SetupDialog>
  );
}

function isUpgradeError(error: unknown) {
  return error instanceof Error && error.message.includes("Please upgrade");
}
