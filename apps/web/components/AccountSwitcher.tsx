"use client";

import { useCallback } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAccounts } from "@/hooks/useAccounts";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import { useAccount } from "@/providers/EmailAccountProvider";
import { setLastEmailAccountAction } from "@/utils/actions/email-account-cookie";
import { ProfileImage } from "@/components/ProfileImage";
import { getAccountSwitchUrl } from "@/utils/account-switch-url";
import { redirectToSafeUrl } from "@/utils/redirect";
export function AccountSwitcher() {
  const { data: accountsData } = useAccounts();

  if (!accountsData) return null;

  return <AccountSwitcherInternal emailAccounts={accountsData.emailAccounts} />;
}

export function AccountSwitcherInternal({
  emailAccounts,
}: {
  emailAccounts: GetEmailAccountsResponse["emailAccounts"];
}) {
  const { isMobile } = useSidebar();

  const {
    emailAccountId: activeEmailAccountId,
    emailAccount: activeEmailAccount,
    isLoading,
  } = useAccount();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ emailAccountId?: string }>();

  const getHref = useCallback(
    (emailAccountId: string) => {
      if (!activeEmailAccountId) return `/${emailAccountId}/setup`;

      return getAccountSwitchUrl({
        pathname,
        currentAccountId: params.emailAccountId,
        targetAccountId: emailAccountId,
        tab: searchParams.get("tab"),
      });
    },
    [pathname, activeEmailAccountId, params.emailAccountId, searchParams],
  );

  const handleSelect = useCallback(
    async (emailAccountId: string) => {
      try {
        await setLastEmailAccountAction({ emailAccountId });
      } catch {
        // 忽略 cookie 更新失败并继续导航。
      }

      // 强制硬刷新页面以刷新所有数据。
      // 我试过通过重置 SWR 缓存来修复，但似乎不起作用。这样可靠得多。
      redirectToSafeUrl(getHref(emailAccountId));
    },
    [getHref],
  );

  if (isLoading) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              sidebarName="left-sidebar"
            >
              {activeEmailAccount ? (
                <>
                  <div className="flex aspect-square size-8 items-center justify-center">
                    <ProfileImage
                      image={activeEmailAccount.image}
                      label={
                        activeEmailAccount.name || activeEmailAccount.email
                      }
                    />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {activeEmailAccount.name || activeEmailAccount.email}
                    </span>
                    {activeEmailAccount.name && (
                      <span className="truncate text-xs text-muted-foreground">
                        {activeEmailAccount.email}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div>选择账号</div>
              )}
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-80 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              账号
            </DropdownMenuLabel>
            {emailAccounts.map((emailAccount) => (
              <DropdownMenuItem
                key={emailAccount.id}
                className="gap-2 p-2"
                onSelect={() => {
                  handleSelect(emailAccount.id);
                }}
              >
                <ProfileImage
                  image={emailAccount.image}
                  label={emailAccount.name || emailAccount.email}
                />
                <div className="flex flex-col">
                  <span className="truncate font-medium">
                    {emailAccount.name || emailAccount.email}
                  </span>
                  {emailAccount.name && (
                    <span className="truncate text-xs text-muted-foreground">
                      {emailAccount.email}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <Link href="/accounts">
              <DropdownMenuItem className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  添加或管理账号
                </div>
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
