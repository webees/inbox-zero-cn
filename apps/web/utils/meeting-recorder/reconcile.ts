import { addMinutes } from "date-fns/addMinutes";
import { subMinutes } from "date-fns/subMinutes";
import { subHours } from "date-fns/subHours";
import type { MeetingJoinRule } from "@/generated/prisma/enums";
import {
  MeetingProcessingStatus,
  MeetingRecordingStatus,
} from "@/generated/prisma/enums";
import {
  Prisma,
  type Meeting,
  type MeetingRecording,
} from "@/generated/prisma/client";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import { fetchCalendarEventsInWindow } from "@/utils/calendar/fetch-events-in-window";
import { captureException } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import {
  parseAttendeeSnapshot,
  toAttendeeSnapshot,
} from "@/utils/meeting-recorder/attendees";
import {
  getMeetingBotDisplayName,
  MeetingBotProviderError,
} from "@/utils/meeting-recorder/bot-provider";
import {
  MAX_EVENTS_PER_PROVIDER,
  MAX_PROCESSING_ATTEMPTS,
  PROCESSING_RETRY_WINDOW_HOURS,
  RECONCILE_WINDOW_MINUTES,
  STUCK_PROCESSING_MINUTES,
  STUCK_TRANSCRIPT_REQUEST_MINUTES,
} from "@/utils/meeting-recorder/config";
import {
  createMeetingBotProvider,
  DEFAULT_MEETING_BOT_PROVIDER,
} from "@/utils/meeting-recorder/create-bot-provider";
import { deleteRecordingMedia } from "@/utils/meeting-recorder/delete-media";
import {
  enqueueMeetingProcessing,
  enqueueTranscriptFetch,
} from "@/utils/meeting-recorder/enqueue-processing";
import { shouldAutoJoin } from "@/utils/meeting-recorder/join-rule";
import { normalizeMeetingUrl } from "@/utils/meeting-recorder/normalize-meeting-url";
import {
  CANCELLABLE_STATUSES,
  CHANGEABLE_STATUSES,
  LIVE_STATUSES,
  recordingStatusData,
} from "@/utils/meeting-recorder/recording-lifecycle";
import { transitionRecording } from "@/utils/meeting-recorder/transition-recording";
import { isDuplicateError } from "@/utils/prisma-helpers";
import prisma from "@/utils/prisma";

const STALE_CLAIM_MINUTES = 10;
const ABANDONED_RECORDING_HOURS = 24;

interface RecorderAccount {
  email: string;
  id: string;
  meetingRecorderJoinRule: MeetingJoinRule;
  name: string | null;
}

export async function reconcileAccount({
  emailAccount,
  logger,
}: {
  emailAccount: RecorderAccount;
  logger: Logger;
}): Promise<void> {
  const timeMin = new Date();
  const timeMax = addMinutes(timeMin, RECONCILE_WINDOW_MINUTES);

  logger.info("开始为会议记录器核对拉取日历");
  const { events, complete } = await fetchCalendarEventsInWindow({
    emailAccountId: emailAccount.id,
    timeMin,
    timeMax,
    maxResultsPerProvider: MAX_EVENTS_PER_PROVIDER,
    logger,
  });

  const videoEvents = events.filter((event) => event.videoConferenceLink);
  logger.info("完成会议记录器核对的日历拉取", {
    eventCount: events.length,
    videoEventCount: videoEvents.length,
    complete,
  });

  for (const event of videoEvents) {
    const eventLogger = logger.with({ calendarEventId: event.id });
    eventLogger.info("开始核对日历事件");

    try {
      await reconcileSingleEvent({
        emailAccount,
        event,
        logger: eventLogger,
      });
      eventLogger.info("完成日历事件核对");
    } catch (error) {
      eventLogger.error("核对日历事件失败", {
        error,
      });
      captureException(error, { emailAccountId: emailAccount.id });
    }
  }

  // 释放操作从「不存在」推断出「已删除」，这只有在
  // 我们能确认看到整个日历时才成立。否则一次服务商故障就会取消
  // 该账号已预约的每一个机器人。
  if (!complete) {
    logger.warn("日历拉取不完整，跳过释放扫描");
    return;
  }

  logger.info("开始对未出现的会议执行释放扫描", {
    seenEventCount: videoEvents.length,
  });
  await releaseUnseenMeetings({
    emailAccount,
    seenEventIds: new Set(videoEvents.map((event) => event.id)),
    timeMin,
    timeMax,
    logger,
  });
  logger.info("完成对未出现会议的释放扫描");
}

/**
 * 使单个日历事件与账号设置保持一致：按需
 * 预约、移动或释放机器人。可以安全地从开关操作调用，
 * 用于在下一次 cron 触发前开始的会议。
 */
