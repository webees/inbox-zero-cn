"use client";

import { useState, type ReactElement } from "react";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
                loading: t`Categorizing senders... This might take a while.`,
                success: (
                  data:
                    | { totalUncategorizedSenders: number | undefined }
                    | undefined,
                ) => {
                  if (!data) {
                    return t`分类已开始。`;
                  }

                  return data.totalUncategorizedSenders
                    ? t`${plural(data.totalUncategorizedSenders, {
                        one: "正在分类 # 个发件人...",
                        other: "正在分类 # 个发件人...",
                      })}`
                    : t`目前没有需要分类的发件人了。`;
                },
                error: (err: unknown) => {
                  const message =
                    err instanceof Error ? err.message : t`发生了未知错误。`;
                  return t`分类发件人时出错：${message}`;
                },
              },
            );
          }}
          {...buttonProps}
        >
          {buttonProps?.children || (
            <>
              <SparklesIcon className="mr-2 size-4" />
              <Trans>智能分类</Trans>
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
  const { t } = useLingui();

  if (hasAiAccess) {
    return (
      <Tooltip content={t`为数千个发件人分类，这需要几分钟。`}>
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
