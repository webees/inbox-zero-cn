"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryState } from "nuqs";
import { getEmailTerminology } from "@/utils/terminology";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BarChartBigIcon,
  BrushIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FileTextIcon,
  HardDriveIcon,
  InboxIcon,
  type LucideIcon,
  MailsIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  MicIcon,
  PenIcon,
  PersonStandingIcon,
  RatioIcon,
  SendIcon,
  SmartphoneIcon,
  SparklesIcon,
  Users2Icon,
  ZapIcon,
} from "lucide-react";
import { useComposeModal } from "@/providers/ComposeModalProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarGroup,
  SidebarHeader,
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { SetupProgressCard } from "@/components/SetupProgressCard";
import { DesktopUpdateMenuItem } from "@/components/DesktopUpdateMenuItem";
import { SideNavMenu } from "@/components/SideNavMenu";
import { CommandShortcut } from "@/components/ui/command";
import { useSplitLabels } from "@/hooks/useLabels";
import type { EmailLabel } from "@/providers/email-label-types";
import { LoadingContent } from "@/components/LoadingContent";
import { env } from "@/env";
import {
  useCleanerEnabled,
  useIntegrationsEnabled,
  useMeetingBriefsEnabled,
  useMeetingRecorderEnabled,
} from "@/hooks/useFeatureFlags";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { NavUser } from "@/components/NavUser";
import { PremiumCard } from "@/components/PremiumCard";
import { AppSidebarHeader } from "@/components/AppSidebarHeader";
import { FeedbackSidebarButton } from "@/components/FeedbackDialog";
import { TEAM_HREF, useTeamNav } from "@/components/team-comments/use-team-nav";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon | (() => React.ReactNode);
  target?: "_blank";
  count?: number;
  hideInMail?: boolean;
  active?: boolean;
  beta?: boolean;
  new?: boolean;
};

export const useNavigation = () => {
  const showCleaner = useCleanerEnabled();
  const showMeetingBriefs = useMeetingBriefsEnabled();
  const showMeetingRecorder = useMeetingRecorderEnabled();
  const showIntegrations = useIntegrationsEnabled();
  const { hasTeam, unreadCount: teamUnreadCount } = useTeamNav();

  const { emailAccount, emailAccountId, provider } = useAccount();
  const currentEmailAccountId = emailAccount?.id || emailAccountId;

  const manageItems: NavItem[] = useMemo(
    () => [
      {
        name: "聊天",
        href: prefixPath(currentEmailAccountId, "/assistant"),
        icon: MessageSquareIcon,
      },
      {
        name: "规则",
        href: prefixPath(currentEmailAccountId, "/automation"),
        icon: SparklesIcon,
      },
      {
        name: "渠道",
        href: prefixPath(currentEmailAccountId, "/channels"),
        icon: MessagesSquareIcon,
      },
      ...(showMeetingRecorder
        ? [
            {
              name: "会议",
              href: prefixPath(currentEmailAccountId, "/meetings"),
              icon: MicIcon,
            },
          ]
        : []),
    ],
    [currentEmailAccountId, showMeetingRecorder],
  );

  const cleanupItems: NavItem[] = useMemo(
    () => [
      {
        name: "批量退订",
        href: prefixPath(currentEmailAccountId, "/bulk-unsubscribe"),
        icon: MailsIcon,
      },
      {
        name: "批量归档",
        href: prefixPath(currentEmailAccountId, "/bulk-archive"),
        icon: ArchiveIcon,
      },
      {
        name: "分析",
        href: prefixPath(currentEmailAccountId, "/stats"),
        icon: BarChartBigIcon,
      },
      ...(isGoogleProvider(provider) && showCleaner
        ? [
            {
              name: "深度清理",
              href: prefixPath(currentEmailAccountId, "/clean"),
              icon: BrushIcon,
              beta: true,
            },
          ]
        : []),
    ],
    [currentEmailAccountId, provider, showCleaner],
  );

  const moreItems: NavItem[] = useMemo(
    () => [
      {
        name: "日历",
        href: prefixPath(currentEmailAccountId, "/calendars"),
        icon: CalendarIcon,
      },
      ...(showMeetingBriefs
        ? [
            {
              name: "会议简报",
              href: prefixPath(currentEmailAccountId, "/briefs"),
              icon: FileTextIcon,
            },
          ]
        : []),
      ...(env.NEXT_PUBLIC_SMART_FILING_ENABLED === false
        ? []
        : [
            {
              name: "附件",
              href: prefixPath(currentEmailAccountId, "/drive"),
              icon: HardDriveIcon,
              new: false,
            },
          ]),
      ...(showIntegrations
        ? [
            {
              name: "集成",
              href: prefixPath(currentEmailAccountId, "/integrations"),
              icon: ZapIcon,
            },
          ]
        : []),
      ...(hasTeam
        ? [
            {
              name: "讨论",
              href: TEAM_HREF,
              icon: Users2Icon,
              count: teamUnreadCount ?? undefined,
            },
          ]
        : []),
    ],
    [
      currentEmailAccountId,
      showMeetingBriefs,
      showIntegrations,
      hasTeam,
      teamUnreadCount,
    ],
  );

  return {
    emailAccountId: currentEmailAccountId,
    manageItems,
    cleanupItems,
    moreItems,
  };
};