export async function reconcileSingleEvent({
  emailAccount,
  event,
  meeting: preloadedMeeting,
  logger,
}: {
  emailAccount: RecorderAccount;
  event: CalendarEvent;
  /** 当调用方刚自行 upsert 该行时，跳过内部的 upsert。 */
  meeting?: Meeting;
  logger: Logger;
}): Promise<void> {
  if (!event.videoConferenceLink) return;

  const meeting =
    preloadedMeeting ??
    (await upsertMeeting({
      emailAccountId: emailAccount.id,
      event,
    }));
  const eventLogger = logger.with({ meetingId: meeting.id });
  const botName = getMeetingBotDisplayName({
    ownerName: emailAccount.name,
    ownerEmail: emailAccount.email,
  });

  const wantsRecording = shouldAutoJoin({
    event,
    rule: emailAccount.meetingRecorderJoinRule,
    userEmail: emailAccount.email,
    joinOverride: meeting.joinOverride,
  });

  if (!wantsRecording) {
    await releaseMeeting({
      meetingId: meeting.id,
      recordingId: meeting.recordingId,
      logger: eventLogger,
    });
    return;
  }

  if (meeting.recordingId) {
    const stillBooked = await updateBookingForEvent({
      meetingId: meeting.id,
      recordingId: meeting.recordingId,
      event,
      botName,
      logger: eventLogger,
    });
    // 已释放的预约会继续走下去，针对新链接重新预约。
    if (stillBooked) return;
  }

  const recording = await findOrCreateRecording({
    emailAccountId: emailAccount.id,
    event,
    botName,
    logger: eventLogger,
  });
  if (!recording) return;

  await linkMeetingToRecording({
    meetingId: meeting.id,
    recordingId: recording.id,
    logger: eventLogger,
  });
}

/**
 * 记录账号对日历事件的副本，刷新我们在事件本身
 * 消失后所依赖的快照。与加入覆盖操作共用，
 * 因此两条路径始终写入相同的字段。
 */
export async function upsertMeeting({
  emailAccountId,
  event,
  joinOverride,
}: {
  emailAccountId: string;
  event: CalendarEvent;
  joinOverride?: boolean;
}) {
  const snapshot = {
    eventTitle: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    attendees: toAttendeeSnapshot(event.attendees, event.organizerEmail),
    organizerEmail: event.organizerEmail ?? null,
  };
  const where = {
    emailAccountId_calendarEventId: {
      emailAccountId,
      calendarEventId: event.id,
    },
  };

  // 这会在每个 cron 触发时为每个视频事件运行，因此在事件未变化时
  // 跳过写入（及其 updatedAt 变动）。
  const existing = await prisma.meeting.findUnique({
    where,
  });
  if (
    existing &&
    isSameMeetingSnapshot(existing, snapshot) &&
    (joinOverride === undefined || joinOverride === existing.joinOverride)
  ) {
    return existing;
  }

  const data = {
    ...snapshot,
    ...(joinOverride === undefined ? {} : { joinOverride }),
  };

  return prisma.meeting.upsert({
    where,
    create: { ...data, emailAccountId, calendarEventId: event.id },
    update: data,
  });
}

async function findOrCreateRecording({
  emailAccountId,
  event,
  botName,
  logger,
}: {
  emailAccountId: string;
  event: CalendarEvent;
  botName: string;
  logger: Logger;
}): Promise<MeetingRecording | null> {
  const meetingUrl = event.videoConferenceLink;
  if (!meetingUrl) return null;

  const normalizedMeetingUrl = normalizeMeetingUrl(meetingUrl);
  const activeKey = `${emailAccountId}:${normalizedMeetingUrl}`;

  const existing = await findLiveRecording({
    activeKey,
    startTime: event.startTime,
  });
  if (existing) {
    // 服务商调用暂时失败的占用仍留在这里，
    // 背后没有机器人。现在为它预约就是重试。
    if (existing.externalBotId) return existing;
    return bookBot({ recording: existing, botName, logger });
  }

  // 在调用服务商之前先写入该行来占用会议。如果我们在
  // 两者之间崩溃，过期占用清扫会处理；反过来
  // 则会泄漏一个我们没有记录的机器人。
  let claimed: MeetingRecording;
  try {
    claimed = await prisma.meetingRecording.create({
      data: {
        emailAccountId,
        botProvider: DEFAULT_MEETING_BOT_PROVIDER,
        meetingUrl,
        normalizedMeetingUrl,
        activeKey,
        meetingStartTime: event.startTime,
      },
    });
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
    // 该账号的另一轮处理在我们的查询与写入之间
    // 预约了同一个会议。
    return findLiveRecording({
      activeKey,
      startTime: event.startTime,
    });
  }

  return bookBot({ recording: claimed, botName, logger });
}

