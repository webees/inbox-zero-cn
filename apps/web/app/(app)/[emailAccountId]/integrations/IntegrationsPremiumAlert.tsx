"use client";

import { CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/ui/card";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";

export function IntegrationsPremiumAlert() {
  const { PremiumModal, openModal } = usePremiumModal();

  return (
    <>
      <ActionCard
        icon={<CrownIcon className="h-5 w-5" />}
        title="需要 Plus 套餐"
        description="连接你的 CRM 和工具，帮助 AI 起草更好的回复并生成更丰富的会议简报。"
        action={
          <Button variant="primaryBlack" onClick={openModal}>
            升级
          </Button>
        }
      />
      <PremiumModal />
    </>
  );
}
