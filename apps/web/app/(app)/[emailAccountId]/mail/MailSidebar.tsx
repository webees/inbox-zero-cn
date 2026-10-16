"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { getMailSidebarRowPresentation } from "@inboxzero/mail-ui/MailSidebarRow";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Clock3Icon,
  FileIcon,
  FolderIcon,
  InboxIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  PenLineIcon,
  PlusIcon,
  SendIcon,
  ShieldAlertIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
  UserIcon,
  Users2Icon,
} from "lucide-react";
import type { MailboxLabelCount } from "@/utils/mail-engine/label-count-targets";
import { Tooltip as ShortcutTooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EmailLabel } from "@/providers/email-label-types";
import { GmailLabel } from "@/utils/gmail/label";
import { cn } from "@/utils";
import type { OutlookFolder } from "@/utils/outlook/folders";
import { OUTLOOK_INBOX_SECTIONS } from "@/utils/outlook/inbox-sections";
import { getLabelTree, type SidebarLabel } from "./label-tree";
import { splitLabelsByListVisibility } from "./label-visibility";
import { getMailSidebarFolders } from "./outlook-folder-list";
import {
  MailboxItemContextMenu,
  type MailboxItemColorOption,
  type MailboxItem,
  type MailboxItemEdit,
} from "./MailboxItemContextMenu";

/** 侧边栏行导航到的位置。与邮件页面的 `?type=` 查询结构一致。 */
export type MailNavTarget =
  | { kind: "type"; type: string }
  | { kind: "label"; labelId: string }
  | { kind: "folder"; folderId: string };

export type MailSidebarProps = {
  /** 当前视图的 `?type=`——未选择任何内容时为 `inbox`。 */
  activeType: string | null;
  /** 打开用户标签时当前视图的 `?labelId=`。 */
  activeLabelId: string | null;
  /** 打开 Outlook 文件夹时当前视图的 `?folderId=`。 */
  activeFolderId: string | null;
  /** 为某一行构建 href，这样侧边栏无需负责路由。 */
  hrefFor: (target: MailNavTarget) => string;
  /** Runs when a row navigates in place, including to the view already open. */
  onNavigate: () => void;
  labels: EmailLabel[];
  folders: OutlookFolder[];
  /** 以服务商标签/文件夹 id 为键。首屏之后才到达；可能为空。 */
  countsById: Map<string, MailboxLabelCount>;
  categories: MailCategory[];
  categoryHeading: string;
  labelsHeading: string;
  labelSingular: string;
  backToAppHref: string;
  onCompose: () => void;
  onCreateLabel: (name: string) => void;
  onEditMailboxItem: (edit: MailboxItemEdit) => Promise<boolean>;
  onDeleteMailboxItem: (item: MailboxItem) => Promise<boolean>;
  labelEditMode: "color" | "name-and-color";
  labelColorOptions: readonly MailboxItemColorOption[];
  /** Gmail 允许将标签从标签列表与邮件列表中隐藏。 */
  supportsLabelVisibility?: boolean;
  /** 将分类分组藏在开关后面，默认折叠。 */
  collapsibleCategories?: boolean;
  /** 仅图标栏：各行收缩为图标，名称移入提示中。 */
  collapsed?: boolean;
  footer?: ReactNode;
  unified?: boolean;
  className?: string;
};

type SystemItem = {
  name: string;
  type: string;
  /** null 表示该行从不显示计数（“已发送未读”这样的数字是噪声）。 */
  countId: string | null;
  Icon: LucideIcon;
};

export const MAIL_SCHEDULED_TYPE = "scheduled";

/** 收件箱之外的一切。访问频率低，足以待在开关后面。 */
const MAILBOX_ITEMS: SystemItem[] = [
  { name: "草稿", type: "draft", countId: "DRAFT", Icon: FileIcon },
  { name: "已发送", type: "sent", countId: null, Icon: SendIcon },
  { name: "已归档", type: "archive", countId: null, Icon: ArchiveIcon },
  { name: "已加星标", type: "starred", countId: null, Icon: StarIcon },
  {
    name: "已定时",
    type: MAIL_SCHEDULED_TYPE,
    countId: null,
    Icon: Clock3Icon,
  },
  { name: "垃圾邮件", type: "spam", countId: null, Icon: ShieldAlertIcon },
  { name: "回收站", type: "trash", countId: null, Icon: Trash2Icon },
];