async function bookBot({
  recording,
  botName,
  logger,
}: {
  recording: MeetingRecording;
  botName: string;
  logger: Logger;
}): Promise<MeetingRecording | null> {
  const provider = createMeetingBotProvider(recording.botProvider, logger);

  let externalBotId: string;
  logger.info("开始为会议机器人安排服务商调度", {
    recordingId: recording.id,
    botProvider: recording.botProvider,
    meetingStartTime: recording.meetingStartTime,
  });
  try {
    ({ externalBotId } = await provider.scheduleBot({
      botName,
      meetingUrl: recording.meetingUrl,
      joinAt: recording.meetingStartTime,
    }));
    logger.info("完成会议机器人服务商调度", {
      recordingId: recording.id,
      botProvider: recording.botProvider,
    });
  } catch (error) {
    logger.error("为会议机器人安排调度失败", {
      recordingId: recording.id,
      error,
    });

    if (error instanceof MeetingBotProviderError && error.permanent) {
      // 服务商永远不会接受此会议，因此丢弃该占用，
      // 而不是在当天剩余时间里一直占着该时段。
      await prisma.meetingRecording.delete({ where: { id: recording.id } });
    }

    captureException(error);
    return null;
  }

  // 以 externalBotId 作为保护，这样两轮竞相重试同一占用时
  // 不会都记功；落败的一方会取消它刚创建的机器人。
  const claimed = await prisma.meetingRecording.updateMany({
    where: { id: recording.id, externalBotId: null },
    data: {
      externalBotId,
      botName,
      status: MeetingRecordingStatus.SCHEDULED,
    },
  });

  if (claimed.count > 0) {
    logger.info("已安排会议机器人", {
      recordingId: recording.id,
      externalBotId,
      botProvider: recording.botProvider,
      meetingStartTime: recording.meetingStartTime,
    });
  } else {
    logger.info("另一轮处理已预约此会议", {
      recordingId: recording.id,
    });
    try {
      await provider.cancelBot(externalBotId);
    } catch (error) {
      logger.error("取消落败的重复机器人失败", {
        recordingId: recording.id,
        error,
      });
      captureException(error);
      // 在这里丢失 id 会导致一个未被跟踪的机器人加入通话，因此
      // 将其暂存在自己的 CANCELLING 行中，供取消扫描重试。
      // 空的 activeKey 会让它不占用获胜者的去重槽位。
      await prisma.meetingRecording.create({
        data: {
          emailAccountId: recording.emailAccountId,
          botProvider: recording.botProvider,
          externalBotId,
          meetingUrl: recording.meetingUrl,
          normalizedMeetingUrl: recording.normalizedMeetingUrl,
          meetingStartTime: recording.meetingStartTime,
          status: MeetingRecordingStatus.CANCELLING,
        },
      });
    }
  }

  return recording;
}

function findLiveRecording({
  activeKey,
  startTime,
}: {
  activeKey: string;
  startTime: Date;
}) {
  // 依据精确的开始时间进行匹配，这正是唯一约束所
  // 覆盖的内容。容差窗口在两个方向上都不可靠：同一永久房间
  // （个人 Zoom 房间、常驻团队房间）中相隔几分钟的
  // 两个会议会共用一条记录，其中一个会拿到
  // 另一个的转录，而且由于该约束只保护精确的
  // 时间戳，窗口内的两个竞态插入都会成功并
  // 预约两个机器人。在一个账号内，精确匹配能识别出一次
  // 会议的发生，而不会让转录跨越账号边界。
  return prisma.meetingRecording.findFirst({
    where: {
      activeKey,
      meetingStartTime: startTime,
      status: { in: LIVE_STATUSES },
    },
  });
}

async function linkMeetingToRecording({
  meetingId,
  recordingId,
  logger,
}: {
  meetingId: string;
  recordingId: string;
  logger: Logger;
}): Promise<void> {
  try {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { recordingId },
    });
  } catch (error) {
    if (!isDuplicateError(error)) throw error;

    // 该账号在两个日历上都持有此会议。只允许一个 Meeting 行
    // 拥有该记录，因此重复项被关闭且不生成摘要。
    logger.info("该会议已在另一个日历事件下记录", {
      recordingId,
    });
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { processingStatus: MeetingProcessingStatus.COMPLETED },
    });
    return;
  }

  const liveRecording = await prisma.meetingRecording.findFirst({
    where: { id: recordingId, status: { in: LIVE_STATUSES } },
    select: { id: true },
  });
  if (liveRecording) return;

  // 取消操作可能在选中该记录的查询之后、写入此链接之前
  // 占用该记录。移除该过期链接，这样正在取消的机器人
  // 就不会被显示为有效预约；下一次核对可以在取消操作
  // 释放其去重槽位后重新预约。
  await prisma.meeting.updateMany({
    where: { id: meetingId, recordingId },
    data: { recordingId: null },
  });
  logger.info("丢弃了指向已不再有效的记录的链接", {
    recordingId,
  });
}

