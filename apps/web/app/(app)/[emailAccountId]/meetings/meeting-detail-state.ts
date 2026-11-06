import {
  MeetingProcessingStatus,
  MeetingRecordingStatus,
} from "@/generated/prisma/enums";
import { CAPTURED_MEETING_STATUSES } from "@/utils/meeting-recorder/recording-lifecycle";

export type MeetingDetailState =
  | "notes"
  | "notes-unavailable"
  | "not-recorded"
  | "processing"
  | "processing-failed"
  | "recording-failed";

/**
 * 会议对话框应显示的内容。只要预约了机器人，会议就会被列出，
 * 因此对话框早在有任何内容可读之前就会打开，而录制和总结
 * 都可能各自失败。
 */
export function getMeetingDetailState({
  hasSummary,
  hasTranscript,
  recordingStatus,
  processingStatus,
}: {
  hasSummary: boolean;
  hasTranscript: boolean;
  recordingStatus: MeetingRecordingStatus | undefined;
  processingStatus: MeetingProcessingStatus | undefined;
}): MeetingDetailState {
  if (hasSummary) return "notes";
  if (recordingStatus === MeetingRecordingStatus.FAILED) {
    return "recording-failed";
  }
  if (processingStatus === MeetingProcessingStatus.FAILED) {
    return "processing-failed";
  }
  if (processingStatus === MeetingProcessingStatus.COMPLETED) {
    return "notes-unavailable";
  }
  if (hasTranscript) return "notes";

  // 机器人进入通话后，即便还没有内容可读，会议也已在被采集，
  // 因此显示“未录制”是不对的。
  if (recordingStatus && CAPTURED_MEETING_STATUSES.includes(recordingStatus)) {
    return "processing";
  }

  return "not-recorded";
}
