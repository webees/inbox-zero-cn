"use client";

import { useCallback } from "react";
import { useAction } from "next-safe-action/hooks";
import { ShieldCheckIcon } from "lucide-react";
import { ActionCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toastSuccess, toastError } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { updateAnalyticsConsentAction } from "@/utils/actions/organization";
import { useOrganizationMembership } from "@/hooks/useOrganizationMembership";
import { useAccount } from "@/providers/EmailAccountProvider";
import { hasOrganizationAdminRole } from "@/utils/organizations/roles";

export function OrgAnalyticsConsentBanner() {
  const { emailAccountId } = useAccount();
  const { data, isLoading, mutate } = useOrganizationMembership();

  const { execute, isPending } = useAction(
    updateAnalyticsConsentAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "已授予管理员分析访问权限！" });
        mutate();
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: "更新设置失败",
          }),
        });
      },
    },
  );

  const handleAllow = useCallback(() => {
    execute({ allowOrgAdminAnalytics: true });
  }, [execute]);

  if (isLoading || !data?.organizationId || data.allowOrgAdminAnalytics) {
    return null;
  }

  const isAdmin = hasOrganizationAdminRole(data.role ?? "");

  const title = isAdmin
    ? "将你的分析数据纳入组织统计"
    : "允许组织管理员查看你的分析数据";

  const description = `你的邮件分析数据目前是私密的。启用访问后，可让${isAdmin ? "其他 " : ""}组织管理员查看你的收件箱统计和使用数据。这有助于你的团队了解生产力并更高效地协作。`;

  return (
    <ActionCard
      variant="blue"
      className="mt-6 max-w-full"
      icon={<ShieldCheckIcon className="h-4 w-4" />}
      title={title}
      description={description}
      action={
        <Button onClick={handleAllow} loading={isPending}>
          允许访问
        </Button>
      }
    />
  );
}
