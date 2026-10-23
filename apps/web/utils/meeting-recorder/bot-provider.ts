// 出现在参会者列表中的机器人对外的产品名称。
export const MEETING_BOT_DISPLAY_NAME = "Inbox Zero Notetaker";
const MAX_MEETING_BOT_DISPLAY_NAME_LENGTH = 100;

interface TranscriptUtterance {
  email?: string;
  endTime: number;
  isHost: boolean;
  speakerName: string;
  /** 从录制开始算起的秒数。 */
  startTime: number;
  text: string;
}

/** 与服务商无关的转录。下游只消费这个。 */
export type NormalizedTranscript = TranscriptUtterance[];

/**
 * 一次失败的服务商调用。`permanent` 告诉 reconciler 重试
 * 同一请求是否有可能成功，以便它决定是
 * 释放认领还是把该行留给下一轮。
 */
export class MeetingBotProviderError extends Error {
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "MeetingBotProviderError";
    this.permanent = permanent;
  }
}

export interface MeetingBotProvider {
  /** 宽容处理：机器人已不存在不算错误。 */
  cancelBot(externalBotId: string): Promise<void>;
  /**
   * 请求服务商开始为已完成的录制生成转录。
   * 自动转录的服务商可能将其实现为空操作，
   * 但调用方必须在录制就绪后始终调用它。
   */
  createTranscript(externalRecordingId: string): Promise<void>;
  /** 宽容处理：媒体已不存在不算错误。 */
  deleteMedia(externalBotId: string): Promise<void>;
  fetchTranscript(externalTranscriptId: string): Promise<NormalizedTranscript>;
  /**
   * 机器人在整个通话期间驻留，而不是日历时段：它必须在
   * 参会者离开时离开，而不是在预定的结束时间。
   */
  scheduleBot(params: {
    botName?: string;
    meetingUrl: string;
    joinAt: Date;
  }): Promise<{ externalBotId: string }>;
  /** 更新一个已调度但尚未开始加入的机器人。 */
  updateBot(
    externalBotId: string,
    params: { botName: string; joinAt?: Date; meetingUrl?: string },
  ): Promise<{ externalBotId: string }>;
}

export function getMeetingBotDisplayName({
  ownerName,
  ownerEmail,
}: {
  ownerName: string | null;
  ownerEmail: string;
}): string {
  const firstName = ownerName?.trim().split(/\s+/)[0];
  const ownerIdentifier = firstName || ownerEmail;
  const suffix = `'s ${MEETING_BOT_DISPLAY_NAME}`;
  const maxOwnerIdentifierLength =
    MAX_MEETING_BOT_DISPLAY_NAME_LENGTH - suffix.length;

  const truncatedOwnerIdentifier = ownerIdentifier.slice(
    0,
    maxOwnerIdentifierLength,
  );
  const unicodeSafeOwnerIdentifier = /[\uD800-\uDBFF]$/.test(
    truncatedOwnerIdentifier,
  )
    ? truncatedOwnerIdentifier.slice(0, -1)
    : truncatedOwnerIdentifier;

  return `${unicodeSafeOwnerIdentifier}${suffix}`;
}
