import sortBy from "lodash/sortBy";
import { ActionType } from "@/generated/prisma/enums";

/**
 * 定义展示操作类型时的优先级顺序。
 * 索引越小优先级越高（排在最前面）。
 */
const ACTION_TYPE_PRIORITY_ORDER: ActionType[] = [
  ActionType.LABEL,

  ActionType.MOVE_FOLDER,
  ActionType.ARCHIVE,
  ActionType.DELETE,
  ActionType.MARK_READ,
  ActionType.STAR,

  ActionType.DRAFT_EMAIL,
  ActionType.DRAFT_MESSAGING_CHANNEL,
  ActionType.REPLY,
  ActionType.SEND_EMAIL,
  ActionType.FORWARD,

  ActionType.DIGEST,

  ActionType.NOTIFY_MESSAGING_CHANNEL,
  ActionType.MARK_SPAM,
  ActionType.NOTIFY_SENDER,
  ActionType.CALL_WEBHOOK,
  ActionType.INTEGRATION,
];

/**
 * 获取某个操作类型的优先级索引。
 * 数字越小表示优先级越高（排在最前面）。
 */
function getActionTypePriority(actionType: ActionType): number {
  const index = ACTION_TYPE_PRIORITY_ORDER.indexOf(actionType);
  // 如果操作类型不在优先级列表中，给予非常低的优先级
  return index === -1 ? 999 : index;
}

/**
 * 按操作类型优先级对操作数组排序。
 * 优先级数字越小（优先级越高）的操作排在最前面。
 */
export function sortActionsByPriority<T extends { type: ActionType }>(
  actions: T[],
): T[] {
  return sortBy(
    actions,
    [(action) => getActionTypePriority(action.type)],
    ["asc"],
  );
}
