"use client";

import { DownloadIcon } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useDesktopUpdateStatus } from "@/hooks/useDesktopUpdateStatus";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

export function DesktopUpdateMenuItem() {
  const status = useDesktopUpdateStatus();
  if (status?.state !== "ready") return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem className="font-semibold">
        <SidebarMenuButton
          className="h-9"
          tooltip="重启以更新"
          sidebarName="left-sidebar"
          onClick={() => getInboxZeroDesktopApp()?.installUpdate?.()}
        >
          <DownloadIcon />
          <span>重启以更新</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
