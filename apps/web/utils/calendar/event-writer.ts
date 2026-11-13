import { createCalendarEventProvider } from "@/utils/calendar/event-provider";
import { SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { getProviderAlignedLocationType } from "@/utils/booking/location";
import type { BookingLinkLocationType } from "@/generated/prisma/enums";
import type {
  CalendarEventAttendee,
  CalendarEventWriteResult,
} from "@/utils/calendar/event-types";

export type CreateCalendarEventInput = {
  attendees: CalendarEventAttendee[];
  description?: string;
  destinationCalendarId?: string | null;
  emailAccountId: string;
  endTime: Date;
  locationType: BookingLinkLocationType;
  locationValue?: string | null;
  startTime: Date;
  timezone: string;
  title: string;
};

export type CreatedCalendarEvent = CalendarEventWriteResult & {
  provider: string;
  providerConnectionId: string;
};

export async function createCalendarEvent({
  emailAccountId,
  destinationCalendarId,
  title,
  description,
  startTime,
  endTime,
  timezone,
  attendees,
  locationType,
  locationValue,
  logger,
}: CreateCalendarEventInput & {
  logger: Logger;
}): Promise<CreatedCalendarEvent> {
  const destination = await getWritableCalendar({
    emailAccountId,
    destinationCalendarId,
  });
  const provider = createCalendarEventProvider({
    connection: destination.connection,
    emailAccountId,
    logger,
  });

  const createdEvent = await provider.createEvent({
    calendarId: destination.calendarId,
    title,
    description,
    startTime,
    endTime,
    timezone,
    attendees,
    locationType: getProviderAlignedLocationType({
      locationType,
      provider: destination.connection.provider,
    }),
    locationValue,
  });

  return {
    ...createdEvent,
    provider: destination.connection.provider,
    providerConnectionId: destination.connection.id,
  };
}

export async function updateCalendarEvent({
  providerConnectionId,
  providerCalendarId,
  providerEventId,
  emailAccountId,
  startTime,
  endTime,
  timezone,
  logger,
}: {
  providerConnectionId: string;
  providerCalendarId: string;
  providerEventId: string;
  emailAccountId: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  logger: Logger;
}) {
  const writableProvider = await getWritableProviderForExistingEvent({
    providerConnectionId,
    providerCalendarId,
    emailAccountId,
    logger,
  });

  await writableProvider.updateEvent({
    calendarId: providerCalendarId,
    eventId: providerEventId,
    startTime,
    endTime,
    timezone,
  });
}

export async function cancelCalendarEvent({
  providerConnectionId,
  providerCalendarId,
  providerEventId,
  emailAccountId,
  logger,
}: {
  providerConnectionId: string;
  providerCalendarId: string;
  providerEventId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  const writableProvider = await getWritableProviderForExistingEvent({
    providerConnectionId,
    providerCalendarId,
    emailAccountId,
    logger,
  });

  await writableProvider.cancelEvent({
    calendarId: providerCalendarId,
    eventId: providerEventId,
  });
}

async function getWritableProviderForExistingEvent({
  providerConnectionId,
  providerCalendarId,
  emailAccountId,
  logger,
}: {
  providerConnectionId: string;
  providerCalendarId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  // 按连接 id（唯一）查找，而不是 (emailAccountId, provider)
  // ——一个主机可能有同一服务商的多个连接，而
  // 像 "primary" 这样的 calendarId 会在它们之间重复出现。
  const connection = await prisma.calendarConnection.findFirst({
    where: { id: providerConnectionId, emailAccountId, isConnected: true },
    select: {
      id: true,
      provider: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      calendars: {
        where: { calendarId: providerCalendarId },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!connection) {
    throw new SafeError("未找到日历连接");
  }
  if (connection.calendars.length === 0) {
    throw new SafeError("未找到目标日历");
  }

  return createCalendarEventProvider({
    connection,
    emailAccountId,
    logger,
  });
}

async function getWritableCalendar({
  emailAccountId,
  destinationCalendarId,
}: {
  emailAccountId: string;
  destinationCalendarId?: string | null;
}) {
  // 没有明确目标时，优先选择主日历（通过
  // orderBy），但接受任何已启用的日历——在 Microsoft 主日历
  // 跟踪之前同步的账号没有主日历行。
  const where = destinationCalendarId ? { id: destinationCalendarId } : {};
  // 可用性扫描只考虑已启用的日历，因此写入已禁用
  // 日历会静默绕过冲突检测。
  const calendar = await prisma.calendar.findFirst({
    where: {
      ...where,
      isEnabled: true,
      connection: {
        emailAccountId,
        isConnected: true,
      },
    },
    orderBy: [{ primary: "desc" }, { createdAt: "asc" }],
    select: {
      calendarId: true,
      connection: {
        select: {
          id: true,
          provider: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
        },
      },
    },
  });

  if (!calendar) {
    throw new SafeError("未找到目标日历");
  }

  return calendar;
}
