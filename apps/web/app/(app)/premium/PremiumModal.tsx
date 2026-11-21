import { useCallback, useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Pricing from "@/app/(app)/premium/Pricing";
import { tiers } from "@/app/(app)/premium/config";

const modalTiers = tiers.filter((tier) => tier.name !== "Enterprise");

function PricingDialogHeader() {
  return (
    <div className="mb-4 text-center">
      <h2 className="font-title text-2xl text-gray-900">
        <Trans>升级到高级版</Trans>
      </h2>
    </div>
  );
}

function EnterpriseFooter() {
  return (
    <div className="flex items-center justify-between rounded-3xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="font-semibold text-gray-900">企业版</h3>
        <p className="text-sm text-gray-600">
          <Trans>面向大型团队提供 SSO、SCIM、本地部署和专属支持。</Trans>
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="https://www.getinboxzero.com/sales">
          <Trans>联系销售</Trans>
        </Link>
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
        {/* premium upgrade doesn't support dark mode yet as it appears on homepage */}
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
