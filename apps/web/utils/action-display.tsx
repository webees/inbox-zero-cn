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
import { getMessagingProviderName } from "@/utils/messaging/platforms";

/**
 * 当已存在邮件草稿时隐藏消息渠道草稿条目，
 * 避免用户在每接入一个聊天应用时都看到重复的「草稿回复」。
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
      let labelName: string | null | undefined = null;

      // 优先级 1：使用 labelId 从标签中查找当前名称
      if (action.labelId && labels?.length) {
        const foundLabel = labels.find((l) => l.id === action.labelId);
        if (foundLabel) {
          labelName = foundLabel.name;
        }
      }

      // 优先级 2：回退到存储的标签名称（可能已过时，但总比没有好）
      if (!labelName && action.label) {
        labelName = action.label;
      }

      return labelName
        ? `${terminology.label.action}为 '${truncate(labelName, 15)}'`
        : terminology.label.action;
    }
    case ActionType.ARCHIVE:
      return "归档";
    case ActionType.DELETE:
      return "删除";
    case ActionType.MARK_READ:
      return "标为已读";
    case ActionType.STAR:
      return "加星标";
    case ActionType.MARK_SPAM:
      return "标为垃圾邮件";
    case ActionType.REPLY:
      return "回复";
    case ActionType.SEND_EMAIL:
      return action.to ? `发送邮件给 ${truncate(action.to, 8)}` : "发送邮件";
    case ActionType.FORWARD:
      return action.to ? `转发给 ${truncate(action.to, 8)}` : "转发";
    case ActionType.MOVE_FOLDER:
      return action.folderName
        ? `移动到 '${action.folderName}' 文件夹`
        : "移动到文件夹";
    case ActionType.DIGEST:
      return "邮件摘要";
    case ActionType.CALL_WEBHOOK:
      return "调用 Webhook";
    case ActionType.NOTIFY_MESSAGING_CHANNEL:
      if (action.messagingChannel?.provider) {
        return `通知 ${getMessagingProviderName(action.messagingChannel.provider)}`;
      }
      return action.notificationDestination
        ? `通知 ${truncate(action.notificationDestination, 18)}`
        : "通知";
    case ActionType.NOTIFY_SENDER:
      return "通知发件人";
    case ActionType.INTEGRATION: {
      const label = getIntegrationActionLabel(action);
      const displayValue = getIntegrationActionDisplayValue(action);
      return displayValue ? `${label}: '${truncate(displayValue, 20)}'` : label;
    }
    default: {
      const exhaustiveCheck: never = action.type;
      return exhaustiveCheck;
    }
  }
}

export const ACTION_TYPE_LABELS = {
  [ActionType.LABEL]: "打标签",
  [ActionType.ARCHIVE]: "归档",
  [ActionType.DELETE]: "删除",
  [ActionType.MARK_READ]: "标为已读",
  [ActionType.MARK_SPAM]: "标为垃圾邮件",
  [ActionType.STAR]: "加星标",
  [ActionType.MOVE_FOLDER]: "移动到文件夹",
  [ActionType.FORWARD]: "转发",
  [ActionType.REPLY]: "回复",
  [ActionType.SEND_EMAIL]: "发送邮件",
  [ActionType.DRAFT_EMAIL]: "草稿回复",
  [ActionType.DRAFT_MESSAGING_CHANNEL]: "起草聊天渠道消息",
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: "通知聊天渠道",
  [ActionType.CALL_WEBHOOK]: "调用 Webhook",
  [ActionType.DIGEST]: "加入邮件摘要",
  [ActionType.NOTIFY_SENDER]: "通知发件人",
  // 仅凭 ActionType 无法指明具体的工具；当操作已知时
  // getIntegrationActionLabel 会给出准确的名称。
  [ActionType.INTEGRATION]: getIntegrationActionLabel(),
} satisfies Record<ActionType, string>;

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
