import { useCallback, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Pricing from "@/app/(app)/premium/Pricing";
import { getPremiumTierName, tiers } from "@/app/(app)/premium/config";

const enterpriseTierName = getPremiumTierName("COPILOT_MONTHLY");
const modalTiers = tiers.filter((tier) => tier.name !== enterpriseTierName);

function PricingDialogHeader() {
  return (
    <div className="mb-4 text-center">
      <h2 className="font-title text-2xl text-gray-900">升级到高级版</h2>
    </div>
  );
}

function EnterpriseFooter() {
  return (
    <div className="flex items-center justify-between rounded-3xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="font-semibold text-gray-900">{enterpriseTierName}</h3>
        <p className="text-sm text-gray-600">
          大型团队可享 SSO、SCIM、本地部署和专属支持。
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="https://www.getinboxzero.com/sales">联系销售</Link>
      </Button>
    </div>
  );
}

export function usePremiumModal() {
  const [isOpen, setIsOpen] = useState(false);

  const openModal = useCallback(() => setIsOpen(true), []);

  const PremiumModal = useCallback(() => {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {/* 高级版升级尚不支持深色模式，因为它会出现在首页 */}
        <DialogContent className="max-w-6xl bg-white">
          <Pricing
            header={<PricingDialogHeader />}
            displayTiers={modalTiers}
            className="px-0 pt-0 lg:px-0"
          />
          <EnterpriseFooter />
        </DialogContent>
      </Dialog>
    );
  }, [isOpen]);

  return {
    openModal,
    PremiumModal,
  };
}
