import { MeetingRecordingStatus } from "@/generated/prisma/enums";
import {
  CAPTURED_MEETING_STATUSES,
  NO_RECORDING_STATUSES,
} from "@/utils/meeting-recorder/recording-lifecycle";

type StatusBadge = {
  label: string;
  variant: "default" | "secondary" | "green" | "red";
};

// 等候室和失败状态是用户需要处理的状态，因此单独标出，而不是并入通用的
// “录制中”状态。
const STATUS_BADGES: Record<MeetingRecordingStatus, StatusBadge> = {
  [MeetingRecordingStatus.PENDING]: {
    label: "正在安排",
    variant: "secondary",
  },
  [MeetingRecordingStatus.SCHEDULED]: {
    label: "已安排",
    variant: "secondary",
  },
  [MeetingRecordingStatus.CANCELLING]: {
    label: "正在取消",
    variant: "secondary",
  },
  [MeetingRecordingStatus.JOINING]: { label: "正在加入", variant: "secondary" },
  [MeetingRecordingStatus.IN_WAITING_ROOM]: {
    label: "等待获准进入",
    variant: "default",
  },
  [MeetingRecordingStatus.IN_CALL]: {
    label: "笔记助手已加入",
    variant: "default",
  },
  [MeetingRecordingStatus.RECORDING]: { label: "录制中", variant: "green" },
  [MeetingRecordingStatus.CALL_ENDED]: {
    label: "处理中",
    variant: "secondary",
  },
  [MeetingRecordingStatus.DONE]: { label: "已录制", variant: "green" },
  [MeetingRecordingStatus.FAILED]: { label: "失败", variant: "red" },
  [MeetingRecordingStatus.CANCELLED]: {
    label: "已取消",
    variant: "secondary",
  },
};

export function getRecordingStatusBadge({
  status,
  startTime,
  endTime,
  now = new Date(),
}: {
  status: MeetingRecordingStatus | undefined;
  startTime: string | Date;
  endTime: string | Date;
  now?: Date;
}): StatusBadge | null {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (start <= now && now < end) {
    if (!status) {
      return { label: "通话进行中", variant: "secondary" };
    }
    if (status === MeetingRecordingStatus.SCHEDULED) {
      return { label: "等待加入", variant: "secondary" };
    }
  }

  if (end <= now && status && !CAPTURED_MEETING_STATUSES.includes(status)) {
    return NO_RECORDING_STATUSES.includes(status)
      ? { label: "未录制", variant: "red" }
      : null;
  }

  return status ? STATUS_BADGES[status] : null;
}
