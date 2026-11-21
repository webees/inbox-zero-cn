import { ActionType } from "@/generated/prisma/enums";

// 支持延迟执行的操作类型
const SUPPORTED_DELAYED_ACTIONS: ActionType[] = [
  ActionType.ARCHIVE,
  ActionType.LABEL,
  ActionType.REPLY,
  ActionType.SEND_EMAIL,
  ActionType.FORWARD,
  ActionType.MARK_READ,
  ActionType.STAR,
  ActionType.DELETE,
  ActionType.MOVE_FOLDER,
];

export function canActionBeDelayed(actionType: ActionType): boolean {
  return SUPPORTED_DELAYED_ACTIONS.includes(actionType);
}
