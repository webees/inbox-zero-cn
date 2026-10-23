"use client";

import Link from "next/link";
import { MailIcon, SparklesIcon } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/utils";
import { prefixPath } from "@/utils/path";

type AppSection = "mail" | "assistant";

const SECTIONS = [
  { id: "mail", name: "邮件", label: "邮件", path: "/mail", icon: MailIcon },
  {
    id: "assistant",
    name: "助手",
    label: "助手",
    path: "/automation",
    icon: SparklesIcon,
  },
] as const;

/**
 * 应用侧栏和邮件侧栏的顶部：侧栏切换按钮，以及邮件客户端和 AI 助手之间的切换。
 * 两侧栏共享此组件，以便完全对齐，包括在 mac 窗口控制按钮下方。
 */
export function AppSidebarHeader({
  active,
  emailAccountId,
  collapsed,
  hideToggle = false,
}: {
  active: AppSection;
  emailAccountId: string;
  collapsed: boolean;
  /** 用于覆层，它们会自行关闭而不是折叠。 */
  hideToggle?: boolean;
}) {
  // 在 mac 桌面上，两种状态下切换按钮都会被移到窗口控制按钮旁边，
  // 因此页眉只需避开会吞掉点击的控制按钮拖拽区域。
  // 侧栏位于窗口顶部下方 0.5rem。
  if (collapsed) {
    return (
      <div className="flex flex-col items-start pt-[max(0px,calc(var(--desktop-traffic-lights-height,0px)-0.5rem))]">
        <SidebarTrigger
          name="left-sidebar"
          className="mb-2"
          data-desktop-mac-titlebar-toggle
        />
        <AppSectionSwitcher
          active={active}
          emailAccountId={emailAccountId}
          collapsed
        />
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1 pt-[max(0px,calc(var(--desktop-traffic-lights-height,0px)-0.5rem))] pb-2">
      <AppSectionSwitcher
        active={active}
        emailAccountId={emailAccountId}
        collapsed={false}
      />
      {hideToggle ? null : (
        <SidebarTrigger name="left-sidebar" data-desktop-mac-titlebar-toggle />
      )}
    </div>
  );
}

function AppSectionSwitcher({
  active,
  emailAccountId,
  collapsed,
}: {
  active: AppSection;
  emailAccountId: string;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <nav aria-label="应用分区" className="flex flex-col gap-1 pb-2">
        {SECTIONS.map((section) => {
          const isActive = section.id === active;
          return (
            <Tooltip key={section.id}>
              <TooltipTrigger asChild>
                <Link
                  href={prefixPath(emailAccountId, section.path)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <section.icon className="size-4" />
                  <span className="sr-only">{section.label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{section.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="应用分区"
      className="grid flex-1 grid-cols-2 gap-0.5 rounded-lg bg-sidebar-accent p-0.5"
    >
      {SECTIONS.map((section) => {
        const isActive = section.id === active;
        return (
          <Link
            key={section.id}
            href={prefixPath(emailAccountId, section.path)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center justify-center rounded-md px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
