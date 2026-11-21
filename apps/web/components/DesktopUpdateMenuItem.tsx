"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { DownloadIcon } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useDesktopUpdateStatus } from "@/hooks/useDesktopUpdateStatus";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

export function DesktopUpdateMenuItem() {
  const { t } = useLingui();
  const status = useDesktopUpdateStatus();
  if (status?.state !== "ready") return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem className="font-semibold">
        <SidebarMenuButton
          className="h-9"
          tooltip={t`重启以更新`}
          sidebarName="left-sidebar"
          onClick={() => getInboxZeroDesktopApp()?.installUpdate?.()}
        >
          <DownloadIcon />
          <span>
            <Trans>重启以更新</Trans>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
