"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryState } from "nuqs";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { getEmailTerminologyMessages } from "@/utils/terminology-messages";
import { NavUser } from "@/components/NavUser";
import { SidebarCards } from "@/components/sidebar-cards/SidebarCards";
import { AppSidebarHeader } from "@/components/AppSidebarHeader";
import { FeedbackSidebarButton } from "@/components/FeedbackDialog";
import { TEAM_HREF, useTeamNav } from "@/components/team-comments/use-team-nav";

type NavItem = {
  name: string;
  label?: MessageDescriptor;
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
        label: msg`聊天`,
        href: prefixPath(currentEmailAccountId, "/assistant"),
        icon: MessageSquareIcon,
      },
      {
        name: "规则",
        label: msg`规则`,
        href: prefixPath(currentEmailAccountId, "/automation"),
        icon: SparklesIcon,
      },
      {
        name: "频道",
        label: msg`频道`,
        href: prefixPath(currentEmailAccountId, "/channels"),
        icon: MessagesSquareIcon,
      },
      ...(showMeetingRecorder
        ? [
            {
              name: "会议",
              label: msg`会议`,
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
        label: msg`批量退订`,
        href: prefixPath(currentEmailAccountId, "/bulk-unsubscribe"),
        icon: MailsIcon,
      },
      {
        name: "批量归档",
        label: msg`批量归档`,
        href: prefixPath(currentEmailAccountId, "/bulk-archive"),
        icon: ArchiveIcon,
      },
      {
        name: "分析",
        label: msg`分析`,
        href: prefixPath(currentEmailAccountId, "/stats"),
        icon: BarChartBigIcon,
      },
      ...(isGoogleProvider(provider) && showCleaner
        ? [
            {
              name: "深度清理",
              label: msg`深度清理`,
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
        label: msg`日历`,
        href: prefixPath(currentEmailAccountId, "/calendars"),
        icon: CalendarIcon,
      },
      ...(showMeetingBriefs
        ? [
            {
              name: "会议简报",
              label: msg`会议简报`,
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
              label: msg`附件`,
              href: prefixPath(currentEmailAccountId, "/drive"),
              icon: HardDriveIcon,
              new: false,
            },
          ]),
      ...(showIntegrations
        ? [
            {
              name: "集成",
              label: msg`集成`,
              href: prefixPath(currentEmailAccountId, "/integrations"),
              icon: ZapIcon,
            },
          ]
        : []),
      ...(hasTeam
        ? [
            {
              name: "讨论",
              label: msg`讨论`,
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
    label: msg`获取应用`,
    icon: SmartphoneIcon,
    href: "/download",
    target: "_blank",
  },
];

const topMailLinks: NavItem[] = [
  {
    name: "收件箱",
    label: msg`收件箱`,
    icon: InboxIcon,
    href: "?type=inbox",
  },
  {
    name: "草稿",
    label: msg`草稿`,
    icon: FileIcon,
    href: "?type=draft",
  },
  {
    name: "已发送",
    label: msg`已发送`,
    icon: SendIcon,
    href: "?type=sent",
  },
  {
    name: "已归档",
    label: msg`已归档`,
    icon: ArchiveIcon,
    href: "?type=archive",
  },
];

const bottomMailLinks: NavItem[] = [
  {
    name: "个人",
    label: msg`个人`,
    icon: PersonStandingIcon,
    href: "?type=CATEGORY_PERSONAL",
  },
  {
    name: "社交",
    label: msg`社交`,
    icon: Users2Icon,
    href: "?type=CATEGORY_SOCIAL",
  },
  {
    name: "更新",
    label: msg`更新`,
    icon: AlertCircleIcon,
    href: "?type=CATEGORY_UPDATES",
  },
  {
    name: "论坛",
    label: msg`论坛`,
    icon: MessagesSquareIcon,
    href: "?type=CATEGORY_FORUMS",
  },
  {
    name: "推广",
    label: msg`推广`,
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
              label: msg`返回`,
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
          // 手机端抽屉始终显示完整侧边栏。
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
                <SidebarGroupLabel>
                  <Trans>管理</Trans>
                </SidebarGroupLabel>
                <SideNavMenu items={navigation.manageItems} activeHref={path} />
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>
                  <Trans>清理</Trans>
                </SidebarGroupLabel>
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
                    <span>
                      <Trans>工具</Trans>
                    </span>
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

      <SidebarCards
        className="px-3 pt-4"
        collapsed={!state.includes("left-sidebar")}
      />

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
  const { i18n } = useLingui();
  const isOutlook = isMicrosoftProvider(provider);
  const terminology = getEmailTerminologyMessages(provider);

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
              <span className="truncate font-semibold">
                <Trans>撰写邮件</Trans>
              </span>
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
          <SidebarGroupLabel>
            <Trans>分类</Trans>
          </SidebarGroupLabel>
          <SideNavMenu
            items={markActiveType(bottomMailLinks, activeType)}
            activeHref={path}
          />
        </SidebarGroup>
      )}

      <SidebarGroup>
        <SidebarGroupLabel>
          {i18n._(terminology.label.pluralCapitalized)}
        </SidebarGroupLabel>
        <LoadingContent loading={isLoading}>
          {visibleLabels.length > 0 ? (
            <SideNavMenu items={labelNavItems} activeHref={path} />
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {isOutlook ? <Trans>无分类</Trans> : <Trans>无标签</Trans>}
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
                <span>
                  <Trans>更多</Trans>
                </span>
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