/**
 * 使已有预约与事件保持一致。
 *
 * 当预约因事件现在指向另一个会议而被释放时返回 false，
 * 这会告诉调用方从头重新预约。
 */
async function updateBookingForEvent({
  meetingId,
  recordingId,
  event,
  botName,
  logger,
}: {
  meetingId: string;
  recordingId: string;
  event: CalendarEvent;
  botName: string;
  logger: Logger;
}): Promise<boolean> {
  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
  });
  if (!recording) return false;

  // 比较去重键，而不是原始链接。Teams 的 `meetup-join` URL 可能带有
  // 每个受邀者各不相同的 `context` 参数，因此比较原始链接会
  // 在每一轮都断开并重新关联该账号的会议。
  const isDifferentMeeting =
    normalizeMeetingUrl(recording.meetingUrl) !==
    normalizeMeetingUrl(event.videoConferenceLink ?? "");

  if (isDifferentMeeting) {
    logger.info("会议链接已变更，正在重新预约", { recordingId });
    await releaseMeeting({ meetingId, recordingId, logger });
    return false;
  }

  // 同一个会议，更新的链接：规范化会去掉凭据，因此这里
  // 正是轮换后的会议密码或受邀者上下文出现的地方。
  if (recording.meetingUrl !== event.videoConferenceLink) {
    const externalBotId = recording.externalBotId;
    const canUpdateBot =
      externalBotId !== null && CHANGEABLE_STATUSES.includes(recording.status);
    if (canUpdateBot) {
      const provider = createMeetingBotProvider(recording.botProvider, logger);
      await provider.updateBot(externalBotId, {
        botName,
        meetingUrl: event.videoConferenceLink,
      });
    }

    await prisma.meetingRecording.updateMany({
      where: { id: recordingId, status: { in: CHANGEABLE_STATUSES } },
      data: {
        meetingUrl: event.videoConferenceLink,
        ...(canUpdateBot && { botName }),
      },
    });
  }

  const startTimeUnchanged =
    recording.meetingStartTime.getTime() === event.startTime.getTime();
  if (startTimeUnchanged) {
    if (
      recording.meetingUrl === event.videoConferenceLink &&
      recording.botName !== botName &&
      recording.externalBotId &&
      CHANGEABLE_STATUSES.includes(recording.status)
    ) {
      const provider = createMeetingBotProvider(recording.botProvider, logger);
      await provider.updateBot(recording.externalBotId, { botName });
      await prisma.meetingRecording.updateMany({
        where: {
          id: recordingId,
          externalBotId: recording.externalBotId,
          status: { in: CHANGEABLE_STATUSES },
        },
        data: { botName },
      });
    }

    return true;
  }

  // 一旦机器人正在加入或已在通话中，就没有什么可移动的了。
  if (!CHANGEABLE_STATUSES.includes(recording.status)) return true;
  if (!recording.externalBotId) return true;

  if (recording.activeKey) {
    const cancellingDestination = await prisma.meetingRecording.findFirst({
      where: {
        id: { not: recording.id },
        activeKey: recording.activeKey,
        meetingStartTime: event.startTime,
        status: MeetingRecordingStatus.CANCELLING,
      },
      select: { id: true },
    });
    if (cancellingDestination) {
      logger.info("正在等待目标记录取消", {
        recordingId: recording.id,
        conflictingRecordingId: cancellingDestination.id,
      });
      return true;
    }
  }

  const provider = createMeetingBotProvider(recording.botProvider, logger);
  const updatedBot = await provider.updateBot(recording.externalBotId, {
    botName,
    joinAt: event.startTime,
    meetingUrl: event.videoConferenceLink ?? recording.meetingUrl,
  });

  try {
    await prisma.meetingRecording.update({
      where: { id: recording.id },
      data: {
        botName,
        meetingStartTime: event.startTime,
        externalBotId: updatedBot.externalBotId,
      },
    });
  } catch (error) {
    if (!isDuplicateError(error)) throw error;

    // 该账号的另一条记录已经占用了目标时段，
    // 它要么仍在取消中，要么已为此事件被移动到的会议
    // 预约了。先持久化任何替换机器人 id，这样被移动的机器人
    // 就不会失去跟踪，然后释放并重新预约：调用方会继续走到
    // 针对目标的预约，目标若有效则关联它，否则等待下一轮
    // 处理，直到时段持有者完成取消。
    if (updatedBot.externalBotId !== recording.externalBotId) {
      await prisma.meetingRecording.update({
        where: { id: recording.id },
        data: { botName, externalBotId: updatedBot.externalBotId },
      });
    }

    logger.info("目标时段已被占用，释放以重新预约", {
      recordingId: recording.id,
    });
    await releaseMeeting({ meetingId, recordingId, logger });
    return false;
  }

  return true;
}

