import prisma from "@/utils/prisma";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { MeetingBriefingStatus } from "@/generated/prisma/enums";
import {
  fetchUpcomingEvents,
  filterEventsWithExternalGuests,
} from "./fetch-upcoming-events";
import { gatherContextForEvent } from "./gather-context";
import { aiGenerateMeetingBriefing } from "@/utils/ai/meeting-briefs/generate-briefing";
import { sendBriefing } from "./send-briefing";
import type { Logger } from "@/utils/logger";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import { partitionAttendeesForBriefing } from "./attendees";

export type EmailAccountForBrief = {
  id: string;
  userId: string;
  email: string;
  about: string | null;
  multiRuleSelectionEnabled: boolean;
  sensitiveDataPolicy: string | null;
  timezone: string | null;
  calendarBookingLink: string | null;
  user: {
    aiProvider: string | null;
    aiModel: string | null;
    aiApiKey: string | null;
  };
  account: {
    provider: string;
  };
};

export async function processMeetingBriefings({
  emailAccountId,
  userEmail,
  minutesBefore,
  logger,
}: {
  emailAccountId: string;
  userEmail: string;
  minutesBefore: number;
  logger: Logger;
}): Promise<void> {
  logger.info("正在处理会议简报", { minutesBefore });

  // 1. 拉取即将到来的事件
  const allEvents = await fetchUpcomingEvents({
    emailAccountId,
    minutesBefore,
    logger,
  });

  logger.info("已拉取即将到来的事件", { count: allEvents.length });

  // 2. 筛选出有外部受邀者的事件
  const eventsWithExternalGuests = filterEventsWithExternalGuests(
    allEvents,
    userEmail,
  );

  if (eventsWithExternalGuests.length === 0) {
    logger.info("No events with external guests, skipping");
    return;
  }

  // 3. 检查哪些事件尚未生成简报
  const existingBriefings = await prisma.meetingBriefing.findMany({
    where: {
      emailAccountId,
      calendarEventId: {
        in: eventsWithExternalGuests.map((e) => e.id),
      },
    },
    select: { calendarEventId: true },
  });

  const briefedEventIds = new Set(
    existingBriefings.map((b) => b.calendarEventId),
  );
  const eventsToProcess = eventsWithExternalGuests.filter(
    (event) => !briefedEventIds.has(event.id),
  );

  if (eventsToProcess.length === 0) {
    logger.info("All events already briefed, skipping");
    return;
  }

  // 获取完整的邮箱账号用于 AI 生成
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      id: true,
      userId: true,
      email: true,
      about: true,
      multiRuleSelectionEnabled: true,
      sensitiveDataPolicy: true,
      timezone: true,
      calendarBookingLink: true,
      user: {
        select: {
          aiProvider: true,
          aiModel: true,
          aiApiKey: true,
        },
      },
      account: {
        select: {
          provider: true,
        },
      },
    },
  });

  if (!emailAccount) {
    logger.error("未找到邮箱账号");
    return;
  }

  // 4. 处理每个事件
  for (const event of eventsToProcess) {
    try {
      await runMeetingBrief({
        event,
        emailAccount,
        emailAccountId,
        isTestSend: false,
        logger,
      });
    } catch {
      // 错误已由 runMeetingBrief 记录并保存
    }
  }

  logger.info("已完成会议简报处理");
}

