import type { Client } from "@microsoft/microsoft-graph-client";
import type { Logger } from "@/utils/logger";
import { getCalendarClientWithRefresh } from "@/utils/outlook/calendar-client";
import type {
  CalendarAvailabilityProvider,
  BusyPeriod,
} from "../availability-types";

async function fetchMicrosoftCalendarBusyPeriods({
  calendarClient,
  calendarIds,
  timeMin,
  timeMax,
  logger,
  failOnCalendarError,
}: {
  calendarClient: Client;
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
  logger: Logger;
  failOnCalendarError?: boolean;
}): Promise<BusyPeriod[]> {
  try {
    const allBusyPeriods: BusyPeriod[] = [];

    for (const calendarId of calendarIds) {
      try {
        const startDateTime = new Date(timeMin).toISOString();
        const endDateTime = new Date(timeMax).toISOString();

        // 通过跟进 @odata.nextLink 获取所有页事件
        let nextLink: string | undefined;
        let isFirstPage = true;

        do {
          const response = isFirstPage
            ? await calendarClient
                .api(`/me/calendars/${calendarId}/calendarView`)
                .query({ startDateTime, endDateTime })
                .select("subject,start,end,showAs,isAllDay")
                // 以 UTC 请求事件以避免 Windows 时区名称转换问题
                .header("Prefer", 'outlook.timezone="UTC"')
                .get()
            : await calendarClient.api(nextLink!).get();

          isFirstPage = false;

          if (response.value) {
            for (const event of response.value) {
              if (
                event.showAs !== "free" &&
                event.start?.dateTime &&
                event.end?.dateTime
              ) {
                // 使用 Prefer: outlook.timezone="UTC" 时，dateTime 是 UTC 但不带 Z 后缀
                // 我们需要加上它以符合正确的 ISO 8601 格式
                const startDatetime = event.start.dateTime.endsWith("Z")
                  ? event.start.dateTime
                  : `${event.start.dateTime}Z`;
                const endDatetime = event.end.dateTime.endsWith("Z")
                  ? event.end.dateTime
                  : `${event.end.dateTime}Z`;

                allBusyPeriods.push({
                  start: startDatetime,
                  end: endDatetime,
                });
              }
            }
          }

          // 检查下一页
          nextLink = response["@odata.nextLink"];
        } while (nextLink);
      } catch (calendarError) {
        const calendarIsMissing = isMissingCalendarError(calendarError);
        if (calendarIsMissing) {
          logger.warn("跳过不可用的 Microsoft 日历", {
            calendarIdIsPrimary: calendarId === "primary",
          });
        } else {
          logger.error("获取日历事件出错", {
            calendarId,
            error: calendarError,
          });
        }

        if (failOnCalendarError && !calendarIsMissing) throw calendarError;
      }
    }

    return allBusyPeriods;
  } catch (error) {
    logger.error("获取 Microsoft 日历忙碌时段出错", { error });
    throw error;
  }
}

export function createMicrosoftAvailabilityProvider(
  logger: Logger,
): CalendarAvailabilityProvider {
  return {
    name: "microsoft",

    async fetchBusyPeriods({
      accessToken,
      refreshToken,
      expiresAt,
      emailAccountId,
      calendarIds,
      timeMin,
      timeMax,
      failOnCalendarError,
    }) {
      const calendarClient = await getCalendarClientWithRefresh({
        accessToken,
        refreshToken,
        expiresAt,
        emailAccountId,
        logger,
      });

      return await fetchMicrosoftCalendarBusyPeriods({
        calendarClient,
        calendarIds,
        timeMin,
        timeMax,
        logger,
        failOnCalendarError,
      });
    },
  };
}

function isMissingCalendarError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;

  return (
    ("statusCode" in error && error.statusCode === 404) ||
    ("code" in error && error.code === "ErrorItemNotFound")
  );
}
