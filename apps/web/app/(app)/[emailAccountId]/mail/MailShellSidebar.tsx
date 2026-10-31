"use client";

import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import { MailAccountSwitcher } from "@/app/(app)/[emailAccountId]/mail/MailAccountSwitcher";
import {
  getMailCategories,
  getMailNavPath,
  type MailCategory,
  MailSidebar,
  type MailNavTarget,
} from "@/app/(app)/[emailAccountId]/mail/MailSidebar";
import type {
  MailboxItem,
  MailboxItemEdit,
} from "@/app/(app)/[emailAccountId]/mail/MailboxItemContextMenu";
import {
  MAIL_SIDEBAR_DEFAULT_WIDTH,
  MAIL_SIDEBAR_WIDTH_BOUNDS,
  MAIL_SIDEBAR_WIDTH_COOKIE,
} from "@/app/(app)/[emailAccountId]/mail/panel-widths";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { DesktopUpdateMenuItem } from "@/components/DesktopUpdateMenuItem";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { TEAM_HREF, useTeamNav } from "@/components/team-comments/use-team-nav";
import { useFolders } from "@/hooks/useFolders";
import { useLabelCounts } from "@/hooks/useLabelCounts";
import { useLabels } from "@/hooks/useLabels";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useComposeModal } from "@/providers/ComposeModalProvider";
import type { EmailLabel } from "@/providers/email-label-types";
import type { OutlookFolder } from "@/utils/outlook/folders";
import { persistPanelWidth } from "@/utils/panel-width";
import {
  createLabelAction,
  deleteMailboxItemAction,
  updateMailboxItemAction,
} from "@/utils/actions/mail";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { getActionErrorMessage } from "@/utils/error";
import { GMAIL_LABEL_COLORS } from "@/utils/gmail/label-colors";
import type { MailboxLabelCount } from "@/utils/mail-engine/label-count-targets";
import { OUTLOOK_CATEGORY_COLORS } from "@/utils/outlook/category-colors";
import { prefixPath } from "@/utils/path";
import { getEmailTerminology } from "@/utils/terminology";

const OUTLOOK_LABEL_COLOR_OPTIONS = OUTLOOK_CATEGORY_COLORS.map((option) => ({
  name: option.name,
  backgroundColor: option.value,
  textColor: "#000000",
}));
const NO_COUNTS = new Map<string, MailboxLabelCount>();
const NO_LABELS: EmailLabel[] = [];
const NO_FOLDERS: OutlookFolder[] = [];
const NO_CATEGORIES: MailCategory[] = [];

/**
 * 邮件界面的左侧栏。它负责标签计数和邮箱编辑，使相关更新留在此处，
 * 并通过 memo 缓存，避免会话导航和列表快照触发重新渲染。
 */
