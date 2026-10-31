import { createCalendarEventProviders } from "@/utils/calendar/event-provider";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";

export interface CalendarEventsInWindow {
  /**
   * 当服务商出错或达到结果上限时为 false，因此事件列表
   * 只是日历上真实内容的一部分。通过缺失推断删除的
   * 调用方不得对不完整的列表采取行动。
   */
  complete: boolean;
  events: CalendarEvent[];
}

/**
 * 从时间窗口内的每个已连接日历获取事件，合并并按开始
 * 时间排序。失败的服务商会被跳过，而不是让整个获取失败，
 * 因为大多数账号只有一个日历，部分结果总比没有好。
 */
export async function fetchCalendarEventsInWindow({
  emailAccountId,
  timeMin,
  timeMax,
  maxResultsPerProvider,
  logger,
}: {
  emailAccountId: string;
  timeMin: Date;
  timeMax: Date;
  maxResultsPerProvider: number;
  logger: Logger;
}): Promise<CalendarEventsInWindow> {
  logger.info("开始获取日历事件时间窗口");
  const providers = await createCalendarEventProviders(emailAccountId, logger);
  logger.info("已创建日历事件提供程序", {
    providerCount: providers.length,
  });
  // 零个服务商绝不能证明日历为空：连接在其刷新令牌
  // 丢失或构建失败时会被静默跳过，而同步错误可能已将其
  // 翻转为断开连接。此处报告完整会让调用方将每个已预订的
  // 会议都视为已删除。
  if (providers.length === 0) {
    logger.info("完成日历事件时间窗口获取", {
      complete: false,
      eventCount: 0,
      failedProviders: 0,
      providerCount: 0,
    });
    return { events: [], complete: false };
  }

  const connectedCalendars = await prisma.calendarConnection.count({
    where: { emailAccountId, isConnected: true },
  });
  logger.info("已统计连接的日历", { connectedCalendars });

  const results = await Promise.allSettled(
    providers.map(async (provider, providerIndex) => {
      const providerLogger = logger.with({
        calendarProviderIndex: providerIndex,
      });
      providerLogger.info("开始获取日历服务商事件");

      try {
        const events = await provider.fetchEvents({
          timeMin,
          timeMax,
          maxResults: maxResultsPerProvider,
        });

        providerLogger.info("完成日历服务商事件获取", {
          eventCount: events.length,
        });
        return events;
      } catch (error) {
        providerLogger.error("获取日历服务商事件失败", {
          error,
        });
        throw error;
      }
    }),
  );

  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<CalendarEvent[]> =>
      result.status === "fulfilled",
  );

  const failedProviders = results.length - fulfilled.length;
  if (failedProviders > 0) {
    logger.warn("日历获取返回了部分结果", {
      failedProviders,
      totalProviders: results.length,
    });
  }

  // 填满一页的服务商在它之后可能还有更多。
  const truncated = fulfilled.some(
    (result) => result.value.length >= maxResultsPerProvider,
  );

  const events = fulfilled
    .flatMap((result) => result.value)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const filteredEvents = events.filter(
    (event) => !isCancelledEventTitle(event.title),
  );
  const skippedCancelledEvents = events.length - filteredEvents.length;

  if (skippedCancelledEvents > 0) {
    logger.info("跳过已取消的日历事件", {
      count: skippedCancelledEvents,
    });
  }

  // 从未成为服务商的连接与出错的服务商一样是盲点，
  // 因此相对于已连接日历的任何缺口都会
  // 将获取标记为不完整。
  const complete =
    failedProviders === 0 &&
    !truncated &&
    providers.length >= connectedCalendars;

  logger.info("完成日历事件时间窗口获取", {
    complete,
    eventCount: filteredEvents.length,
    failedProviders,
    providerCount: providers.length,
  });

  return { events: filteredEvents, complete };
}

// 某些客户端会以改名的标题将已取消的事件保留在日历上，
// 而不是删除它。
function isCancelledEventTitle(title: string): boolean {
  return /^\s*(?:cancelled|canceled)(?:\s+event)?\s*:/i.test(title);
}
