"use client";

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { Trash2, MoreVertical, Settings } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AlertError } from "@/components/Alert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingContent } from "@/components/LoadingContent";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardTitle,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccounts } from "@/hooks/useAccounts";
import { deleteEmailAccountAction } from "@/utils/actions/user";
import { toastSuccess, toastError } from "@/components/Toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { prefixPath } from "@/utils/path";
import { AddAccount } from "@/app/(app)/accounts/AddAccount";
import { getAddAccountBillingText } from "@/app/(app)/premium/config";
import { usePremium } from "@/hooks/usePremium";
import { PageHeader } from "@/components/PageHeader";
import { PageWrapper } from "@/components/PageWrapper";
import { logOut } from "@/utils/user";
import { getAndClearAuthErrorCookie } from "@/utils/auth-cookies";
import { getActionErrorMessage } from "@/utils/error";
import { BRAND_NAME } from "@/utils/branding";
import {
  CALENDAR_SCOPES,
  SCOPES as MICROSOFT_EMAIL_SCOPES,
} from "@/utils/outlook/scopes";
import { MICROSOFT_DRIVE_SCOPES } from "@/utils/drive/scopes";
import { clearLocalMailAccountState } from "@/utils/mail-engine/clear-local-mail-account";
import { clearOfflineMailCacheForAccount } from "@/utils/offline/clear-mail-cache";

export default function AccountsPage() {
  const { t } = useLingui();
  const { data, isLoading, error, mutate } = useAccounts();
  const { premium, isPremium, isLoading: isPremiumLoading } = usePremium();
  const notification = useAccountNotifications();

  return (
    <PageWrapper>
      <PageHeader title={t`Accounts`} />
      {notification ? (
        <AlertError
          className="mt-4"
          title={notification.title}
          description={notification.description}
        />
      ) : null}

      <LoadingContent loading={isLoading} error={error}>
        <div className="grid grid-cols-1 gap-4 py-6 lg:grid-cols-2 xl:grid-cols-3">
          {data?.emailAccounts.map((emailAccount) => (
            <AccountItem
              key={emailAccount.id}
              emailAccount={emailAccount}
              onAccountDeleted={mutate}
            />
          ))}
          <AddAccount
            helperText={
              isPremiumLoading
                ? null
                : getAddAccountBillingText(isPremium ? premium : null)
            }
          />
        </div>
      </LoadingContent>
    </PageWrapper>
  );
}

function AccountItem({
  emailAccount,
  onAccountDeleted,
}: {
  emailAccount: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    isPrimary: boolean;
  };
  onAccountDeleted: () => void;
}) {
  return (
    <Link href={prefixPath(emailAccount.id, "/automation")} className="block">
      <Card className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-900">
        <AccountHeader
          emailAccount={emailAccount}
          onAccountDeleted={onAccountDeleted}
        />
      </Card>
    </Link>
  );
}

function AccountHeader({
  emailAccount,
  onAccountDeleted,
}: {
  emailAccount: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    isPrimary: boolean;
  };
  onAccountDeleted: () => void;
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-3 space-y-0">
      <Avatar>
        <AvatarImage src={emailAccount.image || undefined} />
        <AvatarFallback>
          {emailAccount.name?.[0] || emailAccount.email?.[0]}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col space-y-1.5 flex-1">
        <CardTitle>{emailAccount.name}</CardTitle>
        <CardDescription>{emailAccount.email}</CardDescription>
      </div>
      <div
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        onMouseDown={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
          }
        }}
      >
        <AccountOptionsDropdown
          emailAccount={emailAccount}
          onAccountDeleted={onAccountDeleted}
        />
      </div>
    </CardHeader>
  );
}