const getTheAppLinks: NavItem[] = [
  {
    name: "获取应用",
    icon: SmartphoneIcon,
    href: "/download",
    target: "_blank",
  },
];

const topMailLinks: NavItem[] = [
  {
    name: "收件箱",
    icon: InboxIcon,
    href: "?type=inbox",
  },
  {
    name: "草稿",
    icon: FileIcon,
    href: "?type=draft",
  },
  {
    name: "已发送",
    icon: SendIcon,
    href: "?type=sent",
  },
  {
    name: "已归档",
    icon: ArchiveIcon,
    href: "?type=archive",
  },
];

const bottomMailLinks: NavItem[] = [
  {
    name: "个人",
    icon: PersonStandingIcon,
    href: "?type=CATEGORY_PERSONAL",
  },
  {
    name: "社交",
    icon: Users2Icon,
    href: "?type=CATEGORY_SOCIAL",
  },
  {
    name: "更新",
    icon: AlertCircleIcon,
    href: "?type=CATEGORY_UPDATES",
  },
  {
    name: "论坛",
    icon: MessagesSquareIcon,
    href: "?type=CATEGORY_FORUMS",
  },
  {
    name: "促销",
    icon: RatioIcon,
    href: "?type=CATEGORY_PROMOTIONS",
  },
];