export async function runMeetingBrief({
  event,
  emailAccount,
  emailAccountId,
  logger,
  isTestSend,
}: {
  event: CalendarEvent;
  emailAccount: EmailAccountForBrief;
  emailAccountId: string;
  logger: Logger;
  isTestSend: boolean;
}): Promise<{ success: boolean; message?: string }> {
  const userEmail = emailAccount.email;
  const provider = emailAccount.account.provider;

  const eventLog = logger.with({ eventId: event.id });

  const { external: externalAttendees, internal: internalAttendees } =
    partitionAttendeesForBriefing(event, userEmail);
  const externalGuestCount = externalAttendees.length;

  if (!isTestSend) {
    const claimed = await claimMeetingBriefing({
      emailAccountId,
      calendarEventId: event.id,
      eventTitle: event.title,
      eventStartTime: event.startTime,
      guestCount: externalGuestCount,
    });

    if (!claimed) {
      eventLog.info("Event already claimed by another process, skipping");
      return { success: false, message: "正在处理中" };
    }
  }

  try {
    const briefingData = await gatherContextForEvent({
      event,
      emailAccountId,
      externalAttendees,
      internalAttendees,
      provider,
      logger: eventLog,
    });

    if (briefingData.externalGuests.length === 0) {
      eventLog.info("未找到事件的外部受邀者，跳过");
      if (!isTestSend) {
        await upsertMeetingBriefingStatus({
          emailAccountId,
          calendarEventId: event.id,
          eventTitle: event.title,
          eventStartTime: event.startTime,
          guestCount: externalGuestCount,
          status: MeetingBriefingStatus.SKIPPED,
          logger: eventLog,
        });
      }
      return { success: false, message: "未找到外部受邀者" };
    }

    const briefingContent = await aiGenerateMeetingBriefing({
      briefingData,
      emailAccount,
      logger: eventLog,
    });

    await sendBriefing({
      event,
      briefingContent,
      internalTeamMembers: briefingData.internalTeamMembers,
      emailAccountId,
      userEmail,
      provider,
      userTimezone: emailAccount.timezone,
      logger: eventLog,
    });

    if (!isTestSend) {
      await upsertMeetingBriefingStatus({
        emailAccountId,
        calendarEventId: event.id,
        eventTitle: event.title,
        eventStartTime: event.startTime,
        guestCount: externalGuestCount,
        status: MeetingBriefingStatus.SENT,
        logger: eventLog,
      });
    }

    eventLog.info("会议简报已成功发送");
    return { success: true, message: "简报已成功发送" };
  } catch (error) {
    eventLog.error("处理会议简报失败", { error });

    if (!isTestSend) {
      await upsertMeetingBriefingStatus({
        emailAccountId,
        calendarEventId: event.id,
        eventTitle: event.title,
        eventStartTime: event.startTime,
        guestCount: externalGuestCount,
        status: MeetingBriefingStatus.FAILED,
        logger: eventLog,
      });
    }

    throw error;
  }
}

async function claimMeetingBriefing({
  emailAccountId,
  calendarEventId,
  eventTitle,
  eventStartTime,
  guestCount,
}: {
  emailAccountId: string;
  calendarEventId: string;
  eventTitle: string;
  eventStartTime: Date;
  guestCount: number;
}): Promise<boolean> {
  try {
    await prisma.meetingBriefing.create({
      data: {
        emailAccountId,
        calendarEventId,
        eventTitle,
        eventStartTime,
        guestCount,
        status: MeetingBriefingStatus.PENDING,
      },
    });
    return true;
  } catch (error) {
    if (isDuplicateError(error)) {
      return false;
    }
    throw error;
  }
}

async function upsertMeetingBriefingStatus({
  emailAccountId,
  calendarEventId,
  eventTitle,
  eventStartTime,
  guestCount,
  status,
  logger,
}: {
  emailAccountId: string;
  calendarEventId: string;
  eventTitle: string;
  eventStartTime: Date;
  guestCount: number;
  status: MeetingBriefingStatus;
  logger: Logger;
}): Promise<void> {
  try {
    await prisma.meetingBriefing.upsert({
      where: {
        emailAccountId_calendarEventId: {
          emailAccountId,
          calendarEventId,
        },
      },
      create: {
        emailAccountId,
        calendarEventId,
        eventTitle,
        eventStartTime,
        guestCount,
        status,
      },
      update: { status },
    });
  } catch (error) {
    logger.error("写入会议简报状态失败", { error, status });
  }
}
