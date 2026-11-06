"use client";

import { useState, type ReactElement } from "react";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bulkCategorizeSendersAction } from "@/utils/actions/categorize";
import { PremiumTooltip } from "@/components/PremiumAlert";
import { usePremium } from "@/hooks/usePremium";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import type { ButtonProps } from "@/components/ui/button";
import { useCategorizeProgress } from "@/app/(app)/[emailAccountId]/smart-categories/CategorizeProgress";
import { Tooltip } from "@/components/Tooltip";
import { useAccount } from "@/providers/EmailAccountProvider";

export function CategorizeWithAiButton({
  buttonProps,
}: {
  buttonProps?: ButtonProps;
}) {
  const { emailAccountId } = useAccount();
  const [isCategorizing, setIsCategorizing] = useState(false);
  const { hasAiAccess } = usePremium();
  const { PremiumModal, openModal: openPremiumModal } = usePremiumModal();

  const { setIsBulkCategorizing } = useCategorizeProgress();

  return (
    <>
      <CategorizeWithAiButtonTooltip
        hasAiAccess={hasAiAccess}
        openPremiumModal={openPremiumModal}
      >
        <Button
          type="button"
          data-testid="categorize-with-ai"
          loading={isCategorizing}
          disabled={!hasAiAccess}
          onClick={async () => {
            if (isCategorizing) return;
            toast.promise(
              async () => {
                setIsCategorizing(true);
                setIsBulkCategorizing(true);
                try {
                  const result =
                    await bulkCategorizeSendersAction(emailAccountId);

                  if (result?.serverError) {
                    throw new Error(result.serverError);
                  }

                  const totalUncategorizedSenders =
                    result?.data?.totalUncategorizedSenders || 0;

                  if (totalUncategorizedSenders === 0) {
                    setIsBulkCategorizing(false);
                  }

                  return result?.data;
                } catch (error) {
                  setIsBulkCategorizing(false);
                  throw error;
                } finally {
                  setIsCategorizing(false);
                }
              },
              {
                loading: "正在对发件人分类……这可能需要一些时间。",
                success: (
                  data:
                    | { totalUncategorizedSenders: number | undefined }
                    | undefined,
                ) => {
                  if (!data) {
                    return "已开始分类。";
                  }

                  return data.totalUncategorizedSenders
                    ? `正在对 ${data.totalUncategorizedSenders} 个发件人分类……`
                    : "当前没有更多需要分类的发件人。";
                },
                error: (err: unknown) => {
                  const message =
                    err instanceof Error ? err.message : "发生未知错误。";
                  return `分类发件人时出错：${message}`;
                },
              },
            );
          }}
          {...buttonProps}
        >
          {buttonProps?.children || (
            <>
              <SparklesIcon className="mr-2 size-4" />
              自动分类
            </>
          )}
        </Button>
      </CategorizeWithAiButtonTooltip>
      <PremiumModal />
    </>
  );
}

function CategorizeWithAiButtonTooltip({
  children,
  hasAiAccess,
  openPremiumModal,
}: {
  children: ReactElement;
  hasAiAccess: boolean;
  openPremiumModal: () => void;
}) {
  if (hasAiAccess) {
    return (
      <Tooltip content="将为数千个发件人自动分类，大约需要几分钟。">
        {children}
      </Tooltip>
    );
  }

  return (
    <PremiumTooltip showTooltip={!hasAiAccess} openModal={openPremiumModal}>
      {children}
    </PremiumTooltip>
  );
}
