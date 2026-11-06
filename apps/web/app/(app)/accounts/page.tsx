"use client";

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
  const { data, isLoading, error, mutate } = useAccounts();
  const notification = useAccountNotifications();

  return (
    <PageWrapper>
      <PageHeader title="账号" />
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
          <AddAccount />
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
  const { execute, isExecuting } = useAction(deleteEmailAccountAction, {
    onSuccess: async () => {
      toastSuccess({
        title: "邮箱账号已删除",
        description: "邮箱账号已成功删除。",
      });
      onAccountDeleted();
      if (emailAccount.isPrimary) {
        await logOut("/login");
      } else {
        try {
          await clearLocalMailAccountState(emailAccount.id);
        } catch {
          toastError({
            title: "本地邮箱仍在此设备上",
            description: "账号已删除。请退出登录，以完成从此设备上移除其邮件。",
          });
        }
        await clearOfflineMailCacheForAccount(emailAccount.id);
      }
    },
    onError: (error) => {
      toastError({
        title: "删除邮箱账号时出错",
        description: getActionErrorMessage(error.error),
      });
      onAccountDeleted();
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="账号选项">
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
            设置
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
              删除
            </DropdownMenuItem>
          }
          title="删除账号"
          description={
            emailAccount.isPrimary
              ? `你确定要删除“${emailAccount.email}”吗？这是你的主账号。你将被退出登录，需要重新登录。剩余账号中最早添加的账号将成为新的主账号。“${emailAccount.email}”的所有数据将从 ${BRAND_NAME} 中永久删除。`
              : `你确定要删除“${emailAccount.email}”吗？这将删除其在 ${BRAND_NAME} 上的所有数据。`
          }
          confirmText="删除"
          onConfirm={() => {
            execute({ emailAccountId: emailAccount.id });
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useAccountNotifications() {
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
          title: "账号合并成功！",
          description: "你的账号已合并。",
        },
        account_created_and_linked: {
          title: "账号添加成功！",
          description: "你的新账号已关联。",
        },
        tokens_updated: {
          title: "账号重新连接成功！",
          description: "你的账号权限已刷新。",
        },
      };

      const successMessage = successMessages[successParam] || {
        title: "成功",
        description: "操作已成功完成。",
      };

      toastSuccess({
        title: successMessage.title,
        description: successMessage.description,
      });

      setNotification(null);
      router.replace(pathname);
    }
  }, [searchParams, router, pathname]);

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
): AccountNotification {
  const defaultDescription = errorDescription || "发生错误。请重试。";

  const errorMessages: Record<string, AccountNotification> = {
    account_not_found_for_merge: {
      title: "未找到账号",
      description: `此账号在 ${BRAND_NAME} 中尚不存在。请改为选择“不，这是一个新账号”。`,
      toastDescription: `此账号在 ${BRAND_NAME} 中尚不存在。请改为选择“不，这是一个新账号”。`,
    },
    account_already_exists: {
      title: "账号已存在",
      description: `此账号已关联到另一个 ${BRAND_NAME} 个人资料。请登录该个人资料、使用其他邮箱账号，或联系支持人员寻求帮助。`,
      toastDescription: `此账号已关联到另一个 ${BRAND_NAME} 个人资料。请登录该个人资料、使用其他邮箱账号，或联系支持人员寻求帮助。`,
    },
    reconnect_account_mismatch: {
      title: "登录的账号不正确",
      description:
        "你登录的账号与你正在重新连接的账号不同。请退出该服务商，或选择原来的账号，然后重试。",
      toastDescription:
        "你登录的账号与你正在重新连接的账号不同。请退出该服务商，或选择原来的账号，然后重试。",
    },
    already_linked_to_self: {
      title: "账号已关联",
      description: "此账号已关联到你的个人资料。",
      toastDescription: "此账号已关联到你的个人资料。",
    },
    provider_sign_in_required: {
      title: "需要登录服务商",
      description:
        "使用邮箱验证码登录时，无法连接或重新连接邮箱。请使用 Google 或 Microsoft 登录，然后重试。",
      toastDescription:
        "使用邮箱验证码登录时，无法连接或重新连接邮箱。请使用 Google 或 Microsoft 登录，然后重试。",
    },
    invalid_state: {
      title: "无效请求",
      description: "身份验证请求无效。请重试。",
      toastDescription: "身份验证请求无效。请重试。",
    },
    invalid_state_format: {
      title: "服务商返回无效响应",
      description:
        "我们无法验证账号授权响应。请再次尝试关联账号。如果问题仍然存在，请联系支持人员。",
      toastDescription: "我们无法验证账号授权响应。请再次尝试关联账号。",
    },
    missing_code: {
      title: "身份验证失败",
      description: "未能收到验证码。请重试。",
      toastDescription: "未能收到验证码。请重试。",
    },
    consent_declined: {
      title: "未授予 Microsoft 权限",
      description: `在 ${BRAND_NAME} 收到所需权限之前，Microsoft 登录被取消。请重试并完成同意屏幕。`,
      toastDescription: `在 ${BRAND_NAME} 收到所需权限之前，Microsoft 登录被取消。请重试并完成同意屏幕。`,
    },
    admin_consent_required: {
      title: "需要管理员审批",
      description: buildMicrosoftPermissionHelp(
        `你的 Microsoft 365 组织需要管理员审批后，${BRAND_NAME} 才能访问此账号。`,
      ),
      toastDescription: `你的 Microsoft 365 组织需要管理员审批后，${BRAND_NAME} 才能访问此账号。请让你的 Microsoft 365 管理员批准 ${BRAND_NAME}，然后重试。`,
    },
    invalid_scope_configuration: {
      title: "Microsoft 应用设置需要注意",
      description: buildMicrosoftPermissionHelp(
        "Microsoft 拒绝了此应用请求的权限。",
      ),
      toastDescription:
        "Microsoft 拒绝了此应用请求的权限。请让你的管理员核实委托的 Microsoft Graph 权限和重定向 URL，然后重试。",
    },
    consent_incomplete: {
      title: "需要更多 Microsoft 权限",
      description: buildMicrosoftPermissionHelp(
        `Microsoft 已连接该账号，但未向 ${BRAND_NAME} 授予所有必需的权限。`,
      ),
      toastDescription: `Microsoft 已连接该账号，但未授予所有必需的权限。请重新连接并批准每一项请求的权限。如果你的组织限制了同意，请先让你的管理员批准 ${BRAND_NAME}。`,
    },
    link_failed: {
      title: "账号关联失败",
      description: errorDescription || "关联账号失败。请重试。",
      toastDescription: errorDescription || "关联账号失败。请重试。",
    },
  };

  return (
    errorMessages[errorParam] || {
      title: "错误",
      description: defaultDescription,
      toastDescription: defaultDescription,
    }
  );
}

function buildMicrosoftPermissionHelp(summary: string) {
  return (
    <div className="space-y-3">
      <p>
        {summary} 这通常意味着你的 Microsoft 365
        组织允许了登录，但没有返回完成账号连接所需的全部权限。
      </p>
      <p>
        请让你的 Microsoft 365 管理员为下方 Microsoft Graph 权限批准{" "}
        {BRAND_NAME}
        ，然后重试。
      </p>
      <Button asChild size="sm">
        <Link href="/login/microsoft-admin-consent">
          打开 Microsoft 管理员审批
        </Link>
      </Button>
      <div>
        <p className="font-medium">邮件与收件箱连接</p>
        <PermissionList scopes={MICROSOFT_EMAIL_SCOPES} />
      </div>
      <div>
        <p className="font-medium">
          如果以后连接其他 Microsoft 功能所需的额外权限
        </p>
        <div className="space-y-2">
          <div>
            <p className="font-medium">日历</p>
            <PermissionList scopes={CALENDAR_SCOPES} />
          </div>
          <div>
            <p className="font-medium">文档与 OneDrive</p>
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