/**
 * 释放账号仍然持有的每一个预约。关闭记录助手也会
 * 将账号从 cron 查询中移除，因此若不这样做，它已预约的
 * 机器人仍会出现在通话中。
 */
export async function releaseAccountBookings({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  await releaseAccountBookingsMatching({
    emailAccountId,
    automaticOnly: false,
    logger,
  });
}

/** 释放由规则驱动的预约，同时保留用户显式启用的会议。 */
export async function releaseAutomaticAccountBookings({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  await releaseAccountBookingsMatching({
    emailAccountId,
    automaticOnly: true,
    logger,
  });
}

// 日历 API 会省略已过计划结束时间的事件，因此正在进行的通话必须
// 能通过我们先前已验证的账号范围快照来取消。
export async function releaseMeetingBooking({
  emailAccountId,
  calendarEventId,
  logger,
}: {
  emailAccountId: string;
  calendarEventId: string;
  logger: Logger;
}): Promise<boolean> {
  const meeting = await prisma.meeting.findFirst({
    where: {
      emailAccountId,
      calendarEventId,
      recordingId: { not: null },
      recording: { status: { in: CANCELLABLE_STATUSES } },
    },
    select: { id: true, recordingId: true },
  });
  if (!meeting?.recordingId) return false;

  const updated = await prisma.meeting.updateMany({
    where: {
      id: meeting.id,
      emailAccountId,
      calendarEventId,
      recordingId: meeting.recordingId,
    },
    data: { joinOverride: false },
  });
  if (updated.count === 0) return false;

  await releaseMeeting({
    meetingId: meeting.id,
    recordingId: meeting.recordingId,
    logger,
  });
  return true;
}

async function releaseAccountBookingsMatching({
  emailAccountId,
  automaticOnly,
  logger,
}: {
  emailAccountId: string;
  automaticOnly: boolean;
  logger: Logger;
}): Promise<void> {
  const booked = await prisma.meeting.findMany({
    where: {
      emailAccountId,
      recordingId: { not: null },
      recording: { status: { in: CANCELLABLE_STATUSES } },
      ...(automaticOnly
        ? { OR: [{ joinOverride: null }, { joinOverride: false }] }
        : {}),
    },
    select: { id: true, recordingId: true },
  });

  for (const meeting of booked) {
    try {
      await releaseMeeting({
        meetingId: meeting.id,
        recordingId: meeting.recordingId,
        logger,
      });
    } catch (error) {
      logger.error("释放预约失败", {
        meetingId: meeting.id,
        error,
      });
      captureException(error, { emailAccountId });
    }
  }

  if (booked.length > 0) {
    logger.info("已为该账号释放会议记录器预约", {
      automaticOnly,
      count: booked.length,
    });
  }
}

/** 将会议与其记录分离，如果没有其他方需要则取消机器人。 */
async function releaseMeeting({
  meetingId,
  recordingId,
  logger,
}: {
  meetingId: string;
  recordingId: string | null;
  logger: Logger;
}): Promise<void> {
  if (!recordingId) return;

  // 只分离被要求处理的那条记录。`recordingId` 是一个快照，
  // 因此并发的一轮可能已经关联了另一条记录或完成了
  // 通话，而无条件清除会丢掉那条记录。
  const detached = await prisma.meeting.updateMany({
    where: {
      id: meetingId,
      recordingId,
      recording: { status: { in: CANCELLABLE_STATUSES } },
    },
    data: { recordingId: null },
  });
  if (detached.count === 0) return;

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
  });
  if (!recording) return;

  await releaseRecording({ recording, logger });
}

/**
 * 取消一条不再有人需要的记录。「没有人需要」的判断本身就是
 * 写入的一部分。与此占用竞态的链接会在写入后执行自己的
 * 状态检查，并在本次状态转换获胜时进行分离。
 */
async function releaseRecording({
  recording,
  logger,
}: {
  recording: MeetingRecording;
  logger: Logger;
}): Promise<void> {
  const claimed = await prisma.meetingRecording.updateMany({
    where: {
      id: recording.id,
      status: { in: CANCELLABLE_STATUSES },
      meetings: { none: {} },
    },
    data: recordingStatusData(MeetingRecordingStatus.CANCELLING),
  });
  if (claimed.count === 0) return;

  await finishCancellation({ recording, logger });
}

