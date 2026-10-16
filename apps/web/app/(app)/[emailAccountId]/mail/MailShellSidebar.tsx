"use client";

import { type CSSProperties, memo, useCallback, useRef } from "react";
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
  MAIL_SIDEBAR_RAIL_WIDTH,
  MAIL_SIDEBAR_WIDTH_BOUNDS,
  MAIL_SIDEBAR_WIDTH_COOKIE,
} from "@/app/(app)/[emailAccountId]/mail/panel-widths";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { useFolders } from "@/hooks/useFolders";
import { useLabelCounts } from "@/hooks/useLabelCounts";
import { useLabels } from "@/hooks/useLabels";
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
 * 邮件屏幕的左栏。它负责标签计数与邮箱编辑，使它们的更新留在
 * 此处，并已记忆化，这样会话导航与列表快照不会重新渲染它。
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
}: {
  activeType: string | null;
  activeLabelId: string | null;
  activeFolderId: string | null;
  isAllAccounts: boolean;
  isDesktopApp: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectAllAccounts: () => void;
  /** 离开被删除的标签或文件夹所定义的视图或分栏。 */
  onMailboxItemDeleted: (item: MailboxItem) => Promise<unknown>;
  onNavigate: () => void;
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
  const { onOpen: openCompose } = useComposeModal();
  const { state: openSidebars } = useSidebar();
  const isMailSidebarOpen = openSidebars.includes("left-sidebar");

  // 拖拽会直接写入 CSS 变量：每次指针移动都重新渲染会让
  // 侧边栏边缘滞后于光标。
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
      // 没有这一步，用户刚输入的标签要等到某次无关的
      // 重新验证碰巧运行时才会出现。
      await mutateLabels();
      toast.success(`已创建${terminology.label.singularCapitalized}“${name}”`);
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

  return (
    <div
      ref={sidebarScopeRef}
      className="hidden lg:contents"
      style={
        {
          "--sidebar-width": `var(--mail-sidebar-width, ${MAIL_SIDEBAR_DEFAULT_WIDTH}px)`,
          "--sidebar-width-icon": `${MAIL_SIDEBAR_RAIL_WIDTH}px`,
        } as CSSProperties
      }
    >
      <Sidebar name="left-sidebar" collapsible="icon">
        <MailSidebar
          className="h-full w-full border-r-0"
          collapsed={!isMailSidebarOpen}
          activeType={activeType}
          activeLabelId={activeLabelId}
          activeFolderId={activeFolderId}
          hrefFor={hrefFor}
          onNavigate={onNavigate}
          labels={isAllAccounts ? NO_LABELS : allLabels}
          folders={isAllAccounts || !isOutlook ? NO_FOLDERS : folders}
          countsById={isAllAccounts ? NO_COUNTS : countsById}
          categories={
            isAllAccounts
              ? NO_CATEGORIES
              : getMailCategories({ isGoogle, isOutlook })
          }
          categoryHeading={isOutlook ? "收件箱" : "分类"}
          collapsibleCategories={!isOutlook}
          labelsHeading={terminology.label.pluralCapitalized}
          labelSingular={terminology.label.singular}
          backToAppHref={prefixPath(emailAccountId, "/automation")}
          onCompose={openCompose}
          onCreateLabel={onCreateLabel}
          onEditMailboxItem={onEditMailboxItem}
          onDeleteMailboxItem={onDeleteMailboxItem}
          labelEditMode={isOutlook ? "color" : "name-and-color"}
          supportsLabelVisibility={isGoogle}
          labelColorOptions={
            isOutlook ? OUTLOOK_LABEL_COLOR_OPTIONS : GMAIL_LABEL_COLORS
          }
          unified={isAllAccounts}
          footer={
            <MailAccountSwitcher
              isDesktopApp={isDesktopApp}
              isAllAccounts={isAllAccounts}
              onSelectAccount={onSelectAccount}
              onSelectAll={onSelectAllAccounts}
              variant="sidebar"
              collapsed={!isMailSidebarOpen}
            />
          }
        />
        {isMailSidebarOpen ? (
          <PanelResizeHandle
            label="调整侧边栏大小"
            edge="right"
            bounds={MAIL_SIDEBAR_WIDTH_BOUNDS}
            onResize={setSidebarWidth}
            onResizeEnd={persistSidebarWidth}
            onReset={resetSidebarWidth}
          />
        ) : null}
      </Sidebar>
    </div>
  );
});

function persistSidebarWidth(width: number) {
  persistPanelWidth(MAIL_SIDEBAR_WIDTH_COOKIE, width);
}
