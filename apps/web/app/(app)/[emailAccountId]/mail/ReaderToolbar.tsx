"use client";

import type { ReactElement, ReactNode } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MailIcon,
  MailOpenIcon,
} from "lucide-react";
import {
  MailReaderToolbar,
  type MailReaderToolbarButton,
} from "@inboxzero/mail-ui/MailReaderSurface";
import { MailLabelChip } from "@/app/(app)/[emailAccountId]/mail/MailLabelChip";
import type { EmailMessageCellLabel } from "@/components/EmailMessageCellLabels";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

type ReaderToolbarProps = {
  subject: string;
  isStarred: boolean;
  isUnread: boolean;
  labels: EmailMessageCellLabel[];
  /**
   * 标签片只跳转到某个标签的视图，不包含其他含义：标签本身不附带
   * 原因，因为可能是若干规则——或者根本没有规则——把它加到了会话上。
   * “为什么”是按规则区分的，位于 `menu` 中。
   */
  labelHref: (labelId: string) => string;
  onRemoveLabel?: (labelId: string) => void;
  onBackToInbox: () => void;
  onArchive: () => void;
  /** 当会话已归档时设置；用于替换“归档”按钮。 */
  onMoveToInbox?: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  /** ⋯ 下拉菜单，即 `ThreadActionsMenu`，由外壳组合。 */
  menu?: ReactNode;
  messageExpansion?: {
    allExpanded: boolean;
    canExpand: boolean;
    onToggleAll: () => void;
  };
};

/**
 * 阅读器的头部：会话是什么，以及你能对它做什么。
 * 归档与已读状态保持可见；其他一切都位于 `menu` 中。
 */
export function ReaderToolbar({
  subject,
  isStarred,
  isUnread,
  labels,
  labelHref,
  onRemoveLabel,
  onBackToInbox,
  onArchive,
  onMoveToInbox,
  onMarkRead,
  onMarkUnread,
  menu,
  messageExpansion,
}: ReaderToolbarProps) {
  return (
    <MailReaderToolbar
      icons={{
        archive: <ArchiveIcon className="size-3.5" />,
        back: <ArrowLeftIcon className="size-3.5" />,
        collapse_all: <ChevronsDownUpIcon className="size-3.5" />,
        expand_all: <ChevronsUpDownIcon className="size-3.5" />,
        mark_read: <MailOpenIcon className="size-3.5" />,
        move_to_inbox: <ArchiveRestoreIcon className="size-3.5" />,
        mark_unread: <MailIcon className="size-3.5" />,
      }}
      isStarred={isStarred}
      isUnread={isUnread}
      labelChips={labels.map((label) => (
        <MailLabelChip
          color={label.color}
          href={labelHref(label.id)}
          key={label.id}
          name={label.name}
          onRemove={onRemoveLabel ? () => onRemoveLabel(label.id) : undefined}
        />
      ))}
      menu={menu}
      messageExpansion={messageExpansion}
      onArchive={onArchive}
      onMoveToInbox={onMoveToInbox}
      onBackToInbox={onBackToInbox}
      onMarkRead={onMarkRead}
      onMarkUnread={onMarkUnread}
      renderActionTooltip={renderActionTooltip}
      renderButton={renderButton}
      subject={subject}
    />
  );
}

function renderButton(button: MailReaderToolbarButton) {
  return (
    <Button
      aria-label={button.ariaLabel}
      onClick={button.onClick}
      size="iconXs"
      title={button.title}
      variant={button.variant}
    >
      {button.icon}
    </Button>
  );
}

function renderActionTooltip(
  button: MailReaderToolbarButton,
  children: ReactElement,
) {
  if (button.action === "archive") {
    return <Tooltip shortcuts={["archive"]}>{children}</Tooltip>;
  }
  if (button.action === "move_to_inbox") {
    return <Tooltip content="移至收件箱">{children}</Tooltip>;
  }
  if (button.action === "mark_unread") {
    return <Tooltip shortcuts={["markUnread"]}>{children}</Tooltip>;
  }
  if (button.action === "mark_read") {
    return <Tooltip content="标记为已读">{children}</Tooltip>;
  }
  return children;
}
