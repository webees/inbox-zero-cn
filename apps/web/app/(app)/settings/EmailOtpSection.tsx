"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import useSWR from "swr";
import { useAction } from "next-safe-action/hooks";
import type { EmailOtpSettingsResponse } from "@/app/api/user/email-otp/route";
import { updateEmailOtpAction } from "@/utils/actions/email-otp";
import { getActionErrorMessage } from "@/utils/error";
import { toastError } from "@/components/Toast";
import { LoadingContent } from "@/components/LoadingContent";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";

export function EmailOtpSection({
  hasMultipleAccounts,
}: {
  hasMultipleAccounts: boolean;
}) {
  const { t } = useLingui();
  const { data, isLoading, error, mutate } = useSWR<EmailOtpSettingsResponse>(
    "/api/user/email-otp",
  );
  const { execute, isExecuting } = useAction(updateEmailOtpAction, {
    onSuccess: () => {
      mutate();
    },
    onError: ({ error }) =>
      toastError({ description: getActionErrorMessage(error) }),
  });

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data && (
        <Item size="sm">
          <ItemContent>
            <ItemTitle>
              <Trans>允许使用一次性邮件验证码登录</Trans>
            </ItemTitle>
            {data.emailOtpEnabled && hasMultipleAccounts && (
              <ItemDescription className="line-clamp-none break-all">
                <Trans>使用 {data.email} 登录</Trans>
              </ItemDescription>
            )}
            {!data.emailDeliveryConfigured && (
              <ItemDescription className="line-clamp-none">
                <Trans>邮件发送不可用</Trans>
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions>
            <Switch
              aria-label={t`允许使用一次性邮件验证码登录`}
              checked={data.emailOtpEnabled}
              disabled={
                isExecuting ||
                !data.canManage ||
                (!data.emailDeliveryConfigured && !data.emailOtpEnabled)
              }
              onCheckedChange={(enabled) => execute({ enabled })}
            />
          </ItemActions>
        </Item>
      )}
    </LoadingContent>
  );
}