async function finishCancellation({
  recording,
  logger,
}: {
  recording: MeetingRecording;
  logger: Logger;
}): Promise<void> {
  if (recording.externalBotId) {
    const provider = createMeetingBotProvider(recording.botProvider, logger);
    await provider.cancelBot(recording.externalBotId);
  }

  await transitionRecording({
    recordingId: recording.id,
    status: MeetingRecordingStatus.CANCELLED,
    fromStatuses: [MeetingRecordingStatus.CANCELLING],
  });
  logger.info("已取消会议记录", { recordingId: recording.id });
}

// 从日历中删除的事件只是不再出现在拉取结果中，因此
// 发现它们的唯一方法就是找出我们已预约但未看到的会议。
async function releaseUnseenMeetings({
  emailAccount,
  seenEventIds,
  timeMin,
  timeMax,
  logger,
}: {
  emailAccount: RecorderAccount;
  seenEventIds: Set<string>;
  timeMin: Date;
  timeMax: Date;
  logger: Logger;
}): Promise<void> {
  const booked = await prisma.meeting.findMany({
    where: {
      emailAccountId: emailAccount.id,
      recordingId: { not: null },
      startTime: { gte: timeMin, lte: timeMax },
      recording: { status: { in: CANCELLABLE_STATUSES } },
    },
    select: { id: true, calendarEventId: true, recordingId: true },
  });

  for (const meeting of booked) {
    if (seenEventIds.has(meeting.calendarEventId)) continue;

    try {
      await releaseMeeting({
        meetingId: meeting.id,
        recordingId: meeting.recordingId,
        logger,
      });
    } catch (error) {
      logger.error("为已消失的事件释放会议失败", {
        meetingId: meeting.id,
        error,
      });
      captureException(error, { emailAccountId: emailAccount.id });
    }
  }
}

/**
 * 与账号无关的清理，每个 cron 触发运行一次：丢弃我们始终
 * 未能预约的占用，将从未上报结果的记录标记为失败，并重试
 * 我们欠用户的媒体删除。
 */
export async function sweepRecordings({
  logger,
}: {
  logger: Logger;
}): Promise<void> {
  const now = new Date();

  const staleClaims = await prisma.meetingRecording.deleteMany({
    where: {
      status: MeetingRecordingStatus.PENDING,
      externalBotId: null,
      createdAt: { lt: subMinutes(now, STALE_CLAIM_MINUTES) },
    },
  });
  if (staleClaims.count > 0) {
    logger.info("已删除过期的会议记录占用", {
      count: staleClaims.count,
    });
  }

  await retryPendingCancellations({ logger });
  await failAbandonedRecordings({ now, logger });
  await retryStuckTranscriptRequests({ now, logger });
  await requeueStuckTranscripts({ now, logger });
  await requeueStuckMeetings({ logger });
  await retryPendingMediaDeletion({ logger });
}

async function retryPendingCancellations({
  logger,
}: {
  logger: Logger;
}): Promise<void> {
  const recordings = await prisma.meetingRecording.findMany({
    where: { status: MeetingRecordingStatus.CANCELLING },
    take: 50,
  });

  for (const recording of recordings) {
    try {
      await finishCancellation({ recording, logger });
    } catch (error) {
      logger.error("重试会议记录取消失败", {
        recordingId: recording.id,
        error,
      });
      captureException(error);
    }
  }
}

/**
 * 将从未上报结果的记录标记为失败。先取消机器人：
 * 将行标记为终态会释放其去重槽位，因此若留下一个仍在运行的
 * 机器人，就会让它已参与的通话被预约一个替代者。
 */