export function SideNav({
  feedbackEnabled,
  ...props
}: React.ComponentProps<typeof Sidebar> & { feedbackEnabled: boolean }) {
  const navigation = useNavigation();
  const path = usePathname();
  const showMailNav = path.includes("/compose");
  const isMoreActive = navigation.moreItems.some(
    (item) => path === item.href || path.startsWith(`${item.href}/`),
  );
  const [showMoreItems, setShowMoreItems] = useState(isMoreActive);

  useEffect(() => {
    if (isMoreActive) setShowMoreItems(true);
  }, [isMoreActive]);

  const visibleBottomLinks = useMemo(
    () =>
      showMailNav
        ? [
            {
              name: "返回",
              href: "/automation",
              icon: ArrowLeftIcon,
            },
          ]
        : [],
    [showMailNav],
  );

  const { state, isMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-0 pb-0">
        <AppSidebarHeader
          active="assistant"
          emailAccountId={navigation.emailAccountId}
          // The phone sheet always shows the full sidebar.
          collapsed={!isMobile && !state.includes("left-sidebar")}
        />
        <AccountSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {state.includes("left-sidebar") ? <SetupProgressCard /> : null}

        <SidebarGroupContent>
          {showMailNav ? (
            <MailNav path={path} />
          ) : (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>管理</SidebarGroupLabel>
                <SideNavMenu items={navigation.manageItems} activeHref={path} />
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>清理</SidebarGroupLabel>
                <SideNavMenu
                  items={navigation.cleanupItems}
                  activeHref={path}
                />
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer gap-1"
                    onClick={() => setShowMoreItems((value) => !value)}
                    aria-expanded={showMoreItems}
                  >
                    {showMoreItems ? (
                      <ChevronDownIcon className="size-3.5" />
                    ) : (
                      <ChevronRightIcon className="size-3.5" />
                    )}
                    <span>工具</span>
                  </button>
                </SidebarGroupLabel>
                {showMoreItems && (
                  <SideNavMenu items={navigation.moreItems} activeHref={path} />
                )}
              </SidebarGroup>
            </>
          )}
        </SidebarGroupContent>
      </SidebarContent>

      <PremiumCard isCollapsed={!state.includes("left-sidebar")} />

      <SidebarFooter className="pb-4">
        <DesktopUpdateMenuItem />
        <SideNavMenu items={visibleBottomLinks} activeHref={path} />

        <SideNavMenu items={getTheAppLinks} activeHref={path} />

        {feedbackEnabled && (
          <SidebarMenu>
            <SidebarMenuItem>
              <FeedbackSidebarButton />
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}

function MailNav({ path }: { path: string }) {
  const { onOpen } = useComposeModal();
  const [showHiddenLabels, setShowHiddenLabels] = useState(false);
  const { visibleLabels, hiddenLabels, isLoading } = useSplitLabels();
  const { provider } = useAccount();
  const terminology = getEmailTerminology(provider);

  const [currentType] = useQueryState("type");
  const [currentLabelId] = useQueryState("labelId");
  // The mail page defaults to the inbox when no type is selected
  const activeType = currentLabelId ? null : (currentType ?? "inbox");

  const labelNavItems = useMemo(
    () => visibleLabels.map((label) => labelToNavItem(label, currentLabelId)),
    [visibleLabels, currentLabelId],
  );

  const hiddenLabelNavItems = useMemo(
    () => hiddenLabels.map((label) => labelToNavItem(label, currentLabelId)),
    [hiddenLabels, currentLabelId],
  );

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-9 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              onClick={onOpen}
              sidebarName="left-sidebar"
            >
              <PenIcon className="size-4" />
              <span className="truncate font-semibold">写邮件</span>
              <CommandShortcut>C</CommandShortcut>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup>
        <SideNavMenu
          items={markActiveType(topMailLinks, activeType)}
          activeHref={path}
        />
      </SidebarGroup>
      {isGoogleProvider(provider) && (
        <SidebarGroup>
          <SidebarGroupLabel>分类</SidebarGroupLabel>
          <SideNavMenu
            items={markActiveType(bottomMailLinks, activeType)}
            activeHref={path}
          />
        </SidebarGroup>
      )}

      <SidebarGroup>
        <SidebarGroupLabel>
          {terminology.label.pluralCapitalized}
        </SidebarGroupLabel>
        <LoadingContent loading={isLoading}>
          {visibleLabels.length > 0 ? (
            <SideNavMenu items={labelNavItems} activeHref={path} />
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              暂无{terminology.label.plural}
            </div>
          )}

          {/* Hidden labels toggle */}
          {hiddenLabels.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowHiddenLabels(!showHiddenLabels)}
                className="flex w-full items-center px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {showHiddenLabels ? (
                  <ChevronDownIcon className="mr-1 size-4" />
                ) : (
                  <ChevronRightIcon className="mr-1 size-4" />
                )}
                <span>更多</span>
              </button>

              {showHiddenLabels && (
                <SideNavMenu items={hiddenLabelNavItems} activeHref={path} />
              )}
            </>
          )}
        </LoadingContent>
      </SidebarGroup>
    </>
  );
}

function markActiveType(items: NavItem[], activeType: string | null) {
  return items.map((item) => ({
    ...item,
    active: item.href === `?type=${activeType}`,
  }));
}

function labelToNavItem(
  label: EmailLabel,
  currentLabelId: string | null,
): NavItem {
  return {
    name: label.name,
    icon: () => (
      <span
        className="size-2.5 shrink-0 rounded-full"
        // Match Gmail/Outlook: labels without an assigned color are gray
        style={{
          backgroundColor: label.color?.backgroundColor || "#9CA3AF",
        }}
      />
    ),
    href: `?type=label&labelId=${encodeURIComponent(label.id)}`,
    active: currentLabelId === label.id,
  };
}
