import { TZDate } from "@date-fns/tz";
import { startOfDay, endOfDay, format } from "date-fns";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import type { BusyPeriod } from "./availability-types";
import { getCalendarAvailabilityErrorLogContext } from "./availability-error";
import { createGoogleAvailabilityProvider } from "./providers/google-availability";
import { createMicrosoftAvailabilityProvider } from "./providers/microsoft-availability";
import { isGoogleVirtualCalendarId } from "./providers/google-calendar-id";
import { isGoogleProvider } from "@/utils/email/provider-types";

/**
 * 获取所有已连接日历（Google 和 Microsoft）的日历可用性
 */
export async function getUnifiedCalendarAvailability({
  emailAccountId,
  startDate,
  endDate,
  timezone = "UTC",
  logger,
  failClosed = false,
  excludeGoogleVirtualCalendars = false,
}: {
  emailAccountId: string;
  startDate: Date | string;
  endDate: Date | string;
  timezone?: string;
  logger: Logger;
  failClosed?: boolean;
  excludeGoogleVirtualCalendars?: boolean;
}): Promise<BusyPeriod[]> {
  // 在用户时区中计算天的边界
  // 将日期解析为目标时区中的日历日期以避免 UTC 偏移问题
  const startDateInTZ = parseDateInTimezone(startDate, timezone);
  const endDateInTZ = parseDateInTimezone(endDate, timezone);

  const timeMin = startOfDay(startDateInTZ).toISOString();
  const timeMax = endOfDay(endDateInTZ).toISOString();

  logger.trace("统一日历可用性请求", {
    timezone,
    emailAccountId,
    startDate: startDate instanceof Date ? startDate.toISOString() : startDate,
    endDate: endDate instanceof Date ? endDate.toISOString() : endDate,
    timeMin,
    timeMax,
  });

  // 获取所有日历连接及其日历
  const calendarConnections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
    },
    include: {
      calendars: {
        where: { isEnabled: true },
        select: {
          calendarId: true,
        },
      },
    },
  });

  if (!calendarConnections.length) {
    logger.info("未找到日历连接", { emailAccountId });
    return [];
  }

  // 按服务商分组日历
  const googleConnections = calendarConnections.filter((conn) =>
    isGoogleProvider(conn.provider),
  );
  const microsoftConnections = calendarConnections.filter(
    (conn) => conn.provider === "microsoft",
  );

  const promises: Promise<BusyPeriod[]>[] = [];

  // 获取 Google 日历可用性
  for (const connection of googleConnections) {
    const calendarIds = connection.calendars.map((cal) => cal.calendarId);
    const availabilityCalendarIds = excludeGoogleVirtualCalendars
      ? calendarIds.filter(
          (calendarId) => !isGoogleVirtualCalendarId(calendarId),
        )
      : calendarIds;
    if (!availabilityCalendarIds.length) continue;

    const googleAvailabilityProvider = createGoogleAvailabilityProvider(logger);

    promises.push(
      googleAvailabilityProvider
        .fetchBusyPeriods({
          accessToken: connection.accessToken,
          connectionId: connection.id,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt?.getTime() || null,
          emailAccountId,
          calendarIds: availabilityCalendarIds,
          timeMin,
          timeMax,
          failOnCalendarError: failClosed,
        })
        .catch((error) => {
          logger.error("获取 Google 日历可用性出错", {
            error,
            connectionId: connection.id,
            ...getCalendarAvailabilityErrorLogContext(error),
          });
          if (failClosed) throw error;
          return [];
        }),
    );
  }

  // 获取 Microsoft 日历可用性
  for (const connection of microsoftConnections) {
    const calendarIds = connection.calendars.map((cal) => cal.calendarId);

    if (!calendarIds.length) {
      logger.warn("Microsoft 连接没有已启用的日历", {
        connectionId: connection.id,
      });
      continue;
    }

    const microsoftAvailabilityProvider =
      createMicrosoftAvailabilityProvider(logger);

    promises.push(
      microsoftAvailabilityProvider
        .fetchBusyPeriods({
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt?.getTime() || null,
          emailAccountId,
          calendarIds,
          timeMin,
          timeMax,
          failOnCalendarError: failClosed,
        })
        .catch((error) => {
          logger.error("获取 Microsoft 日历可用性出错", {
            error,
            connectionId: connection.id,
            ...getCalendarAvailabilityErrorLogContext(error),
          });
          if (failClosed) throw error;
          return [];
        }),
    );
  }

  // 等待所有服务商返回结果
  const results = await Promise.all(promises);

  // 展平并合并所有忙碌时段
  const allBusyPeriods = results.flat();

  // 将所有忙碌时段从 UTC 转换为用户时区
  const convertedBusyPeriods = convertBusyPeriodsToTimezone(
    allBusyPeriods,
    timezone,
  );

  logger.trace("统一日历可用性结果", {
    totalBusyPeriods: convertedBusyPeriods.length,
    googleConnectionsCount: googleConnections.length,
    microsoftConnectionsCount: microsoftConnections.length,
  });

  return convertedBusyPeriods;
}

/**
 * 将忙碌时段从 UTC 转换为指定时区
 */
function convertBusyPeriodsToTimezone(
  busyPeriods: BusyPeriod[],
  timezone: string,
): BusyPeriod[] {
  return busyPeriods.map((period) => {
    const startInTZ = new TZDate(period.start, timezone);
    const endInTZ = new TZDate(period.end, timezone);

    return {
      start: format(startInTZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      end: format(endInTZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    };
  });
}

/**
 * 解析日期字符串（YYYY-MM-DD）或 ISO 日期字符串，并在目标时区创建 TZDate。
 * 这确保日期被解释为目标时区中的该日历日期，
 * 而不是被偏移的 UTC 时间戳。
 */
function parseDateInTimezone(
  dateInput: string | Date,
  timezone: string,
): TZDate {
  if (dateInput instanceof Date) {
    // 为向后兼容：如果传入 Date 对象，则使用其 UTC 日期组成部分
    // 在目标时区中构造日期
    const year = dateInput.getUTCFullYear();
    const month = dateInput.getUTCMonth();
    const day = dateInput.getUTCDate();
    return new TZDate(year, month, day, 0, 0, 0, 0, timezone);
  }

  // 处理 ISO 日期字符串（YYYY-MM-DD）或日期时间字符串
  const dateStr = dateInput.includes("T") ? dateInput.split("T")[0] : dateInput;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);
}
