"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import { toggleAllRulesAction } from "@/utils/actions/rule";
import { toastError, toastSuccess } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { useRules } from "@/hooks/useRules";

export function ToggleAllRulesSection({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { t } = useLingui();
  const { data: rules, mutate } = useRules(emailAccountId);

  const hasEnabledRules = rules?.some((rule) => rule.enabled) ?? false;
  const hasRules = (rules?.length ?? 0) > 0;

  const { execute, isExecuting } = useAction(
    toggleAllRulesAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: t`所有规则已禁用` });
        mutate();
      },
      onError: (error) => {
        toastError({ description: getActionErrorMessage(error.error) });
      },
    },
  );

  if (!hasRules || !hasEnabledRules) return null;

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>
            <Trans>禁用所有规则</Trans>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={isExecuting}>
                <Trans>全部禁用</Trans>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>禁用所有规则？</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans>
                    这将禁用此账号的所有 AI
                    规则。你可以在规则页面重新启用单条规则。
                  </Trans>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>取消</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  type="button"
                  onClick={() => execute({ enabled: false })}
                >
                  <Trans>全部禁用</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ItemActions>
      </Item>
    </>
  );
}
