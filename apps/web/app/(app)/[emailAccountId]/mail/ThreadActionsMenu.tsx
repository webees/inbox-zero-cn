"use client";

import {
  ArchiveIcon,
  ArrowBigUpIcon,
  ArchiveRestoreIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  LanguagesIcon,
  MailXIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  ShieldAlertIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  TagIcon,
} from "lucide-react";
import { useSenderCommands } from "@/app/(app)/[emailAccountId]/mail/use-sender-commands";
import { getEmailMessageCellActions } from "@/components/EmailMessageCellActions";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getShortcutHint,
  getShortcutKeyLabels,
  type ShortcutId,
} from "@/lib/shortcuts/registry";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getOpenInMailboxLabel } from "@/utils/url";
import type { ParsedMessage } from "@/utils/types";

export type ThreadActionsMenuProps = {
  message: ParsedMessage | null;
  isStarred: boolean;
  onToggleStar: () => void;
  onMarkSpam: () => void;
  onDelete: () => void;
  onLabel?: () => void;
  onMove?: () => void;
  onTranslate?: () => void;
  onComment?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * 阅读器工具栏中针对整个会话的操作。
 */
export function ThreadActionsMenu({
  message,
  isStarred,
  onToggleStar,
  onMarkSpam,
  onDelete,
  onLabel,
  onMove,
  onTranslate,
  onComment,
  open,
  onOpenChange,
}: ThreadActionsMenuProps) {
  const { provider, userEmail } = useAccount();
  const {
    canManageAutoArchive,
    isUnsubscribeDisabled,
    unsubscribeLabel,
    isAutoArchived,
    isAutoArchiveStatusLoading,
    isUpdatingAutoArchive,
    onToggleAutoArchive,
    onUnsubscribe,
    PremiumModal,
  } = useSenderCommands(message);
  const openUrl = message
    ? getEmailMessageCellActions({
        externalUrl: message.externalUrl,
        messageId: message.id,
        provider,
        threadId: message.threadId,
        userEmail,
      })?.openUrl
    : undefined;

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange} open={open}>
        <Tooltip shortcuts={["moreActions"]}>
          <DropdownMenuTrigger asChild>
            <Button aria-label="更多操作" size="iconXs" variant="outline">
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>

        <DropdownMenuContent
          align="end"
          className="w-80 max-w-[calc(100vw-1rem)]"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {onLabel && (
            <DropdownMenuItem onSelect={onLabel}>
              <TagIcon className="mr-2 size-4" />
              标签
              <MenuShortcut id="label" />
            </DropdownMenuItem>
          )}

          {onMove && (
            <DropdownMenuItem onSelect={onMove}>
              <FolderInputIcon className="mr-2 size-4" />
              移动
              <MenuShortcut id="move" />
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onSelect={onToggleStar}>
            {isStarred ? (
              <StarOffIcon className="mr-2 size-4" />
            ) : (
              <StarIcon className="mr-2 size-4" />
            )}
            {isStarred ? "取消星标" : "加星标"}
            <MenuShortcut id="star" />
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={onDelete}>
            <Trash2Icon aria-hidden className="mr-2 size-4" />
            删除
            <MenuShortcut id="delete" />
          </DropdownMenuItem>

          <DropdownMenuItem onSelect={onMarkSpam}>
            <ShieldAlertIcon className="mr-2 size-4" />
            标记为垃圾邮件
            <MenuShortcut id="markSpam" />
          </DropdownMenuItem>

          {canManageAutoArchive ? (
            <DropdownMenuItem
              disabled={isUnsubscribeDisabled}
              onSelect={onUnsubscribe}
            >
              <MailXIcon className="mr-2 size-4" />
              {unsubscribeLabel}
              <MenuShortcut id="unsubscribe" />
            </DropdownMenuItem>
          ) : null}

          {(onTranslate || onComment || canManageAutoArchive) && (
            <DropdownMenuSeparator />
          )}

          {onTranslate && (
            <DropdownMenuItem onSelect={onTranslate}>
              <LanguagesIcon className="mr-2 size-4" />
              翻译
              <MenuShortcut id="translate" />
            </DropdownMenuItem>
          )}

          {onComment && (
            <DropdownMenuItem onSelect={onComment}>
              <MessageSquareIcon className="mr-2 size-4" />
              评论
              <MenuShortcut id="openTeamComments" />
            </DropdownMenuItem>
          )}

          {canManageAutoArchive ? (
            <DropdownMenuItem
              disabled={isAutoArchiveStatusLoading || isUpdatingAutoArchive}
              onSelect={onToggleAutoArchive}
            >
              {isAutoArchived ? (
                <ArchiveRestoreIcon className="mr-2 size-4" />
              ) : (
                <ArchiveIcon className="mr-2 size-4" />
              )}
              {isAutoArchived ? "关闭自动归档" : "自动归档以后的邮件"}
              <MenuShortcut id="toggleAutoArchive" />
            </DropdownMenuItem>
          ) : null}

          {openUrl ? <DropdownMenuSeparator /> : null}

          {openUrl ? (
            <DropdownMenuItem asChild>
              <a href={openUrl} rel="noopener noreferrer" target="_blank">
                <ExternalLinkIcon className="mr-2 size-4" />
                {getOpenInMailboxLabel(provider) ?? "在邮件服务商中打开"}
                <MenuShortcut id="openExternal" />
              </a>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <PremiumModal />
    </>
  );
}

function MenuShortcut({ id }: { id: ShortcutId }) {
  return (
    <span className="ml-auto flex items-center gap-1">
      <span className="sr-only">{getShortcutHint(id)}</span>
      {getShortcutKeyLabels(id).map((key, index) => (
        <Kbd
          aria-hidden
          className="h-5 min-w-5 px-1.5 font-sans text-[11px]"
          key={`${index}-${key}`}
        >
          {key === "shift" ? <ArrowBigUpIcon className="size-3.5" /> : key}
        </Kbd>
      ))}
    </span>
  );
}
