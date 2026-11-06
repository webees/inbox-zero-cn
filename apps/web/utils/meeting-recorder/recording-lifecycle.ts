import { MeetingRecordingStatus } from "@/generated/prisma/enums";

// 尚未达到终态的录制，仍可被调度、重新调度或取消。
export const LIVE_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.PENDING,
  MeetingRecordingStatus.SCHEDULED,
  MeetingRecordingStatus.JOINING,
  MeetingRecordingStatus.IN_WAITING_ROOM,
  MeetingRecordingStatus.IN_CALL,
  MeetingRecordingStatus.RECORDING,
  MeetingRecordingStatus.CALL_ENDED,
];

export const CANCELLABLE_STATUSES: MeetingRecordingStatus[] =
  LIVE_STATUSES.filter(
    (status) => status !== MeetingRecordingStatus.CALL_ENDED,
  );

// 一旦机器人已在前往通话的途中，就没有任何有用的东西可更改了。
export const CHANGEABLE_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.PENDING,
  MeetingRecordingStatus.SCHEDULED,
];

// 机器人尝试接入通话（试图加入或加入失败）但没有交付
// 任何媒体。会议结束后仍处于这些状态之一的录制
// 没有产生任何内容。
export const NO_RECORDING_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.JOINING,
  MeetingRecordingStatus.IN_WAITING_ROOM,
  MeetingRecordingStatus.FAILED,
];

// 机器人仍在通话中，即使日历事件的预定结束时间已过。
// 在服务商报告通话结束之前，这些会议会一直留在即将开始
// 的部分。
export const ACTIVE_CALL_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.IN_CALL,
  MeetingRecordingStatus.RECORDING,
];

// 即使日历事件的预定结束时间仍在未来，这些结果也有
// 有用的细节可供展示。
export const MEETING_DETAIL_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.CALL_ENDED,
  MeetingRecordingStatus.DONE,
];

// 机器人成功进入了通话，因此媒体已存在或仍在采集。
// 处于这些状态的会议绝不能呈现为“未录制”。
export const CAPTURED_MEETING_STATUSES: MeetingRecordingStatus[] = [
  ...ACTIVE_CALL_STATUSES,
  ...MEETING_DETAIL_STATUSES,
];

// 已预约的机器人不等于已录制的会议。一旦预定事件结束，
// 显示失败的尝试和采集已实际结束的通话；
// 进行中的通话会留在即将开始的部分。
export const RECORDED_SECTION_STATUSES: MeetingRecordingStatus[] = [
  ...NO_RECORDING_STATUSES,
  ...MEETING_DETAIL_STATUSES,
];

// Rank 对生命周期排序，以便重放或乱序的 webhook 只能让
// 录制向前移动。
const STATUS_RANK: Record<MeetingRecordingStatus, number> = {
  [MeetingRecordingStatus.PENDING]: 0,
  [MeetingRecordingStatus.SCHEDULED]: 1,
  [MeetingRecordingStatus.JOINING]: 2,
  [MeetingRecordingStatus.IN_WAITING_ROOM]: 3,
  [MeetingRecordingStatus.IN_CALL]: 4,
  [MeetingRecordingStatus.RECORDING]: 5,
  [MeetingRecordingStatus.CALL_ENDED]: 6,
  [MeetingRecordingStatus.CANCELLING]: 7,
  // 终态结果：没有任何东西可以把录制移出它们。迟到的失败
  // 事件绝不能抹掉我们已有转录的录制。
  [MeetingRecordingStatus.DONE]: 8,
  [MeetingRecordingStatus.FAILED]: 8,
  [MeetingRecordingStatus.CANCELLED]: 8,
};

const TERMINAL_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.DONE,
  MeetingRecordingStatus.FAILED,
  MeetingRecordingStatus.CANCELLED,
];

const LOCKED_STATUSES: MeetingRecordingStatus[] = [
  MeetingRecordingStatus.CANCELLING,
  ...TERMINAL_STATUSES,
];

/**
 * 状态变更必须写入的字段。到达终态会清除
 * `activeKey`，释放该行持有的去重槽位，以便同一场会议
 * 在被取消或失败后可以再次预约。每次状态写入都经过
 * 这里，而不是自行设置 `status`。
 */
export function recordingStatusData(status: MeetingRecordingStatus) {
  return TERMINAL_STATUSES.includes(status)
    ? { status, activeKey: null }
    : { status };
}

/**
 * 录制当前可以处于、且移动到 `next` 算作向前一步的状态。
 * 用作单调 `updateMany` 的 `where` 子句。
 */
export function getStatusesBelow(
  next: MeetingRecordingStatus,
): MeetingRecordingStatus[] {
  const nextRank = STATUS_RANK[next];

  return Object.values(MeetingRecordingStatus).filter(
    (status) =>
      STATUS_RANK[status] < nextRank && !LOCKED_STATUSES.includes(status),
  );
}
