import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";

/**
 * 如果尚未设置，则从日历自动填充 EmailAccount 时区
 */
export async function autoPopulateTimezone(
  emailAccountId: string,
  calendars: Array<{
    timeZone?: string | null;
    primary?: boolean | null;
    isDefaultCalendar?: boolean | null;
  }>,
  logger: Logger,
): Promise<void> {
  // 先尝试主日历（Google 使用 'primary'，Microsoft 使用 'isDefaultCalendar'）
  const primaryCalendar = calendars.find(
    (cal) => cal.primary || cal.isDefaultCalendar,
  );
  const timezoneToSet = primaryCalendar?.timeZone || calendars[0]?.timeZone;

  if (!timezoneToSet) return;

  const result = await prisma.emailAccount.updateMany({
    where: { id: emailAccountId, timezone: null },
    data: { timezone: timezoneToSet },
  });

  if (result.count === 0) return;

  logger.info("已自动填充 EmailAccount 时区", {
    emailAccountId,
    timezone: timezoneToSet,
  });
}
