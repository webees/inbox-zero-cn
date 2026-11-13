"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { toastError, toastSuccess } from "@/components/Toast";
import { useUser } from "@/hooks/useUser";
import { updateDecisionModelSettingsAction } from "@/utils/actions/settings";
import { getActionErrorMessage } from "@/utils/error";

export function DecisionModelSection() {
  const { t } = useLingui();
  const { data, mutate } = useUser();

  const { execute, isExecuting } = useAction(
    updateDecisionModelSettingsAction,
    {
      onSuccess: () => {
        toastSuccess({ description: t`设置已更新！` });
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: t`更新设置失败`,
          }),
        });
      },
      onSettled: () => {
        mutate();
      },
    },
  );

  if (!data) return null;

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          <Trans>专用决策模型</Trans>
        </ItemTitle>
        <ItemDescription>
          <Trans>
            使用可选的决策模型进行规则匹配及其他结构化决策。若不可用，则回退到你的
            AI 模型。
          </Trans>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={t`专用决策模型`}
          checked={data.decisionModelEnabled}
          onCheckedChange={(decisionModelEnabled) => {
            mutate({ ...data, decisionModelEnabled }, false);
            execute({ decisionModelEnabled });
          }}
          disabled={isExecuting}
        />
      </ItemActions>
    </Item>
  );
}
