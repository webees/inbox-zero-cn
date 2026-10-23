import type { MeetingRecordingStatus } from "@/generated/prisma/enums";
import {
  getStatusesBelow,
  recordingStatusData,
} from "@/utils/meeting-recorder/recording-lifecycle";
import prisma from "@/utils/prisma";

/**
 * 仅当移动到 `next` 是向前一步时才移动某段录制，因此并发的
 * DONE 或 CANCELLING 写入绝不会被覆盖。录制通过 id 或其服务商
 * 标识（webhook 所拥有的全部信息）来定位。返回更新计数；
 * 零表示该录制已经向前移动过了。
 */
export function transitionRecording(
  params: (
    | { recordingId: string }
    | { botProvider: string; externalBotId: string }
  ) & {
    status: MeetingRecordingStatus;
    fromStatuses?: MeetingRecordingStatus[];
    data?: { failureReason?: string; transcriptFetchedAt?: Date };
  },
) {
  const selector =
    "recordingId" in params
      ? { id: params.recordingId }
      : {
          botProvider: params.botProvider,
          externalBotId: params.externalBotId,
        };

  return prisma.meetingRecording.updateMany({
    where: {
      ...selector,
      status: {
        in: params.fromStatuses ?? getStatusesBelow(params.status),
      },
    },
    data: { ...recordingStatusData(params.status), ...params.data },
  });
}
