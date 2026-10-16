import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FolderInputIcon,
  ForwardIcon,
  MailXIcon,
  MailIcon,
  MailOpenIcon,
  LanguagesIcon,
  ShieldAlertIcon,
  TagIcon,
  StarIcon,
  Trash2Icon,
  MessageSquareIcon,
} from "lucide-react";
import type { Command } from "@/lib/commands/types";
import { getShortcutHint } from "@/lib/shortcuts/registry";

type MailCommandActions = {
  archive: () => void;
  /** 当所有目标都已归档时替代归档。 */
  moveToInbox?: () => void;
  forward?: () => void;
  label?: () => void;
  star?: () => void;
  markRead?: () => void;
  markSpam?: () => void;
  markUnread?: () => void;
  move?: () => void;
  openSnooze?: () => void;
  openExternal?: () => void;
  translate?: () => void;
  comment?: () => void;
  trash?: () => void;
  toggleAutoArchive?: () => void;
  unsubscribe?: () => void;
};

export function buildMailCommandPalette({
  actions,
  allStarred = false,
  hasRead,
  hasUnread,
  isAutoArchived = false,
  isAutoArchiveDisabled = false,
  isUnsubscribeDisabled = false,
  unsubscribeLabel = "退订发件人",
  openExternalLabel = "在邮件服务商中打开",
  targetCount,
}: {
  actions: MailCommandActions;
  allStarred?: boolean;
  hasRead: boolean;
  hasUnread: boolean;
  isAutoArchived?: boolean;
  isAutoArchiveDisabled?: boolean;
  isUnsubscribeDisabled?: boolean;
  unsubscribeLabel?: string;
  openExternalLabel?: string;
  targetCount: number;
}): Command[] {
  if (targetCount === 0) return [];

  const commands: Command[] = [
    actions.moveToInbox
      ? {
          id: "mail-move-to-inbox",
          label:
            targetCount === 1
              ? "移至收件箱"
              : `将 ${targetCount} 个会话移至收件箱`,
          icon: ArchiveRestoreIcon,
          section: "actions",
          priority: 0,
          keywords: ["unarchive", "restore", "inbox"],
          action: actions.moveToInbox,
        }
      : {
          id: "mail-archive",
          label: targetCount === 1 ? "归档会话" : `归档 ${targetCount} 个会话`,
          icon: ArchiveIcon,
          shortcut: "E",
          section: "actions",
          priority: 0,
          keywords: ["archive", "remove", "inbox"],
          action: actions.archive,
        },
  ];

  if (targetCount === 1 && actions.forward) {
    commands.push({
      id: "mail-forward",
      label: "转发",
      icon: ForwardIcon,
      shortcut: getShortcutHint("forward"),
      section: "actions",
      priority: 1,
      keywords: ["forward", "send", "share"],
      action: actions.forward,
    });
  }

  if (actions.label) {
    commands.push({
      id: "mail-label",
      label: "标签",
      icon: TagIcon,
      shortcut: getShortcutHint("label"),
      section: "actions",
      priority: 2,
      keywords: ["label", "tag", "categorize"],
      action: actions.label,
    });
  }

  if (actions.move) {
    commands.push({
      id: "mail-move",
      label: "移动",
      icon: FolderInputIcon,
      shortcut: getShortcutHint("move"),
      section: "actions",
      priority: 3,
      keywords: ["move", "folder"],
      action: actions.move,
    });
  }

  if (hasUnread && actions.markRead) {
    commands.push({
      id: "mail-mark-read",
      label:
        targetCount === 1 ? "标记为已读" : `将 ${targetCount} 个标记为已读`,
      icon: MailOpenIcon,
      section: "actions",
      priority: 1,
      keywords: ["read", "seen", "open"],
      action: actions.markRead,
    });
  }

  if (hasRead && actions.markUnread) {
    commands.push({
      id: "mail-mark-unread",
      label:
        targetCount === 1 ? "标记为未读" : `将 ${targetCount} 个标记为未读`,
      icon: MailIcon,
      shortcut: getShortcutHint("markUnread"),
      section: "actions",
      priority: 2,
      keywords: ["unread", "unseen", "new"],
      action: actions.markUnread,
    });
  }

  if (actions.openSnooze) {
    commands.push({
      id: "mail-snooze",
      label: targetCount === 1 ? "推迟" : `推迟 ${targetCount} 个会话`,
      icon: Clock3Icon,
      shortcut: getShortcutHint("snooze"),
      section: "actions",
      priority: 3,
      keywords: ["snooze", "later", "remind"],
      action: actions.openSnooze,
      closeOnSelect: false,
    });
  }

  if (targetCount === 1 && actions.translate) {
    commands.push({
      id: "mail-translate",
      label: "翻译",
      icon: LanguagesIcon,
      shortcut: getShortcutHint("translate"),
      section: "actions",
      priority: 4,
      keywords: ["translate", "language", "original"],
      action: actions.translate,
    });
  }

  if (targetCount === 1 && actions.comment) {
    commands.push({
      id: "mail-comment",
      label: "评论",
      icon: MessageSquareIcon,
      shortcut: getShortcutHint("openTeamComments"),
      section: "actions",
      priority: 4,
      keywords: ["comment", "share", "team", "internal", "mention"],
      action: actions.comment,
    });
  }

  if (actions.trash) {
    commands.push({
      id: "mail-delete",
      label: targetCount === 1 ? "删除会话" : `删除 ${targetCount} 个会话`,
      icon: Trash2Icon,
      shortcut: "#",
      section: "actions",
      priority: 10,
      keywords: ["delete", "trash", "remove"],
      action: actions.trash,
    });
  }

  if (actions.markSpam) {
    commands.push({
      id: "mail-mark-spam",
      label: "标记为垃圾邮件",
      icon: ShieldAlertIcon,
      shortcut: getShortcutHint("markSpam"),
      section: "actions",
      priority: 11,
      keywords: ["spam", "junk", "report"],
      action: actions.markSpam,
    });
  }

  if (targetCount === 1 && actions.unsubscribe) {
    commands.push({
      id: "mail-unsubscribe",
      label: unsubscribeLabel,
      shortcut: getShortcutHint("unsubscribe"),
      icon: MailXIcon,
      section: "actions",
      priority: 12,
      keywords: ["unsubscribe", "block", "newsletter", "sender"],
      action: actions.unsubscribe,
      disabled: isUnsubscribeDisabled,
    });
  }

  if (targetCount === 1 && actions.toggleAutoArchive) {
    commands.push({
      id: "mail-auto-archive",
      shortcut: getShortcutHint("toggleAutoArchive"),
      label: isAutoArchived ? "关闭自动归档" : "自动归档以后的邮件",
      icon: isAutoArchived ? ArchiveRestoreIcon : ArchiveIcon,
      section: "actions",
      priority: 13,
      keywords: ["auto archive", "future", "sender"],
      action: actions.toggleAutoArchive,
      disabled: isAutoArchiveDisabled,
    });
  }

  if (targetCount === 1 && actions.openExternal) {
    commands.push({
      id: "mail-open-external",
      label: openExternalLabel,
      icon: ExternalLinkIcon,
      shortcut: getShortcutHint("openExternal"),
      section: "actions",
      priority: 14,
      keywords: ["open", "external", "provider", "gmail", "outlook"],
      action: actions.openExternal,
    });
  }

  if (actions.star) {
    const actionLabel = allStarred ? "取消星标" : "加星标";
    commands.push({
      id: "mail-star",
      label:
        targetCount === 1
          ? actionLabel
          : `${actionLabel} ${targetCount} 个会话`,
      icon: StarIcon,
      shortcut: getShortcutHint("star"),
      section: "actions",
      keywords: ["star", "unstar", "favorite"],
      action: actions.star,
    });
  }

  return commands;
}