function AccountOptionsDropdown({
  emailAccount,
  onAccountDeleted,
}: {
  emailAccount: {
    id: string;
    email: string;
    isPrimary: boolean;
  };
  onAccountDeleted: () => void;
}) {
  const { t } = useLingui();
  const { execute, isExecuting } = useAction(deleteEmailAccountAction, {
    onSuccess: async () => {
      toastSuccess({
        title: t`Email account deleted`,
        description: t`The email account has been deleted successfully.`,
      });
      onAccountDeleted();
      if (emailAccount.isPrimary) {
        await logOut("/login");
      } else {
        try {
          await clearLocalMailAccountState(emailAccount.id);
        } catch {
          toastError({
            title: t`Local mailbox still on this device`,
            description: t`The account was deleted. Sign out to finish removing its mail from this device.`,
          });
        }
        await clearOfflineMailCacheForAccount(emailAccount.id);
      }
    },
    onError: (error) => {
      toastError({
        title: t`Error deleting email account`,
        description: getActionErrorMessage(error.error),
      });
      onAccountDeleted();
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t`账号选项`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <DropdownMenuItem asChild>
          <Link
            href={prefixPath(emailAccount.id, "/setup")}
            className="flex items-center gap-2"
            onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
          >
            <Settings className="size-4" />
            <Trans>设置</Trans>
          </Link>
        </DropdownMenuItem>
        <ConfirmDialog
          trigger={
            <DropdownMenuItem
              onSelect={(e: Event) => {
                e?.preventDefault();
                e?.stopPropagation?.();
              }}
              onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
              className="flex items-center gap-2 text-destructive focus:text-destructive"
              disabled={isExecuting}
            >
              <Trash2 className="size-4" />
              <Trans>删除</Trans>
            </DropdownMenuItem>
          }
          title={t`删除账号`}
          description={
            emailAccount.isPrimary
              ? t`确定要删除“${emailAccount.email}”吗？这是你的主账号。你将退出登录并需要重新登录。剩余的最早账号将成为新的主账号。“${emailAccount.email}”的所有数据都将从 ${BRAND_NAME} 永久删除。`
              : t`确定要删除“${emailAccount.email}”吗？此操作将删除其在 ${BRAND_NAME} 上的所有数据。`
          }
          confirmText={t`删除`}
          onConfirm={() => {
            execute({ emailAccountId: emailAccount.id });
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useAccountNotifications() {
  const { i18n } = useLingui();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [notification, setNotification] = useState<AccountNotification | null>(
    null,
  );

  useEffect(() => {
    const authErrorCookie = getAndClearAuthErrorCookie();
    const errorParam = searchParams.get("error") || authErrorCookie;
    const successParam = searchParams.get("success");

    if (errorParam) {
      const errorMessage = getAccountErrorMessage(
        errorParam,
        searchParams.get("error_description"),
        i18n,
      );
      setNotification(errorMessage);

      toastError({
        title: errorMessage.title,
        description: errorMessage.toastDescription,
      });

      router.replace(pathname);
      return;
    }

    if (successParam) {
      const successMessages: Record<
        string,
        { title: string; description: string }
      > = {
        account_merged: {
          title: i18n._(msg`账号合并成功！`),
          description: i18n._(msg`你的账号已合并。`),
        },
        account_created_and_linked: {
          title: i18n._(msg`账号添加成功！`),
          description: i18n._(msg`你的新账号已关联。`),
        },
        tokens_updated: {
          title: i18n._(msg`账号重新连接成功！`),
          description: i18n._(msg`你的账号权限已刷新。`),
        },
      };

      const successMessage = successMessages[successParam] || {
        title: i18n._(msg`成功`),
        description: i18n._(msg`操作已成功完成。`),
      };

      toastSuccess({
        title: successMessage.title,
        description: successMessage.description,
      });

      setNotification(null);
      router.replace(pathname);
    }
  }, [searchParams, router, pathname, i18n]);

  return notification;
}

type AccountNotification = {
  title: string;
  description: ReactNode;
  toastDescription: string;
};

function getAccountErrorMessage(
  errorParam: string,
  errorDescription: string | null,
  i18n: I18n,
): AccountNotification {
  const defaultDescription =
    errorDescription || i18n._(msg`发生错误，请重试。`);

  const errorMessages: Record<string, AccountNotification> = {
    account_not_found_for_merge: {
      title: i18n._(msg`未找到账号`),
      description: i18n._(
        msg`此账号尚不存在于 ${BRAND_NAME}。请改为选择“不，这是一个新账号”。`,
      ),
      toastDescription: i18n._(
        msg`此账号尚不存在于 ${BRAND_NAME}。请改为选择“不，这是一个新账号”。`,
      ),
    },
    account_already_exists: {
      title: i18n._(msg`账号已存在`),
      description: i18n._(
        msg`此账号已关联到另一个 ${BRAND_NAME} 个人资料。请登录该资料、使用其他邮箱账号，或联系支持团队寻求帮助。`,
      ),
      toastDescription: i18n._(
        msg`此账号已关联到另一个 ${BRAND_NAME} 个人资料。请登录该资料、使用其他邮箱账号，或联系支持团队寻求帮助。`,
      ),
    },
    reconnect_account_mismatch: {
      title: i18n._(msg`登录了错误的账号`),
      description: i18n._(
        msg`你登录的账号与要重新连接的账号不同。请退出该提供商，或选择原账号后重试。`,
      ),
      toastDescription: i18n._(
        msg`你登录的账号与要重新连接的账号不同。请退出该提供商，或选择原账号后重试。`,
      ),
    },
    already_linked_to_self: {
      title: i18n._(msg`账号已关联`),
      description: i18n._(msg`此账号已关联到你的个人资料。`),
      toastDescription: i18n._(msg`此账号已关联到你的个人资料。`),
    },
    provider_sign_in_required: {
      title: i18n._(msg`需要登录提供商`),
      description: i18n._(
        msg`使用邮箱验证码登录时无法连接或重新连接邮箱。请使用 Google 或 Microsoft 登录后重试。`,
      ),
      toastDescription: i18n._(
        msg`使用邮箱验证码登录时无法连接或重新连接邮箱。请使用 Google 或 Microsoft 登录后重试。`,
      ),
    },
    invalid_state: {
      title: i18n._(msg`无效请求`),
      description: i18n._(msg`认证请求无效，请重试。`),
      toastDescription: i18n._(msg`认证请求无效，请重试。`),
    },
    invalid_state_format: {
      title: i18n._(msg`提供商返回了无效响应`),
      description: i18n._(
        msg`我们无法验证账号授权响应。请重新关联账号。如果问题仍然存在，请联系支持团队。`,
      ),
      toastDescription: i18n._(msg`我们无法验证账号授权响应。请重新关联账号。`),
    },
    missing_code: {
      title: i18n._(msg`认证失败`),
      description: i18n._(msg`未能收到认证码，请重试。`),
      toastDescription: i18n._(msg`未能收到认证码，请重试。`),
    },
    consent_declined: {
      title: i18n._(msg`未授予 Microsoft 权限`),
      description: i18n._(
        msg`${BRAND_NAME} 收到所需权限前，Microsoft 登录已被取消。请重试并完成同意屏幕。`,
      ),
      toastDescription: i18n._(
        msg`${BRAND_NAME} 收到所需权限前，Microsoft 登录已被取消。请重试并完成同意屏幕。`,
      ),
    },
    admin_consent_required: {
      title: i18n._(msg`需要管理员批准`),
      description: buildMicrosoftPermissionHelp(
        i18n._(
          msg`你的 Microsoft 365 组织需要管理员批准后，${BRAND_NAME} 才能访问此账号。`,
        ),
      ),
      toastDescription: i18n._(
        msg`你的 Microsoft 365 组织需要管理员批准后，${BRAND_NAME} 才能访问此账号。请让 Microsoft 365 管理员批准 ${BRAND_NAME}，然后重试。`,
      ),
    },
    invalid_scope_configuration: {
      title: i18n._(msg`Microsoft 应用设置需要处理`),
      description: buildMicrosoftPermissionHelp(
        i18n._(msg`Microsoft 拒绝了此应用请求的权限。`),
      ),
      toastDescription: i18n._(
        msg`Microsoft 拒绝了此应用请求的权限。请让管理员验证委托的 Microsoft Graph 权限和重定向 URL，然后重试。`,
      ),
    },
    consent_incomplete: {
      title: i18n._(msg`需要更多 Microsoft 权限`),
      description: buildMicrosoftPermissionHelp(
        i18n._(
          msg`Microsoft 已连接账号，但未向 ${BRAND_NAME} 授予所有必需权限。`,
        ),
      ),
      toastDescription: i18n._(
        msg`Microsoft 已连接账号，但未授予所有必需权限。请重新连接并批准每一项请求的权限。如果你的组织限制同意操作，请先让管理员批准 ${BRAND_NAME}。`,
      ),
    },
    link_failed: {
      title: i18n._(msg`账号关联失败`),
      description: errorDescription || i18n._(msg`关联账号失败，请重试。`),
      toastDescription: errorDescription || i18n._(msg`关联账号失败，请重试。`),
    },
  };

  return (
    errorMessages[errorParam] || {
      title: i18n._(msg`错误`),
      description: defaultDescription,
      toastDescription: defaultDescription,
    }
  );
}

function buildMicrosoftPermissionHelp(summary: string) {
  return (
    <div className="space-y-3">
      <p>
        <Trans>
          {summary} 这通常表示你的 Microsoft 365
          组织允许登录，但未返回完成账号连接所需的全部权限。
        </Trans>
      </p>
      <p>
        <Trans>
          请让 Microsoft 365 管理员为 {BRAND_NAME} 批准下方的 Microsoft Graph
          权限，然后重试。
        </Trans>
      </p>
      <Button asChild size="sm">
        <Link href="/login/microsoft-admin-consent">
          <Trans>打开 Microsoft 管理员批准</Trans>
        </Link>
      </Button>
      <div>
        <p className="font-medium">
          <Trans>电子邮件和收件箱连接</Trans>
        </p>
        <PermissionList scopes={MICROSOFT_EMAIL_SCOPES} />
      </div>
      <div>
        <p className="font-medium">
          <Trans>稍后连接其他 Microsoft 功能时所需的额外权限</Trans>
        </p>
        <div className="space-y-2">
          <div>
            <p className="font-medium">
              <Trans>日历</Trans>
            </p>
            <PermissionList scopes={CALENDAR_SCOPES} />
          </div>
          <div>
            <p className="font-medium">
              <Trans>文档和 OneDrive</Trans>
            </p>
            <PermissionList scopes={MICROSOFT_DRIVE_SCOPES} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionList({ scopes }: { scopes: readonly string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5">
      {scopes.map((scope) => (
        <li key={scope}>
          <code>{scope}</code>
        </li>
      ))}
    </ul>
  );
}
