import type { MeetingRecording } from "@/generated/prisma/client";
import { MeetingRecordingStatus } from "@/generated/prisma/enums";
import { captureException } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import { createMeetingBotProvider } from "@/utils/meeting-recorder/create-bot-provider";
import { LIVE_STATUSES } from "@/utils/meeting-recorder/recording-lifecycle";
import prisma from "@/utils/prisma";

/**
 * 我们保留转录，从不保留媒体。尽力而为：此处的失败会让
 * `mediaDeletedAt` 保持未设置，而这正是 cron 清扫所查找的，
 * 因此这笔欠账总是会被重试而不是丢失。
 */
export async function deleteRecordingMedia({
  recording,
  logger,
}: {
  recording: Pick<MeetingRecording, "id" | "botProvider" | "externalBotId">;
  logger: Logger;
}): Promise<void> {
  if (!recording.externalBotId) return;

  try {
    const provider = createMeetingBotProvider(recording.botProvider, logger);
    await provider.deleteMedia(recording.externalBotId);
    await prisma.meetingRecording.update({
      where: { id: recording.id },
      data: { mediaDeletedAt: new Date() },
    });
  } catch (error) {
    logger.error("Failed to delete meeting recording media", {
      recordingId: recording.id,
      error,
    });
    captureException(error);
  }
}

/**
 * 录制行是机器人和其媒体所在位置的唯一记录，它们会随账号级联。
 * 服务商错误会向上传播，因此在机器人仍可能加入通话或媒体仍存在时，
 * 账号不会被删除。
 */
export async function releaseAccountRecordings({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  const recordings = await prisma.meetingRecording.findMany({
    where: {
      emailAccountId,
      mediaDeletedAt: null,
      externalBotId: { not: null },
    },
    select: { botProvider: true, externalBotId: true, status: true },
  });

  for (const { botProvider, externalBotId, status } of recordings) {
    if (!externalBotId) continue;

    const provider = createMeetingBotProvider(botProvider, logger);
    if (BOT_MAY_BE_ACTIVE_STATUSES.includes(status)) {
      await provider.cancelBot(externalBotId);
    }
    await provider.deleteMedia(externalBotId);
  }
}

const BOT_MAY_BE_ACTIVE_STATUSES: MeetingRecordingStatus[] = [
  ...LIVE_STATUSES,
  MeetingRecordingStatus.CANCELLING,
];