async function failAbandonedRecordings({
  now,
  logger,
}: {
  now: Date;
  logger: Logger;
}): Promise<void> {
  const abandoned = await prisma.meetingRecording.findMany({
    where: {
      status: { in: LIVE_STATUSES },
      meetingStartTime: { lt: subHours(now, ABANDONED_RECORDING_HOURS) },
      // 在服务商处已有转录的记录只是丢失了队列
      // 投递。将其标记为失败会变成终态，因此在
      // requeueStuckTranscripts 仍能恢复它时让它保持有效，只有过了
      // 该重试窗口后才标记为失败。
      NOT: {
        externalTranscriptId: { not: null },
        meetingStartTime: { gt: subHours(now, PROCESSING_RETRY_WINDOW_HOURS) },
      },
    },
    take: 50,
  });

  for (const recording of abandoned) {
    if (recording.externalBotId) {
      try {
        const provider = createMeetingBotProvider(
          recording.botProvider,
          logger,
        );
        await provider.cancelBot(recording.externalBotId);
      } catch (error) {
        // 让该行保持有效，以便下一次扫描再次尝试取消。
        logger.error("取消被遗弃的机器人失败", {
          recordingId: recording.id,
          error,
        });
        captureException(error);
        continue;
      }
    }

    // 仍处于预约状态的行没有证据表明机器人曾经参与过
    // 该通话，因此它会以缺席为由关闭，而不是作为失败记录
    // 出现在「已记录」部分。这两种状态转换都有保护：
    // 在扫描取消其机器人期间，记录可能已推进、完成或开始取消，
    // 而已推进的行会等待
    // 下一次扫描根据其最新状态来判定。
    const engaged = !CHANGEABLE_STATUSES.includes(recording.status);
    await transitionRecording({
      recordingId: recording.id,
      status: engaged
        ? MeetingRecordingStatus.FAILED
        : MeetingRecordingStatus.CANCELLED,
      fromStatuses: engaged ? undefined : CHANGEABLE_STATUSES,
      data: {
        failureReason: "记录助手未就本次会议返回任何结果。",
      },
    });
  }

  if (abandoned.length > 0) {
    logger.info("已清扫被遗弃的会议记录", {
      count: abandoned.length,
    });
  }
}

/**
 * 为那些 create-transcript 调用已被
 * 占用、却从未产出转录的记录重新请求转录，原因可能是工作进程死亡或
 * 服务商从未接受该请求。
 *
 * 该占用在失败时刻意不释放，因此此扫描是唯一
 * 能恢复此类记录的手段。它会等待很长时间才重试，
 * 否则一个实际已到达、只是较慢的请求就会被
 * 重复计费。
 */
async function retryStuckTranscriptRequests({
  now,
  logger,
}: {
  now: Date;
  logger: Logger;
}): Promise<void> {
  const stuck = await prisma.meetingRecording.findMany({
    where: {
      externalRecordingId: { not: null },
      externalTranscriptId: null,
      status: { in: LIVE_STATUSES },
      transcriptRequestedAt: {
        lt: subMinutes(now, STUCK_TRANSCRIPT_REQUEST_MINUTES),
      },
    },
    take: 50,
  });

  let retried = 0;

  for (const recording of stuck) {
    if (!recording.externalRecordingId) continue;

    // 在调用服务商之前，按照读取时所用的同一过期判据
    // 重新占用。否则两个重叠的 cron 运行都会通过读取，
    // 并为同一份转录付费。即使调用失败，刷新后的占用也会保留，
    // 因此持续失败的记录会再次等过整个窗口，
    // 而不是每五分钟重试一次。
    const claim = await prisma.meetingRecording.updateMany({
      where: {
        id: recording.id,
        externalTranscriptId: null,
        status: { in: LIVE_STATUSES },
        transcriptRequestedAt: {
          lt: subMinutes(now, STUCK_TRANSCRIPT_REQUEST_MINUTES),
        },
      },
      data: { transcriptRequestedAt: now },
    });
    if (claim.count === 0) continue;

    retried++;

    try {
      const provider = createMeetingBotProvider(recording.botProvider, logger);
      await provider.createTranscript(recording.externalRecordingId);
    } catch (error) {
      logger.error("重新请求转录失败", {
        recordingId: recording.id,
        error,
      });
      captureException(error);
    }
  }

  if (retried > 0) {
    logger.info("已重新请求卡住的转录", { count: retried });
  }
}

/**
 * 重新排队那些拉取从未完成的转录。此时 webhook 已经
 * 向服务商确认，因此没有其他机制会重试它们。
 */
async function requeueStuckTranscripts({
  now,
  logger,
}: {
  now: Date;
  logger: Logger;
}): Promise<void> {
  const stuck = await prisma.meetingRecording.findMany({
    where: {
      externalTranscriptId: { not: null },
      transcript: { equals: Prisma.DbNull },
      // 失败或已取消的记录永远不会存储其转录，而一个
      // 持续失败的拉取最终必须停止付费，因此只会
      // 再次拾取重试窗口内仍有效的记录。
      status: { in: LIVE_STATUSES },
      meetingStartTime: { gt: subHours(now, PROCESSING_RETRY_WINDOW_HOURS) },
      OR: [
        { transcriptFetchedAt: null },
        {
          transcriptFetchedAt: {
            lt: subMinutes(now, STUCK_PROCESSING_MINUTES),
          },
        },
      ],
    },
    select: { id: true },
    take: 50,
  });

  for (const recording of stuck) {
    // 释放该占用，以便排队的任务能再次接管它。
    await prisma.meetingRecording.update({
      where: { id: recording.id },
      data: { transcriptFetchedAt: null },
    });
    await enqueueTranscriptFetch({ recordingId: recording.id, logger });
  }

  if (stuck.length > 0) {
    logger.info("已重新排队卡住的转录拉取", { count: stuck.length });
  }
}