export const MailShellSidebar = memo(function MailShellSidebar({
  activeType,
  activeLabelId,
  activeFolderId,
  isAllAccounts,
  isDesktopApp,
  onSelectAccount,
  onSelectAllAccounts,
  onMailboxItemDeleted,
  onNavigate,
  isMobileNavOpen,
  onMobileNavOpenChange,
}: {
  activeType: string | null;
  activeLabelId: string | null;
  activeFolderId: string | null;
  isAllAccounts: boolean;
  isDesktopApp: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectAllAccounts: () => void;
  /** 离开由被删除的标签或文件夹定义的视图或分类。 */
  onMailboxItemDeleted: (item: MailboxItem) => Promise<unknown>;
  onNavigate: () => void;
  isMobileNavOpen: boolean;
  onMobileNavOpenChange: (open: boolean) => void;
}) {
  const { emailAccountId, provider } = useAccount();
  const isGoogle = isGoogleProvider(provider);
  const isOutlook = isMicrosoftProvider(provider);
  const terminology = getEmailTerminology(provider);
  const { userLabels: allLabels, mutate: mutateLabels } = useLabels();
  const { folders, mutate: mutateFolders } = useFolders(provider);
  const { countsById, mutate: mutateCounts } = useLabelCounts({
    emailAccountId,
    labels: allLabels,
    folders,
  });
  const { hasTeam, unreadCount: teamUnreadCount } = useTeamNav();
  const { onOpen: openCompose } = useComposeModal();
  const { openSettings } = useSettingsDialog();
  const { state: openSidebars } = useSidebar();
  const isMailSidebarOpen = openSidebars.includes("left-sidebar");

  // 拖动时直接写入 CSS 变量：如果每次指针移动都重新渲染，
  // 侧栏边缘会跟不上光标。
  const sidebarScopeRef = useRef<HTMLDivElement>(null);
  const setSidebarWidth = useCallback((width: number) => {
    sidebarScopeRef.current?.style.setProperty("--sidebar-width", `${width}px`);
  }, []);
  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(MAIL_SIDEBAR_DEFAULT_WIDTH);
    persistPanelWidth(MAIL_SIDEBAR_WIDTH_COOKIE, null);
  }, [setSidebarWidth]);

  const hrefFor = useCallback(
    (target: MailNavTarget) =>
      prefixPath(emailAccountId, getMailNavPath(target)),
    [emailAccountId],
  );

  const onCreateLabel = useCallback(
    async (name: string) => {
      const result = await createLabelAction(emailAccountId, { name });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return;
      }
      // Without this the label the user just typed doesn't appear until an
      // unrelated revalidation happens to run.
      await mutateLabels();
      toast.success(`${terminology.label.singularCapitalized}“${name}”已创建`);
    },
    [emailAccountId, mutateLabels, terminology.label.singularCapitalized],
  );

  const onEditMailboxItem = useCallback(
    async (edit: MailboxItemEdit) => {
      const result = await updateMailboxItemAction(emailAccountId, edit);

      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }

      await Promise.all([
        edit.kind === "folder" ? mutateFolders() : mutateLabels(),
        mutateCounts(),
      ]);
      toast.success(
        `${edit.kind === "folder" ? "文件夹" : terminology.label.singularCapitalized}已更新`,
      );
      return true;
    },
    [
      emailAccountId,
      mutateCounts,
      mutateFolders,
      mutateLabels,
      terminology.label.singularCapitalized,
    ],
  );

  const onDeleteMailboxItem = useCallback(
    async (item: MailboxItem) => {
      const result = await deleteMailboxItemAction(emailAccountId, {
        kind: item.kind,
        id: item.id,
      });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }

      await Promise.all([
        onMailboxItemDeleted(item),
        item.kind === "folder" ? mutateFolders() : mutateLabels(),
        mutateCounts(),
      ]);
      toast.success(
        `${item.kind === "folder" ? "文件夹" : terminology.label.singularCapitalized}已删除`,
      );
      return true;
    },
    [
      emailAccountId,
      mutateCounts,
      mutateFolders,
      mutateLabels,
      onMailboxItemDeleted,
      terminology.label.singularCapitalized,
    ],
  );

  // 面板遮罩不受 lg:hidden 控制，因此窗口宽度足以显示侧栏后会关闭面板。
  useEffect(() => {
    if (!isMobileNavOpen) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const closeWhenWide = () => {
      if (wide.matches) onMobileNavOpenChange(false);
    };
    closeWhenWide();
    wide.addEventListener("change", closeWhenWide);
    return () => wide.removeEventListener("change", closeWhenWide);
  }, [isMobileNavOpen, onMobileNavOpenChange]);

  const navigateFromSheet = () => {
    onNavigate();
    onMobileNavOpenChange(false);
  };
  const selectAccountFromSheet = (accountId: string) => {
    onMobileNavOpenChange(false);
    onSelectAccount(accountId);
  };
  const selectAllAccountsFromSheet = () => {
    onMobileNavOpenChange(false);
    onSelectAllAccounts();
  };
  const composeFromSheet = () => {
    onMobileNavOpenChange(false);
    openCompose();
  };
  const openSettingsFromSheet = () => {
    onMobileNavOpenChange(false);
    openSettings();
  };
  const renderMailSidebar = ({
    collapsed,
    inSheet,
  }: {
    collapsed: boolean;
    inSheet: boolean;
  }) => (
    <MailSidebar
      className="h-full w-full border-r-0"
      hideToggle={inSheet}
      collapsed={collapsed}
      activeType={activeType}
      activeLabelId={activeLabelId}
      activeFolderId={activeFolderId}
      hrefFor={hrefFor}
      onNavigate={inSheet ? navigateFromSheet : onNavigate}
      labels={isAllAccounts ? NO_LABELS : allLabels}
      folders={isAllAccounts || !isOutlook ? NO_FOLDERS : folders}
      countsById={isAllAccounts ? NO_COUNTS : countsById}
      categories={
        isAllAccounts
          ? NO_CATEGORIES
          : getMailCategories({ isGoogle, isOutlook })
      }
      categoryHeading={isOutlook ? "Inbox" : "Categories"}
      collapsibleCategories={!isOutlook}
      labelsHeading={terminology.label.pluralCapitalized}
      labelSingular={terminology.label.singular}
      emailAccountId={emailAccountId}
      onCompose={inSheet ? composeFromSheet : openCompose}
      onOpenSettings={inSheet ? openSettingsFromSheet : openSettings}
      onCreateLabel={onCreateLabel}
      onEditMailboxItem={onEditMailboxItem}
      onDeleteMailboxItem={onDeleteMailboxItem}
      labelEditMode={isOutlook ? "color" : "name-and-color"}
      supportsLabelVisibility={isGoogle}
      labelColorOptions={
        isOutlook ? OUTLOOK_LABEL_COLOR_OPTIONS : GMAIL_LABEL_COLORS
      }
      unified={isAllAccounts}
      team={
        hasTeam ? { href: TEAM_HREF, unreadCount: teamUnreadCount } : undefined
      }
      footer={
        <>
          <DesktopUpdateMenuItem />
          <MailAccountSwitcher
            isDesktopApp={isDesktopApp}
            isAllAccounts={isAllAccounts}
            onSelectAccount={inSheet ? selectAccountFromSheet : onSelectAccount}
            onSelectAll={
              inSheet ? selectAllAccountsFromSheet : onSelectAllAccounts
            }
            collapsed={collapsed}
          />
        </>
      }
    />
  );

  return (
    <>
      <div
        ref={sidebarScopeRef}
        className="hidden lg:contents"
        style={
          {
            "--sidebar-width": `var(--mail-sidebar-width, ${MAIL_SIDEBAR_DEFAULT_WIDTH}px)`,
          } as CSSProperties
        }
      >
        <Sidebar name="left-sidebar" collapsible="icon">
          {renderMailSidebar({ collapsed: !isMailSidebarOpen, inSheet: false })}
          {isMailSidebarOpen ? (
            <PanelResizeHandle
              label="调整侧栏大小"
              edge="right"
              bounds={MAIL_SIDEBAR_WIDTH_BOUNDS}
              onResize={setSidebarWidth}
              onResizeEnd={persistSidebarWidth}
              onReset={resetSidebarWidth}
            />
          ) : null}
        </Sidebar>
      </div>
      {/* 低于 lg 时侧栏会隐藏，因此手机和平板通过此面板访问邮箱和应用的各个部分。 */}
      <Sheet open={isMobileNavOpen} onOpenChange={onMobileNavOpenChange}>
        <SheetContent
          side="left"
          // 聚焦第一个控件会让撰写提示浮现在下方行之上，因此直接聚焦面板本身。
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="w-[--sidebar-width] p-0 lg:hidden [&>button]:hidden"
          style={
            {
              "--sidebar-width": `${MAIL_SIDEBAR_DEFAULT_WIDTH}px`,
            } as CSSProperties
          }
        >
          <SheetTitle className="sr-only">邮件导航</SheetTitle>
          {renderMailSidebar({ collapsed: false, inSheet: true })}
        </SheetContent>
      </Sheet>
    </>
  );
});

function persistSidebarWidth(width: number) {
  persistPanelWidth(MAIL_SIDEBAR_WIDTH_COOKIE, width);
}
