"use client";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { isLabelsKey } from "@/hooks/useLabels";
import { resetLabelColorsAction } from "@/utils/actions/mail";
import { getActionErrorMessage } from "@/utils/error";

export function ResetLabelColorsSection({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { t } = useLingui();
  const { mutate } = useSWRConfig();
  const { execute, isExecuting } = useAction(
    resetLabelColorsAction.bind(null, emailAccountId),
    {
      onSuccess: ({ data }) => {
        mutate(isLabelsKey);
        if (!data) return;
        if (data.failed > 0) {
          toast.error(
            t`Reset ${plural(data.updated, {
              one: "# label",
              other: "# labels",
            })}, but ${plural(data.failed, {
              one: "# label",
              other: "# labels",
            })} couldn't be updated. Please try again.`,
          );
          return;
        }
        if (data.updated === 0) {
          toast.success(t`标签颜色已设置为默认值。`);
          return;
        }
        toast.success(
          t`${plural(data.updated, {
            one: "已将 # 个标签重置为默认颜色。",
            other: "已将 # 个标签重置为默认颜色。",
          })}`,
        );
      },
      onError: ({ error }) => {
        toast.error(getActionErrorMessage(error));
      },
    },
  );

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>
            <Trans>重置标签颜色</Trans>
          </ItemTitle>
          <ItemDescription>
            <Trans>恢复 Inbox Zero 标签（如待回复和新闻简报）的默认颜色</Trans>
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            loading={isExecuting}
            onClick={() => execute()}
          >
            <Trans>重置</Trans>
          </Button>
        </ItemActions>
      </Item>
    </>
  );
}
