import type { OperationStatus } from "@inboxzero/mail-core/operations";

export type EngineSendCommand = {
  operationId: string;
  status: OperationStatus;
  kind: string;
  conversationIds: string[];
  messageIds: string[];
};

const NEEDS_DELIVERY_ATTENTION = new Set<string>([
  "blocked_auth",
  "failed",
  "retry_wait",
  "uncertain",
  "needs_attention",
]);

export function engineSendCommandsForThread(
  commands: EngineSendCommand[],
  threadId: string,
) {
  return commands.filter(
    (command) =>
      command.kind === "send" && command.conversationIds.includes(threadId),
  );
}

export function shouldShowEngineDeliveryStatus({
  online,
  status,
}: {
  online: boolean;
  status: string;
}) {
  // 正在核验的发送已交由服务器，由服务器投递，无需此设备。
  if (!online) return status !== "verifying";
  return NEEDS_DELIVERY_ATTENTION.has(status);
}

export function engineDeliveryLabel(status: string, online: boolean) {
  switch (status) {
    case "succeeded":
      return "回复已发送";
    case "executing":
    case "verifying":
      return "Sending…";
    case "uncertain":
      return "无法确认投递";
    case "failed":
    case "needs_attention":
      return "回复无法发送";
    case "blocked_auth":
      return "重新连接账号以发送此回复";
    default:
      return online ? "正在发送…" : "等待连接";
  }
}

export function canEditEngineSend(status: string, online: boolean) {
  if (online && (status === "executing" || status === "verifying"))
    return false;
  return [
    "queued",
    "preparing",
    "retry_wait",
    "blocked_auth",
    "failed",
    "needs_attention",
  ].includes(status);
}

export function engineSendReplyMessageId(
  command: { messageIds: string[] },
  threadMessageIds: string[],
  threadId: string,
) {
  // 会话的最后一行往往是共享模拟器邮箱上早先测试发出的
  // 较晚的 SENT。因此改为回退到原始消息。
  return command.messageIds[0] ?? threadMessageIds[0] ?? threadId;
}