export type MailCategory = {
  name: string;
  type: string;
  Icon: LucideIcon;
};

export const MAIL_CATEGORIES: MailCategory[] = [
  {
    name: "个人",
    type: GmailLabel.PERSONAL,
    Icon: UserIcon,
  },
  {
    name: "社交",
    type: GmailLabel.SOCIAL,
    Icon: Users2Icon,
  },
  {
    name: "更新",
    type: GmailLabel.UPDATES,
    Icon: BellIcon,
  },
  {
    name: "论坛",
    type: GmailLabel.FORUMS,
    Icon: MessagesSquareIcon,
  },
  {
    name: "促销",
    type: GmailLabel.PROMOTIONS,
    Icon: MegaphoneIcon,
  },
];

export const OUTLOOK_INBOX_CATEGORIES: MailCategory[] =
  OUTLOOK_INBOX_SECTIONS.map((section) => ({
    ...section,
    Icon: section.type === "focused" ? SparklesIcon : InboxIcon,
  }));

export function MailSidebar({
  activeType,
  activeLabelId,
  activeFolderId,
  hrefFor,
  onNavigate,
  labels,
  folders,
  countsById,
  categories,
  categoryHeading,
  labelsHeading,
  labelSingular,
  backToAppHref,
  onCompose,
  onCreateLabel,
  onEditMailboxItem,
  onDeleteMailboxItem,
  labelEditMode,
  labelColorOptions,
  supportsLabelVisibility = false,
  collapsibleCategories = false,
  collapsed = false,
  footer,
  unified = false,
  className,
}: MailSidebarProps) {
  const [isAddingLabel, setIsAddingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const sidebarFolders = getMailSidebarFolders(folders);
  const { visibleLabels, hiddenLabels } = splitLabelsByListVisibility({
    labels,
    countsById,
  });
  const labelTree = getLabelTree(
    visibleLabels,
    labelEditMode === "name-and-color",
  );
  const hasNestedLabels = labelTree.some((root) => root.children.length > 0);
  // 隐藏的标签保持扁平：它们是一种备用入口，而不是用来浏览的地方。
  const hiddenLabelNodes = getLabelTree(hiddenLabels, false);
  const hasHiddenActiveLabel = hiddenLabels.some(
    (label) => label.id === activeLabelId,
  );

  const isCategoryActive =
    !activeLabelId &&
    !activeFolderId &&
    categories.some((category) => category.type === activeType);
  const [showCategories, setShowCategories] = useState(isCategoryActive);
  const [showLabels, setShowLabels] = useState(true);
  const [showHiddenLabels, setShowHiddenLabels] = useState(false);
  // 图标栏中没有任何东西能切换分组，因此在那里分组跟随打开的
  // 视图而不是已保存的选择，否则就成了单向门。
  // 展开的侧边栏则保留用户的选择。
  const showCategoryRows =
    !collapsibleCategories || (collapsed ? isCategoryActive : showCategories);

  const isMailboxActive =
    !activeLabelId &&
    !activeFolderId &&
    MAILBOX_ITEMS.some((item) => item.type === activeType);
  const [showMailboxes, setShowMailboxes] = useState(isMailboxActive);
  const showMailboxRows = collapsed ? isMailboxActive : showMailboxes;

  useEffect(() => {
    if (isCategoryActive) setShowCategories(true);
  }, [isCategoryActive]);

  useEffect(() => {
    if (isMailboxActive) setShowMailboxes(true);
  }, [isMailboxActive]);

  // 当打开视图切换为某个标签时展开，这样折叠的列表
  // 仍能显示所选中行。同一标签下的折叠保持不变。
  useEffect(() => {
    if (activeLabelId) setShowLabels(true);
  }, [activeLabelId]);

  // 从别处打开隐藏标签（搜索、会话的标签片）时，
  // 不能让侧边栏缺少用户正在查看的视图对应的行。
  useEffect(() => {
    if (hasHiddenActiveLabel) setShowHiddenLabels(true);
  }, [hasHiddenActiveLabel]);

  const submitNewLabel = (event: FormEvent) => {
    event.preventDefault();
    const name = newLabelName.trim();
    if (!name) return;
    onCreateLabel(name);
    setNewLabelName("");
    setIsAddingLabel(false);
  };

  return (
    <aside
      className={cn(
        "flex w-[236px] shrink-0 flex-col overflow-hidden border-border border-r bg-sidebar pt-3 pb-2.5",
        collapsed ? "px-1.5" : "px-2.5",
        className,
      )}
    >
      {/* 折叠时，开关移到窗口控制按钮旁（`MailTitlebarNav`）。 */}
      {collapsed ? (
        <div data-desktop-mac-titlebar-spacer className="shrink-0" />
      ) : (
        <div className="mb-2.5 flex shrink-0 items-center gap-1">
          <Link
            href={backToAppHref}
            data-desktop-mac-end
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon className="size-3.5 shrink-0" />
            <span className="flex-1 truncate" data-hide-on-desktop-mac>
              Inbox Zero
            </span>
          </Link>
          <SidebarTrigger
            name="left-sidebar"
            className="size-6 shrink-0 text-muted-foreground"
          />
        </div>
      )}

      <ShortcutTooltip
        shortcuts={[{ id: "compose", label: "撰写" }]}
        side={collapsed ? "right" : "bottom"}
      >
        {collapsed ? (
          <Button
            variant="gradient"
            size="icon"
            onClick={onCompose}
            aria-label="撰写"
            className="mb-3.5 size-10 shrink-0 self-center rounded-xl"
          >
            <PenLineIcon className="size-4" />
          </Button>
        ) : (
          <Button
            variant="gradient"
            onClick={onCompose}
            className="mb-3.5 w-full shrink-0 justify-start gap-2 rounded-xl px-3"
          >
            <PenLineIcon className="size-4 shrink-0" />
            撰写
          </Button>
        )}
      </ShortcutTooltip>

      {/* 负外边距让滚动条落在侧边栏自身的
          内边距中，这样平台宽度的滚动条不会挤到未读计数。 */}
      <div className="-mr-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1.5 scrollbar-thin">
        <nav className="flex flex-col gap-px">
          <NavRow
            href={
              unified ? undefined : hrefFor({ kind: "type", type: "inbox" })
            }
            onNavigate={onNavigate}
            active={
              unified ||
              (!activeLabelId && !activeFolderId && activeType === "inbox")
            }
            icon={<InboxIcon className="size-4 shrink-0" />}
            name={unified ? "全部收件箱" : "收件箱"}
            count={unified ? null : displayCount(countsById.get("INBOX"))}
            emphasizeCount
            collapsed={collapsed}
          />
        </nav>

        {!unified && (!collapsed || showMailboxRows) && (
          <>
            <GroupHeading
              collapsed={collapsed}
              expanded={showMailboxes}
              onToggle={() => setShowMailboxes((open) => !open)}
            >
              邮件
            </GroupHeading>
            {showMailboxRows && (
              <nav className="flex flex-col gap-px">
                {MAILBOX_ITEMS.map(({ name, type, countId, Icon }) => (
                  <NavRow
                    key={type}
                    href={hrefFor({ kind: "type", type })}
                    onNavigate={onNavigate}
                    active={
                      !activeLabelId && !activeFolderId && activeType === type
                    }
                    icon={<Icon className="size-4 shrink-0" />}
                    name={name}
                    count={
                      countId ? displayCount(countsById.get(countId)) : null
                    }
                    collapsed={collapsed}
                  />
                ))}
              </nav>
            )}
          </>
        )}

        {/* 图标栏用分隔线代替标题，因此空分组会
            留下一条多余的线。 */}
        {!unified &&
          categories.length > 0 &&
          (!collapsed || showCategoryRows) && (
            <>
              <GroupHeading
                collapsed={collapsed}
                expanded={collapsibleCategories ? showCategories : undefined}
                onToggle={
                  collapsibleCategories
                    ? () => setShowCategories((open) => !open)
                    : undefined
                }
              >
                {categoryHeading}
              </GroupHeading>
              {showCategoryRows && (
                <nav className="flex flex-col gap-px">
                  {categories.map(({ name, type, Icon }) => (
                    <NavRow
                      key={type}
                      href={hrefFor({ kind: "type", type })}
                      onNavigate={onNavigate}
                      active={
                        !activeLabelId && !activeFolderId && activeType === type
                      }
                      icon={<Icon className="size-3.5 shrink-0" />}
                      name={name}
                      count={null}
                      collapsed={collapsed}
                    />
                  ))}
                </nav>
              )}
            </>
          )}

        {!unified && sidebarFolders.length > 0 && (
          <>
            <GroupHeading collapsed={collapsed}>文件夹</GroupHeading>
            <nav className="flex flex-col gap-px">
              {sidebarFolders.map((folder) => (
                <MailboxItemContextMenu
                  key={folder.id}
                  item={{
                    kind: "folder",
                    id: folder.id,
                    name: folder.displayName,
                  }}
                  typeName="文件夹"
                  editMode="name"
                  onEdit={onEditMailboxItem}
                  onDelete={onDeleteMailboxItem}
                >
                  <NavRow
                    href={hrefFor({ kind: "folder", folderId: folder.id })}
                    onNavigate={onNavigate}
                    active={activeFolderId === folder.id}
                    icon={
                      <FolderIcon
                        className="size-3.5 shrink-0"
                        style={
                          collapsed
                            ? undefined
                            : { marginLeft: folder.depth * 12 }
                        }
                      />
                    }
                    name={folder.displayName}
                    count={displayCount(countsById.get(folder.id))}
                    collapsed={collapsed}
                  />
                </MailboxItemContextMenu>
              ))}
            </nav>
          </>
        )}

        {!unified && (!collapsed || (showLabels && labelTree.length > 0)) ? (
          <>
            <GroupHeading
              collapsed={collapsed}
              expanded={showLabels}
              onToggle={() => setShowLabels((open) => !open)}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setShowLabels(true);
                    setIsAddingLabel((open) => !open);
                  }}
                  aria-expanded={isAddingLabel}
                  aria-label={`创建${labelSingular}`}
                  className="rounded-md p-0.5 text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              }
            >
              {labelsHeading}
            </GroupHeading>
            {showLabels && (
              <nav className="flex flex-col gap-px">
                {labelTree.map((node) => (
                  <LabelBranch
                    key={node.label.id}
                    node={node}
                    hasNestedLabels={hasNestedLabels}
                    collapsed={collapsed}
                    activeLabelId={activeLabelId}
                    hrefFor={hrefFor}
                    onNavigate={onNavigate}
                    countsById={countsById}
                    labelSingular={labelSingular}
                    labelEditMode={labelEditMode}
                    labelColorOptions={labelColorOptions}
                    supportsLabelVisibility={supportsLabelVisibility}
                    onEditMailboxItem={onEditMailboxItem}
                    onDeleteMailboxItem={onDeleteMailboxItem}
                  />
                ))}
              </nav>
            )}

            {showLabels && hiddenLabelNodes.length > 0 && !collapsed && (
              <>
                <button
                  type="button"
                  onClick={() => setShowHiddenLabels((open) => !open)}
                  aria-expanded={showHiddenLabels}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showHiddenLabels ? (
                    <ChevronDownIcon className="size-3" />
                  ) : (
                    <ChevronRightIcon className="size-3" />
                  )}
                  更多
                </button>
                {showHiddenLabels && (
                  <nav className="flex flex-col gap-px">
                    {hiddenLabelNodes.map((node) => (
                      <LabelBranch
                        key={node.label.id}
                        node={node}
                        hasNestedLabels={false}
                        collapsed={collapsed}
                        activeLabelId={activeLabelId}
                        hrefFor={hrefFor}
                        onNavigate={onNavigate}
                        countsById={countsById}
                        labelSingular={labelSingular}
                        labelEditMode={labelEditMode}
                        labelColorOptions={labelColorOptions}
                        supportsLabelVisibility={supportsLabelVisibility}
                        onEditMailboxItem={onEditMailboxItem}
                        onDeleteMailboxItem={onDeleteMailboxItem}
                      />
                    ))}
                  </nav>
                )}
              </>
            )}

            {showLabels && isAddingLabel && !collapsed ? (
              <form
                onSubmit={submitNewLabel}
                className="flex gap-1.5 px-2.5 py-2"
              >
                <Input
                  value={newLabelName}
                  onChange={(event) => setNewLabelName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setIsAddingLabel(false);
                  }}
                  placeholder={`${labelSingular}名称`}
                  aria-label={`新建${labelSingular}名称`}
                  autoFocus
                  className="h-7 min-w-0 flex-1 px-2 text-xs"
                />
                <Button
                  type="submit"
                  variant="gradient"
                  size="xs-2"
                  disabled={!newLabelName.trim()}
                >
                  添加
                </Button>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
      {footer}
    </aside>
  );
}

function LabelBranch({
  node,
  hasNestedLabels,
  collapsed,
  ...props
}: Pick<
  MailSidebarProps,
  | "activeLabelId"
  | "hrefFor"
  | "onNavigate"
  | "countsById"
  | "labelSingular"
  | "labelEditMode"
  | "labelColorOptions"
  | "supportsLabelVisibility"
  | "onEditMailboxItem"
  | "onDeleteMailboxItem"
> & { node: SidebarLabel; hasNestedLabels: boolean; collapsed: boolean }) {
  const { label, children } = node;
  const activeDescendantId = children.some((child) =>
    containsLabel(child, props.activeLabelId),
  )
    ? props.activeLabelId
    : null;
  // 分支默认关闭，这样很深的标签树不会淹没侧边栏；
  // 只有包含所打开标签的分支会展开自己。
  const [expansion, setExpansion] = useState({
    activeDescendantId,
    expanded: activeDescendantId !== null,
  });
  // 展开每个新选中的后代，同时保留无关的折叠选择。
  if (expansion.activeDescendantId !== activeDescendantId) {
    setExpansion({
      activeDescendantId,
      expanded: activeDescendantId !== null || expansion.expanded,
    });
  }
  // 图标栏没有空间放展开箭头，因此它把所有标签平铺列出。
  const expanded = collapsed || expansion.expanded;

  return (
    <div>
      <MailboxItemContextMenu
        item={{ kind: "label", id: label.id, name: label.name }}
        typeName={props.labelSingular}
        editMode={props.labelEditMode}
        currentColor={label.color}
        colorOptions={props.labelColorOptions}
        visibility={
          props.supportsLabelVisibility
            ? {
                labelList: label.labelListVisibility,
                messageList: label.messageListVisibility,
              }
            : undefined
        }
        onEdit={props.onEditMailboxItem}
        onDelete={props.onDeleteMailboxItem}
      >
        <div className="relative">
          {children.length > 0 && !collapsed && (
            <button
              type="button"
              aria-label={`${expanded ? "折叠" : "展开"} ${label.name}`}
              aria-expanded={expanded}
              onClick={() =>
                setExpansion({ activeDescendantId, expanded: !expanded })
              }
              className="absolute top-1/2 left-0 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )}
            </button>
          )}
          <NavRow
            href={props.hrefFor({ kind: "label", labelId: label.id })}
            onNavigate={props.onNavigate}
            active={props.activeLabelId === label.id}
            icon={
              collapsed ? (
                <TagIcon
                  className="size-4 shrink-0"
                  style={{ color: label.color?.backgroundColor }}
                />
              ) : (
                <span
                  className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                  style={
                    label.color?.backgroundColor
                      ? { backgroundColor: label.color.backgroundColor }
                      : undefined
                  }
                />
              )
            }
            // 平铺的行会丢失父级上下文，因此提示显示完整路径
            // 而不是叶子名称。
            name={collapsed ? label.name : node.name}
            count={displayCount(props.countsById.get(label.id))}
            nested={hasNestedLabels && !collapsed}
            collapsed={collapsed}
          />
        </div>
      </MailboxItemContextMenu>
      {expanded && children.length > 0 && (
        <div className={collapsed ? undefined : "ml-3"}>
          {children.map((child) => (
            <LabelBranch
              key={child.label.id}
              node={child}
              hasNestedLabels={hasNestedLabels}
              collapsed={collapsed}
              {...props}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupHeading({
  children,
  action,
  expanded,
  onToggle,
  collapsed,
}: {
  children: ReactNode;
  action?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  collapsed?: boolean;
}) {
  // 图标栏放不下标题，因此改为用一条分隔线区分分组。
  if (collapsed) return <div className="mx-auto my-2 h-px w-6 bg-border" />;

  return (
    <div className="flex items-center gap-1 px-2.5 pt-4 pb-1.5">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center font-medium text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{children}</span>
        </button>
      ) : (
        <span className="flex-1 font-medium text-muted-foreground text-xs">
          {children}
        </span>
      )}
      {action}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-hidden="true"
          className="cursor-pointer rounded-md p-0.5 text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function NavRow({
  href,
  onNavigate,
  active,
  icon,
  name,
  count,
  emphasizeCount,
  nested,
  collapsed,
}: {
  href?: string;
  onNavigate: () => void;
  active: boolean;
  icon: ReactNode;
  name: string;
  count: number | null;
  emphasizeCount?: boolean;
  nested?: boolean;
  collapsed?: boolean;
}) {
  const presentation = getMailSidebarRowPresentation({
    active,
    icon,
    name,
    count,
    emphasizeCount,
    nested,
    collapsed,
  });
  const className = cn(presentation.className);
  const content = presentation.content;

  const row = href ? (
    <Link
      href={href}
      onNavigate={onNavigate}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <div aria-current={active ? "page" : undefined} className={className}>
      {content}
    </div>
  );

  if (!collapsed) return row;

  return (
    <RailTooltip label={count === null ? name : `${name} (${count})`}>
      {row}
    </RailTooltip>
  );
}

/** 为只能放下图标的图标栏控件命名。展开时为 `null`。 */
export function RailTooltip({
  label,
  children,
}: {
  label: string | null;
  children: ReactNode;
}) {
  if (!label) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function getMailCategories({
  isGoogle,
  isOutlook,
}: {
  isGoogle: boolean;
  isOutlook: boolean;
}): MailCategory[] {
  if (isGoogle) return MAIL_CATEGORIES;
  if (isOutlook) return OUTLOOK_INBOX_CATEGORIES;
  return [];
}

export function getMailNavPath(target: MailNavTarget): `/${string}` {
  switch (target.kind) {
    case "label":
      return `/mail?type=label&labelId=${encodeURIComponent(target.labelId)}`;
    case "folder":
      return `/mail?type=folder&folderId=${encodeURIComponent(target.folderId)}`;
    case "type":
      return `/mail?type=${encodeURIComponent(target.type)}`;
  }
}

/**
 * 草稿永远不会是未读，因此那里唯一值得显示的数字是总数。
 * 零是噪声，因此完全不渲染。
 */
function displayCount(count: MailboxLabelCount | undefined): number | null {
  if (!count) return null;
  const value = count.id === "DRAFT" ? count.total : count.unread;
  return value > 0 ? value : null;
}

function containsLabel(node: SidebarLabel, labelId: string | null): boolean {
  return (
    node.label.id === labelId ||
    node.children.some((child) => containsLabel(child, labelId))
  );
}
