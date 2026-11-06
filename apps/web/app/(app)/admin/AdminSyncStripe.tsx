"use client";

import { useAction } from "next-safe-action/hooks";
import {
  adminSyncStripeForAllUsersAction,
  adminSyncAllStripeCustomersToDbAction,
  adminBackfillPremiumAdminsAction,
} from "@/utils/actions/admin";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";

export const AdminSyncStripe = () => {
  const { execute, isExecuting } = useAction(adminSyncStripeForAllUsersAction, {
    onSuccess: () => {
      toastSuccess({
        title: "Stripe 已同步",
        description: "Stripe 已同步",
      });
    },
    onError: (error) => {
      toastError({
        title: "同步 Stripe 时出错",
        description: getActionErrorMessage(error.error),
      });
    },
  });

  return (
    <Button onClick={() => execute()} loading={isExecuting} variant="outline">
      同步 Stripe
    </Button>
  );
};

export const AdminBackfillPremiumAdmins = () => {
  const { execute, isExecuting } = useAction(adminBackfillPremiumAdminsAction, {
    onSuccess: (result) => {
      toastSuccess({
        title: "高级版管理员已回填",
        description: `已回填 ${result.data?.backfilled ?? 0} 个高级版，跳过 ${result.data?.skipped ?? 0} 个`,
      });
    },
    onError: (error) => {
      toastError({
        title: "回填高级版管理员时出错",
        description: getActionErrorMessage(error.error),
      });
    },
  });

  return (
    <Button onClick={() => execute()} loading={isExecuting} variant="outline">
      回填高级版管理员
    </Button>
  );
};

export const AdminSyncStripeCustomers = () => {
  const { execute, isExecuting } = useAction(
    adminSyncAllStripeCustomersToDbAction,
    {
      onSuccess: (result) => {
        toastSuccess({
          title: "Stripe 客户已同步",
          description: result.data?.success || "所有 Stripe 客户已同步到数据库",
        });
      },
      onError: (error) => {
        toastError({
          title: "同步 Stripe 客户时出错",
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );

  return (
    <Button onClick={() => execute()} loading={isExecuting} variant="outline">
      同步所有 Stripe 客户到数据库
    </Button>
  );
};
