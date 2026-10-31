import type { MeetingRecordingStatus } from "@/generated/prisma/enums";
import { captureException } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import { createMeetingBotProvider } from "@/utils/meeting-recorder/create-bot-provider";
import { enqueueTranscriptFetch } from "@/utils/meeting-recorder/enqueue-processing";
import { LIVE_STATUSES } from "@/utils/meeting-recorder/recording-lifecycle";
import { transitionRecording } from "@/utils/meeting-recorder/transition-recording";
import prisma from "@/utils/prisma";

/**
 * 与具体服务商无关的处理器，每个机器人服务商的 webhook 路由都会
 * 转换到它们。服务商至少投递一次且可能乱序，因此两个处理器都是
 * 幂等的，且绝不会让录制倒退。
 */
export async function handleBotStatusChange({
  botProvider,
  externalBotId,
  status,
  fromStatuses,
  failureReason,
  logger,
}: {
  botProvider: string;
  externalBotId: string;
  status: MeetingRecordingStatus;
  fromStatuses?: MeetingRecordingStatus[];
  failureReason?: string;
  logger: Logger;
}): Promise<void> {
  const result = await transitionRecording({
    botProvider,
    externalBotId,
    status,
    fromStatuses,
    data: failureReason ? { failureReason } : undefined,
  });

  if (result.count === 0) {
    logger.info("已忽略会议机器人状态变更", {
      externalBotId,
      status,
    });
    return;
  }

  logger.info("已更新会议录制状态", { externalBotId, status });
}

export async function handleTranscriptReady({
  botProvider,
  externalBotId,
  externalTranscriptId,
  logger,
}: {
  botProvider: string;
  externalBotId: string;
  externalTranscriptId: string;
  logger: Logger;
}): Promise<void> {
  const recording = await prisma.meetingRecording.findUnique({
    where: { botProvider_externalBotId: { botProvider, externalBotId } },
    select: { id: true, transcriptFetchedAt: true },
  });

  if (!recording) {
    logger.warn("收到未知机器人的转录就绪事件", { externalBotId });
    captureException(new Error("收到未知机器人的会议录制转录"), {
      extra: { botProvider, externalBotId },
    });
    return;
  }

  if (recording.transcriptFetchedAt) {
    logger.info("转录已存储", { recordingId: recording.id });
    return;
  }

  await prisma.meetingRecording.update({
    where: { id: recording.id },
    data: { externalTranscriptId },
  });

  await enqueueTranscriptFetch({ recordingId: recording.id, logger });
}

/**
 * 录制已完成，可以转录。异步转录的服务商
 * 需要被请求才会开始，这是一次与调度机器人
 * 分开的调用。
 *
 * `transcriptRequestedAt` 就是认领，因此重新投递的事件无法
 * 对同一段录制请求两次并被计费两次。它在失败时故意永不
 * 释放：抛错的请求可能仍已被接受，而释放会让重新投递造成重复请求。
 * 过期待认领清扫才是重试那些确实从未成功落地的请求的机制。
 */
export async function handleRecordingReady({
  botProvider,
  externalBotId,
  externalRecordingId,
  logger,
}: {
  botProvider: string;
  externalBotId: string;
  externalRecordingId: string;
  logger: Logger;
}): Promise<void> {
  const recording = await prisma.meetingRecording.findUnique({
    where: { botProvider_externalBotId: { botProvider, externalBotId } },
    select: { id: true, status: true },
  });

  // 未知的机器人不同于已被认领的机器人。它意味着我们
  // 丢失了一段正在付费的录制的追踪，值得发出告警。
  if (!recording) {
    logger.warn("收到未知机器人的录制就绪事件", { externalBotId });
    captureException(new Error("收到未知机器人的会议录制"), {
      extra: { botProvider, externalBotId },
    });
    return;
  }

  if (!LIVE_STATUSES.includes(recording.status)) {
    logger.info("已忽略非实时录制的录制就绪事件", {
      recordingId: recording.id,
      status: recording.status,
    });
    return;
  }

  const claim = await prisma.meetingRecording.updateMany({
    where: {
      id: recording.id,
      status: { in: LIVE_STATUSES },
      transcriptRequestedAt: null,
    },
    data: { externalRecordingId, transcriptRequestedAt: new Date() },
  });

  if (claim.count === 0) {
    logger.info("已为此录制请求过转录", {
      recordingId: recording.id,
    });
    return;
  }

  const provider = createMeetingBotProvider(botProvider, logger);
  await provider.createTranscript(externalRecordingId);

  logger.info("已请求转录", { recordingId: recording.id });
}
