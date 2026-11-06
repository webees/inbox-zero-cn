import { MeetingRecordingStatus } from "@/generated/prisma/enums";
import { getStatusesBelow } from "@/utils/meeting-recorder/recording-lifecycle";
import type { RecallWebhookPayload } from "@/utils/recall/types";

type RecallWebhookInterpretation =
  | {
      type: "transcriptReady";
      externalBotId: string;
      externalTranscriptId: string;
    }
  | {
      type: "recordingReady";
      externalBotId: string;
      externalRecordingId: string;
    }
  | {
      type: "statusChange";
      externalBotId: string;
      status: MeetingRecordingStatus;
      fromStatuses?: MeetingRecordingStatus[];
      failureReason?: string;
    }
  | { type: "ignore"; reason: string };

/**
 * 将已验证的 Recall webhook 负载转换为与服务商无关的
 * 所需操作。所有 Recall 负载语义都放在这里，因此 webhook
 * 路由只负责验证、解析和分发。
 */
export function interpretRecallWebhook(
  payload: RecallWebhookPayload,
): RecallWebhookInterpretation {
  const externalBotId = payload.data.bot?.id;
  if (!externalBotId) {
    return { type: "ignore", reason: "webhook 未携带 bot id" };
  }

  if (payload.event === "transcript.done") {
    const externalTranscriptId = payload.data.transcript?.id;
    if (!externalTranscriptId) {
      return {
        type: "ignore",
        reason: "转录事件未携带 transcript id",
      };
    }
    return { type: "transcriptReady", externalBotId, externalTranscriptId };
  }

  // 转录失败通常在服务商侧是可重试的，而
  // 记录本身完好，但它的通用代码会被解读为终态
  // 机器人故障，并永久丢失一场已记录的会议。将该行保持
  // 在有效状态，可让卡住的转录扫描重新请求转录；
  // 如果始终不成功，被遗弃扫描最终会将该行标记为失败。
  if (payload.event === "transcript.failed") {
    return {
      type: "ignore",
      reason: "转录失败，留待重试扫描处理",
    };
  }

  // 记录就绪才会启动异步转录；机器人
  // 完成并不会。若无此设置，转录永远不会产出。
  if (payload.event === "recording.done") {
    const externalRecordingId = payload.data.recording?.id;
    if (!externalRecordingId) {
      return {
        type: "ignore",
        reason: "录制事件未携带 recording id",
      };
    }
    return { type: "recordingReady", externalBotId, externalRecordingId };
  }

  // Recall 在负载中发送生命周期代码，但事件名也携带
  // 相同的信息（`bot.done`、`bot.fatal`），可作为回退。
  const code = payload.data.data?.code ?? payload.event.split(".").at(-1);
  const mappedStatus = code ? recallCodeToStatus(code) : null;
  if (!mappedStatus) {
    return { type: "ignore", reason: `未映射的 Recall 状态码：${code}` };
  }
  const subCode = payload.data.data?.sub_code;
  const status = NO_SHOW_SUB_CODES.has(subCode ?? "")
    ? MeetingRecordingStatus.CANCELLED
    : mappedStatus;

  return {
    type: "statusChange",
    externalBotId,
    status,
    // 机器人已录制后出现的致命事件，通常只是投递打嗝，
    // 而非会议丢失，因此不能将媒体可能仍可恢复的记录
    // 标记为失败。
    fromStatuses:
      code === "fatal"
        ? getStatusesBelow(MeetingRecordingStatus.RECORDING)
        : undefined,
    failureReason:
      mappedStatus === MeetingRecordingStatus.FAILED
        ? getFailureReason(subCode)
        : undefined,
  };
}

// Recall 状态变更事件携带描述机器人生命周期的 `code`。
// https://docs.recall.ai/docs/bot-status-change-events
const RECALL_CODE_TO_STATUS: Record<string, MeetingRecordingStatus> = {
  ready: MeetingRecordingStatus.SCHEDULED,
  joining_call: MeetingRecordingStatus.JOINING,
  in_waiting_room: MeetingRecordingStatus.IN_WAITING_ROOM,
  in_call_not_recording: MeetingRecordingStatus.IN_CALL,
  recording_permission_allowed: MeetingRecordingStatus.IN_CALL,
  in_call_recording: MeetingRecordingStatus.RECORDING,
  call_ended: MeetingRecordingStatus.CALL_ENDED,
  // 机器人完成只意味着它离开了通话。转录是在
  // 之后产出的，因此 DONE 保留给实际已存储转录的
  // 时刻；在那之前用户没有任何可读内容。
  done: MeetingRecordingStatus.CALL_ENDED,
  recording_permission_denied: MeetingRecordingStatus.FAILED,
  fatal: MeetingRecordingStatus.FAILED,
  // 由 `recording.failed` 携带。不对其建立映射会让记录
  // 一直处于有效状态直到 24 小时扫描，并且永远不告诉用户
  // 出了什么问题。`transcript.failed` 也会携带它，但在 webhook
  // 路由中被过滤掉，因为转录失败可重试，而
  // 记录本身完好。
  failed: MeetingRecordingStatus.FAILED,
};

export function recallCodeToStatus(
  code: string,
): MeetingRecordingStatus | null {
  // 自有属性检查：否则像 `constructor` 这样的代码会解析到
  // 继承属性并被当作真实状态。
  if (!Object.hasOwn(RECALL_CODE_TO_STATUS, code)) return null;
  return RECALL_CODE_TO_STATUS[code] ?? null;
}

const NO_SHOW_SUB_CODES = new Set([
  "meeting_not_started",
  "timeout_exceeded_only_bot_detected",
]);

// 针对我们预计在实践中会遇到的失败子代码向用户显示的文案。
// 其他一切都回退到原始子代码，以便支持人员仍能排查。
const SUB_CODE_MESSAGES: Record<string, string> = {
  recording_permission_denied: "主持人拒绝了录制请求。",
  bot_kicked_from_call: "记录助手已被移出通话。",
  bot_kicked_from_waiting_room: "记录助手未被允许从等候室加入。",
  timeout_exceeded_waiting_room: "记录助手在等候室等待，但始终未被允许加入。",
  timeout_exceeded_only_bot_detected:
    "记录助手是唯一的参与者，因此它离开了通话。",
  timeout_exceeded_everyone_left: "通话开始前所有人都已离开。",
  timeout_exceeded_in_call_not_recording:
    "记录助手已加入，但始终未被允许录制。",
  meeting_not_started: "会议从未开始。",
  meeting_link_expired: "会议链接已过期。",
  meeting_link_invalid: "会议链接无效。",
  meeting_locked: "会议已锁定，因此记录助手无法加入。",
  meeting_full: "会议人数已满，因此记录助手无法加入。",
  meeting_requires_sign_in: "会议要求登录账号，因此记录助手无法加入。",
};

export function getFailureReason(subCode: string | null | undefined): string {
  if (!subCode) return "记录助手无法录制此会议。";
  return SUB_CODE_MESSAGES[subCode] ?? `记录助手失败：${subCode}`;
}