/**
 * 重新排队那些摘要从未运行的会议：运行中途被杀掉，或
 * 交接的入队从未落地。
 *
 * 它刻意不先移动状态。先写入 PENDING 再入队会在入队
 * 失败时使该行陷入困境，因为下一轮
 * 将不再识别它。相反，该行保持不动，只重新发送
 * 任务；由 `processMeetingForAccount` 占用它，而为已在进行中的
 * 会议重新发送任务是无害的，因为正是该占用起决定作用。
 */
async function requeueStuckMeetings({
  logger,
}: {
  logger: Logger;
}): Promise<void> {
  const now = new Date();
  const staleBefore = subMinutes(now, STUCK_PROCESSING_MINUTES);

  const stuck = await prisma.meeting.findMany({
    where: {
      // 只处理记录实际已准备好进行摘要的会议。
      recording: { transcript: { not: Prisma.DbNull } },
      // 每次尝试都会运行摘要模型，因此持续失败的会议
      // 必须停下来，而不是在每个触发点都计费。
      processingAttempts: { lt: MAX_PROCESSING_ATTEMPTS },
      // 这么旧的内容已不值得再摘要，对其加以限制可以阻止
      // 死行挤占真正卡住的会议。
      startTime: { gt: subHours(now, PROCESSING_RETRY_WINDOW_HOURS) },
      // 处理流程本来就会跳过已禁用的账号；在这里过滤可以避免
      // 扫描在每个触发点都重新入队它们的会议。
      emailAccount: { meetingRecorderEnabled: true },
      OR: [
        {
          processingStatus: MeetingProcessingStatus.PENDING,
          // 刚扇出的会议已经入队；只有当某个
          // PENDING 行超过卡住窗口仍无人认领时才拾取它。
          updatedAt: { lt: staleBefore },
        },
        {
          processingStatus: {
            in: [
              MeetingProcessingStatus.PROCESSING,
              MeetingProcessingStatus.FAILED,
            ],
          },
          updatedAt: { lt: staleBefore },
        },
      ],
    },
    select: { id: true },
    orderBy: { startTime: "asc" },
    take: 50,
  });
  if (stuck.length === 0) return;

  for (const meeting of stuck) {
    await enqueueMeetingProcessing({ meetingId: meeting.id, logger });
  }

  logger.info("已重新排队卡住的会议处理", { count: stuck.length });
}

async function retryPendingMediaDeletion({
  logger,
}: {
  logger: Logger;
}): Promise<void> {
  const recordings = await prisma.meetingRecording.findMany({
    where: {
      mediaDeletedAt: null,
      externalBotId: { not: null },
      OR: [
        {
          status: MeetingRecordingStatus.DONE,
          // 机器人在离开通话时会报告 `done`，这远早于
          // 转录准备就绪。成功的记录只有在转录已存储后才
          // 可以安全删除。
          transcriptFetchedAt: { not: null },
        },
        {
          // 失败和已取消的记录永远不会产出我们想保留的
          // 转录，但可能仍持有服务商的部分媒体。
          status: {
            in: [
              MeetingRecordingStatus.FAILED,
              MeetingRecordingStatus.CANCELLED,
            ],
          },
        },
      ],
    },
    // 再多取一些就会为每一行拉取已存储的转录 blob。
    select: { id: true, botProvider: true, externalBotId: true },
    take: 50,
  });

  for (const recording of recordings) {
    await deleteRecordingMedia({ recording, logger });
  }
}

function isSameMeetingSnapshot(
  existing: Meeting,
  snapshot: {
    eventTitle: string;
    startTime: Date;
    endTime: Date;
    attendees: unknown;
    organizerEmail: string | null;
  },
): boolean {
  return (
    existing.eventTitle === snapshot.eventTitle &&
    existing.startTime.getTime() === snapshot.startTime.getTime() &&
    existing.endTime.getTime() === snapshot.endTime.getTime() &&
    existing.organizerEmail === snapshot.organizerEmail &&
    normalizeAttendees(existing.attendees) ===
      normalizeAttendees(snapshot.attendees)
  );
}

// jsonb 不保留键顺序，因此无法将存储的值与
// 新快照逐字节比较。将两侧重新解析为固定的键顺序，
// 就能让比较针对参与者而非序列化形式。
function normalizeAttendees(value: unknown): string {
  return JSON.stringify(
    parseAttendeeSnapshot(value).map(({ email, name, declined }) => ({
      email,
      name,
      declined,
    })),
  );
}
