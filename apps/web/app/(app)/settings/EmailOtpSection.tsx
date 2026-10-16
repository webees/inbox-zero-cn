"use client";

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
            <ItemTitle>允许使用一次性邮箱验证码登录</ItemTitle>
            {data.emailOtpEnabled && hasMultipleAccounts && (
              <ItemDescription className="line-clamp-none break-all">
                使用 {data.email} 登录。
              </ItemDescription>
            )}
            {!data.emailDeliveryConfigured && (
              <ItemDescription className="line-clamp-none">
                邮件发送不可用。
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions>
            <Switch
              aria-label="允许使用一次性邮箱验证码登录"
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
