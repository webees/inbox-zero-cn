import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { ActionType, type MessagingProvider } from "@/generated/prisma/enums";
import { getEmailTerminology } from "@/utils/terminology";
import { sortActionsByPriority } from "@/utils/action-sort";
import {
  ArchiveIcon,
  BellIcon,
  FolderInputIcon,
  ForwardIcon,
  ReplyIcon,
  ShieldCheckIcon,
  SendIcon,
  TagIcon,
  WebhookIcon,
  FileTextIcon,
  MailIcon,
  NewspaperIcon,
  SquareCheckBigIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { truncate } from "@/utils/string";
import {
  getIntegrationActionDisplayValue,
  getIntegrationActionLabel,
} from "@/utils/mcp/tool-specs";
import { getIntegrationActionLabelMessage } from "@/utils/mcp/tool-specs-messages";
import { getMessagingProviderName } from "@/utils/messaging/platforms";

/**
 * 已有邮件草稿时，隐藏聊天频道草稿条目，
 * 避免每个已连接的聊天应用都重复显示一次“草稿回复”。
 */
export function getVisibleActions<T extends { type: ActionType }>(
  actions: T[],
): T[] {
  const sortedActions = sortActionsByPriority(actions);
  const hasEmailDraft = sortedActions.some(
    (action) => action.type === ActionType.DRAFT_EMAIL,
  );

  return sortedActions.filter(
    (action) =>
      !(action.type === ActionType.DRAFT_MESSAGING_CHANNEL && hasEmailDraft),
  );
}

export function getActionDisplay(
  action: {
    type: ActionType;
    label?: string | null;
    labelId?: string | null;
    folderName?: string | null;
    content?: string | null;
    to?: string | null;
    notificationDestination?: string | null;
    messagingChannel?: { provider: MessagingProvider } | null;
    integrationName?: string | null;
    integrationToolName?: string | null;
    integrationArgs?: unknown;
  },
  provider: string,
  labels: Array<{ id: string; name: string }>,
): string {
  const terminology = getEmailTerminology(provider);
  switch (action.type) {
    case ActionType.DRAFT_EMAIL:
    case ActionType.DRAFT_MESSAGING_CHANNEL:
      if (action.content) {
        return `草稿回复：${truncate(action.content, 10)}`;
      }
      return "草稿回复";
    case ActionType.LABEL: {
      const labelName = getActionLabelName(action, labels);
      return labelName
        ? `${terminology.label.action}为「${truncate(labelName, 15)}」`
        : terminology.label.action;
    }
    case ActionType.ARCHIVE:
      return "归档";
    case ActionType.DELETE:
      return "删除";
    case ActionType.MARK_READ:
      return "标记为已读";
    case ActionType.STAR:
      return "加星标";
    case ActionType.MARK_SPAM:
      return "标记为垃圾邮件";
    case ActionType.REPLY:
      return "回复";
    case ActionType.SEND_EMAIL:
      return action.to ? `发送邮件给${truncate(action.to, 8)}` : "发送邮件";
    case ActionType.FORWARD:
      return action.to ? `转发给${truncate(action.to, 8)}` : "转发";
    case ActionType.MOVE_FOLDER:
      return action.folderName
        ? `移动到文件夹「${action.folderName}」`
        : "移动到文件夹";
    case ActionType.DIGEST:
      return "邮件摘要";
    case ActionType.CALL_WEBHOOK:
      return "调用 Webhook";
    case ActionType.NOTIFY_MESSAGING_CHANNEL:
      if (action.messagingChannel?.provider) {
        return `通过${getMessagingProviderName(action.messagingChannel.provider)}通知`;
      }
      return action.notificationDestination
        ? `通过${truncate(action.notificationDestination, 18)}通知`
        : "通知";
    case ActionType.NOTIFY_SENDER:
      return "通知发件人";
    case ActionType.INTEGRATION: {
      const label = getIntegrationActionLabel(action);
      const displayValue = getIntegrationActionDisplayValue(action);
      return displayValue ? `${label}：${truncate(displayValue, 20)}` : label;
    }
    default: {
      const exhaustiveCheck: never = action.type;
      return exhaustiveCheck;
    }
  }
}

export const ACTION_TYPE_LABELS = {
  [ActionType.LABEL]: msg({ message: "标签", context: "action" }),
  [ActionType.ARCHIVE]: msg`归档`,
  [ActionType.DELETE]: msg`删除`,
  [ActionType.MARK_READ]: msg`标记为已读`,
  [ActionType.MARK_SPAM]: msg`标记为垃圾邮件`,
  [ActionType.STAR]: msg`加星标`,
  [ActionType.MOVE_FOLDER]: msg`移动到文件夹`,
  [ActionType.FORWARD]: msg`转发`,
  [ActionType.REPLY]: msg`回复`,
  [ActionType.SEND_EMAIL]: msg`发送邮件`,
  [ActionType.DRAFT_EMAIL]: msg`草稿回复`,
  [ActionType.DRAFT_MESSAGING_CHANNEL]: msg`为聊天频道创建草稿`,
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: msg`通知聊天频道`,
  [ActionType.CALL_WEBHOOK]: msg`调用 Webhook`,
  [ActionType.DIGEST]: msg`添加到邮件摘要`,
  [ActionType.NOTIFY_SENDER]: msg`通知发件人`,
  // 仅凭 ActionType 无法确定具体工具；getIntegrationActionLabel
  // 在已知操作时给出准确名称。
  [ActionType.INTEGRATION]: getIntegrationActionLabelMessage(),
} satisfies Record<ActionType, MessageDescriptor>;

export function getActionLabelName(
  action: { label?: string | null; labelId?: string | null },
  labels: Array<{ id: string; name: string }>,
): string | null {
  // 优先使用 labelId 从标签中查找当前名称
  if (action.labelId && labels?.length) {
    const foundLabel = labels.find((l) => l.id === action.labelId);
    if (foundLabel) return foundLabel.name;
  }

  // 其次回退到保存的标签名称（可能已过时，但好过没有）
  return action.label || null;
}

export function getActionIcon(actionType: ActionType) {
  switch (actionType) {
    case ActionType.LABEL:
      return TagIcon;
    case ActionType.ARCHIVE:
      return ArchiveIcon;
    case ActionType.DELETE:
      return Trash2Icon;
    case ActionType.MOVE_FOLDER:
      return FolderInputIcon;
    case ActionType.DRAFT_EMAIL:
    case ActionType.DRAFT_MESSAGING_CHANNEL:
      return FileTextIcon;
    case ActionType.REPLY:
      return ReplyIcon;
    case ActionType.SEND_EMAIL:
      return SendIcon;
    case ActionType.FORWARD:
      return ForwardIcon;
    case ActionType.MARK_SPAM:
      return ShieldCheckIcon;
    case ActionType.MARK_READ:
      return MailIcon;
    case ActionType.STAR:
      return StarIcon;
    case ActionType.CALL_WEBHOOK:
      return WebhookIcon;
    case ActionType.DIGEST:
      return NewspaperIcon;
    case ActionType.NOTIFY_MESSAGING_CHANNEL:
      return BellIcon;
    case ActionType.NOTIFY_SENDER:
      return BellIcon;
    case ActionType.INTEGRATION:
      return SquareCheckBigIcon;
    default: {
      const exhaustiveCheck: never = actionType;
      return exhaustiveCheck;
    }
  }
}
