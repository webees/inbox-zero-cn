"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/ui/card";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";

export function IntegrationsPremiumAlert() {
  const { t } = useLingui();
  const { PremiumModal, openModal } = usePremiumModal();

  return (
    <>
      <ActionCard
        icon={<CrownIcon className="h-5 w-5" />}
        title={t`需要 Plus 套餐`}
        description={t`连接你的 CRM 和工具，帮助 AI 起草更好的回复并生成更丰富的会议简报。`}
        action={
          <Button variant="primaryBlack" onClick={openModal}>
            <Trans>升级</Trans>
          </Button>
        }
      />
      <PremiumModal />
    </>
  );
}
