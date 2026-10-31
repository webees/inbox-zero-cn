import { createHash, randomBytes } from "node:crypto";
import { addMinutes } from "date-fns";
import { getAccountTimezone } from "@/utils/timezone";
import {
  generateBookableSlots,
  validateSelectedSlot,
  type AvailabilityRule,
  type BusyPeriod,
} from "@inboxzero/scheduling";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { getUnifiedCalendarAvailability } from "@/utils/calendar/unified-availability";
import { getCalendarAvailabilityErrorLogContext } from "@/utils/calendar/availability-error";
import { getSlotIntervalMinutes } from "@/utils/booking/policy";
import {
  cancelCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent,
  type CreatedCalendarEvent,
} from "@/utils/calendar/event-writer";
import { BookingStatus } from "@/generated/prisma/enums";
import type { PublicBookingBody } from "@/utils/actions/booking.validation";
import {
  sendBookingCancellationEmails,
  sendBookingConfirmationEmails,
  sendBookingRescheduledEmails,
} from "@/utils/booking/emails";
import { secureCompareBuffers } from "@/utils/crypto-compare";

const MAX_AVAILABILITY_RANGE_MS = 32 * 24 * 60 * 60 * 1000;
const PENDING_BOOKING_TIMEOUT_MS = 15 * 60 * 1000;
const CALENDAR_AVAILABILITY_UNAVAILABLE = "日历可用性暂时不可用";
const INVALID_CANCELLATION_LINK_MESSAGE = "无效的取消链接";
const INVALID_RESCHEDULE_LINK_MESSAGE = "无效的改期链接";
const BOOKING_CANCELED_RETRY_MESSAGE = "预约已取消。请重新提交预约请求。";
const BOOKING_STILL_PROCESSING_MESSAGE = "预约请求仍在处理中";

export async function getPublicBookingLinkMetadata(slug: string) {
  const link = await prisma.bookingLink.findFirst({
    where: { slug, isActive: true },
    select: {
      slug: true,
      title: true,
      description: true,
      durationMinutes: true,
      locationType: true,
      emailAccount: {
        select: { name: true, image: true },
      },
    },
  });

  if (!link) throw new SafeError("未找到预约链接", 404);

  return {
    slug: link.slug,
    title: link.title,
    description: link.description,
    durationMinutes: link.durationMinutes,
    locationType: link.locationType,
    locationValue: null,
    hostName: link.emailAccount.name ?? null,
    hostImage: link.emailAccount.image ?? null,
  };
}

export async function getPublicAvailability({
  slug,
  start,
  end,
  now = new Date(),
  excludeBookingId,
  excludeBusyPeriod,
  logger,
}: {
  slug: string;
  start: Date;
  end: Date;
  now?: Date;
  excludeBookingId?: string;
  excludeBusyPeriod?: { start: Date; end: Date };
  logger: Logger;
}) {
  assertAvailabilityRange(start, end);

  const config = await loadPublicBookingLink(slug);
  const busyPeriods = await getBusyPeriods({
    config,
    start,
    end,
    logger,
    providerFailureMode: "return-null",
    excludeBookingId,
    excludeBusyPeriod,
  });

  if (!busyPeriods) return [];

  return generateBookableSlots({
    now,
    timezone: config.timezone,
    start,
    end,
    rules: config.windows,
    busyPeriods,
    policy: getPolicy(config.link),
  });
}

export async function createPublicBooking({
  input,
  logger,
}: {
  input: PublicBookingBody;
  logger: Logger;
}) {
  const selectedStartTime = new Date(input.startTime);
  if (Number.isNaN(selectedStartTime.getTime())) {
    throw new SafeError("无效的开始时间");
  }

  const config = await loadPublicBookingLink(input.slug);
  const selectedEndTime = addMinutes(
    selectedStartTime,
    config.link.durationMinutes,
  );

  const existingBooking = await findIdempotentBooking({
    bookingLinkId: config.link.id,
    idempotencyToken: input.idempotencyToken,
  });
  if (existingBooking) {
    const result = await resolveExistingIdempotentBooking(existingBooking);
    if (result) return result;
  }

  await assertSlotAvailable({
    config,
    startTime: selectedStartTime,
    endTime: selectedEndTime,
    logger,
  });

  const cancelToken = randomToken();
  let pendingBooking: Awaited<ReturnType<typeof createPendingBooking>>;

  try {
    pendingBooking = await createPendingBooking({
      config,
      input,
      selectedStartTime,
      selectedEndTime,
      cancelToken,
    });
  } catch (error) {
    if (isSlotConflictError(error)) {
      const existing = await findIdempotentBooking({
        bookingLinkId: config.link.id,
        idempotencyToken: input.idempotencyToken,
      });
      const resolved = await resolveExistingIdempotentBooking(existing);
      if (resolved) return resolved;
      throw new SafeError("所选时段不再可用");
    }
    throw error;
  }

  let createdEvent: CreatedCalendarEvent | null = null;
  let confirmedBooking = pendingBooking;

  try {
    createdEvent = await createCalendarEvent({
      emailAccountId: config.link.emailAccountId,
      destinationCalendarId: config.link.destinationCalendarId,
      title: getProviderEventTitle({
        bookingLinkTitle: config.link.title,
        guestName: input.guestName,
        hostName: config.link.emailAccount.name,
      }),
      description: getProviderEventDescription({
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        guestNote: input.guestNote,
        manageUrl: getRescheduleUrl({
          id: pendingBooking.id,
          token: cancelToken,
        }),
      }),
      startTime: selectedStartTime,
      endTime: selectedEndTime,
      timezone: config.timezone,
      attendees: [{ name: input.guestName, email: input.guestEmail }],
      locationType: config.link.locationType,
      locationValue: config.link.locationValue,
      logger,
    });

    confirmedBooking = await prisma.booking.update({
      where: { id: pendingBooking.id },
      data: {
        provider: createdEvent.provider,
        providerConnectionId: createdEvent.providerConnectionId,
        providerCalendarId: createdEvent.providerCalendarId,
        providerEventId: createdEvent.id,
        videoConferenceLink: createdEvent.videoConferenceLink ?? null,
        status: BookingStatus.CONFIRMED,
      },
      include: getBookingHostInclude(),
    });
  } catch (error) {
    const providerEventToCleanup = createdEvent;
    await Promise.allSettled([
      providerEventToCleanup
        ? cancelCalendarEvent({
            emailAccountId: config.link.emailAccountId,
            providerConnectionId: providerEventToCleanup.providerConnectionId,
            providerCalendarId: providerEventToCleanup.providerCalendarId,
            providerEventId: providerEventToCleanup.id,
            logger,
          }).catch((cleanupError) => {
            logger.error("预约出错后清理服务商事件失败", {
              bookingId: pendingBooking.id,
              provider: providerEventToCleanup.provider,
              providerCalendarId: providerEventToCleanup.providerCalendarId,
              providerEventId: providerEventToCleanup.id,
              error: cleanupError,
            });
          })
        : Promise.resolve(),
      // FAILED 状态会从部分 EXCLUDE 约束中移除该预约，
      // 从而释放该时段以便重新预约。
      prisma.booking.update({
        where: { id: pendingBooking.id },
        data: { status: BookingStatus.FAILED },
      }),
    ]);
    logger.error("为预约创建服务商事件失败", {
      bookingId: pendingBooking.id,
      error,
    });
    throw new SafeError("创建日历事件失败");
  }

  const cancelUrl = getCancelUrl({
    id: confirmedBooking.id,
    token: cancelToken,
  });
  const rescheduleUrl = getRescheduleUrl({
    id: confirmedBooking.id,
    token: cancelToken,
  });

  await sendBookingConfirmationEmails({
    booking: confirmedBooking,
    guestTimezone: input.timezone,
    cancelUrl,
    rescheduleUrl,
    logger,
  });

  return {
    ...toPublicBookingResult(confirmedBooking),
    cancelUrl,
    rescheduleUrl,
  };
}

export async function cancelPublicBooking({
  id,
  token,
  reason,
  logger,
}: {
  id: string;
  token: string;
  reason?: string;
  logger: Logger;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: getBookingHostInclude(),
  });

  if (!booking) throw new SafeError(INVALID_CANCELLATION_LINK_MESSAGE, 404);
  if (!isMatchingToken({ token, tokenHash: booking.cancelTokenHash })) {
    throw new SafeError(INVALID_CANCELLATION_LINK_MESSAGE, 404);
  }
  if (booking.status === BookingStatus.CANCELED) {
    throw new SafeError("预约已取消");
  }
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new SafeError("无法取消预约");
  }
  if (booking.startTime <= new Date()) {
    throw new SafeError("已开始的预约无法取消");
  }

  // 以原子的方式完成 CONFIRMED -> CANCELED 状态转换，避免并发的取消请求
  // 都触发服务商取消并给主机发送重复邮件。
  const transition = await prisma.booking.updateMany({
    where: { id: booking.id, status: BookingStatus.CONFIRMED },
    data: {
      status: BookingStatus.CANCELED,
      cancellationReason: reason || null,
    },
  });
  if (transition.count === 0) {
    throw new SafeError("预约已取消");
  }

  if (
    booking.providerConnectionId &&
    booking.providerCalendarId &&
    booking.providerEventId
  ) {
    // 服务商清理是尽力而为：如果主机断开了其
    // 日历、手动删除了事件，或服务商无法访问，
    // 我们仍会在本地将该预约标记为已取消，以免访客卡在
    // 一个已确认却无法取消的预约上。
    try {
      await cancelCalendarEvent({
        emailAccountId: booking.emailAccountId,
        providerConnectionId: booking.providerConnectionId,
        providerCalendarId: booking.providerCalendarId,
        providerEventId: booking.providerEventId,
        logger,
      });
    } catch (error) {
      logger.error("取消预约时取消服务商事件失败", {
        bookingId: booking.id,
        error,
      });
    }
  }

  const canceledBooking = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: getBookingHostInclude(),
  });

  await sendBookingCancellationEmails({
    booking: canceledBooking,
    logger,
  });

  return toPublicBookingResult(canceledBooking);
}

export async function reschedulePublicBooking({
  id,
  token,
  startTime,
  guestTimezone,
  logger,
}: {
  id: string;
  token: string;
  startTime: string;
  guestTimezone: string;
  logger: Logger;
}) {
  const newStartTime = new Date(startTime);
  if (Number.isNaN(newStartTime.getTime())) {
    throw new SafeError("无效的开始时间");
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: getBookingHostInclude(),
  });

  if (!booking) throw new SafeError(INVALID_RESCHEDULE_LINK_MESSAGE, 404);
  if (!isMatchingToken({ token, tokenHash: booking.cancelTokenHash })) {
    throw new SafeError(INVALID_RESCHEDULE_LINK_MESSAGE, 404);
  }
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new SafeError("无法改期预约");
  }
  if (booking.startTime <= new Date()) {
    throw new SafeError("已开始的预约无法改期");
  }

  const config = await loadPublicBookingLink(booking.bookingLink.slug);
  const newEndTime = addMinutes(newStartTime, config.link.durationMinutes);

  if (newStartTime.getTime() === booking.startTime.getTime()) {
    throw new SafeError("请选择其他时间改期");
  }

  await assertSlotAvailable({
    config,
    startTime: newStartTime,
    endTime: newEndTime,
    excludeBookingId: booking.id,
    excludeBusyPeriod: booking.providerEventId
      ? { start: booking.startTime, end: booking.endTime }
      : undefined,
    logger,
  });

  const previousStartTime = booking.startTime;
  const previousEndTime = booking.endTime;

  // 在接触服务商之前先原子地占用新时段。部分
  // EXCLUDE 约束会阻止重叠的 CONFIRMED/PENDING 预约，因此如果
  // 另一个预约占用了该时段，我们就提示「不再可用」。
  try {
    const transition = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        status: BookingStatus.CONFIRMED,
        startTime: previousStartTime,
        endTime: previousEndTime,
      },
      data: { startTime: newStartTime, endTime: newEndTime },
    });
    if (transition.count === 0) {
      throw new SafeError("无法改期预约");
    }
  } catch (error) {
    if (isSlotConflictError(error)) {
      throw new SafeError("所选时段不再可用");
    }
    throw error;
  }

  if (
    booking.providerConnectionId &&
    booking.providerCalendarId &&
    booking.providerEventId
  ) {
    try {
      await updateCalendarEvent({
        emailAccountId: booking.emailAccountId,
        providerConnectionId: booking.providerConnectionId,
        providerCalendarId: booking.providerCalendarId,
        providerEventId: booking.providerEventId,
        startTime: newStartTime,
        endTime: newEndTime,
        timezone: getAccountTimezone(booking.bookingLink.emailAccount.timezone),
        logger,
      });
    } catch (error) {
      logger.error("改期时更新服务商事件失败", {
        bookingId: booking.id,
        error,
      });
      // 回滚本地的时段占用，以免出现一个
      // 与主机日历不一致的预约。
      try {
        const rollback = await prisma.booking.updateMany({
          where: {
            id: booking.id,
            startTime: newStartTime,
            endTime: newEndTime,
          },
          data: { startTime: previousStartTime, endTime: previousEndTime },
        });
        if (rollback.count === 0) {
          logger.error("回滚改期时段占用失败", {
            bookingId: booking.id,
            reason: "没有匹配的预约状态",
          });
        }
      } catch (rollbackError) {
        logger.error("回滚改期时段占用失败", {
          bookingId: booking.id,
          error: rollbackError,
        });
      }
      throw new SafeError("更新日历事件失败");
    }
  }

  const rescheduledBooking = {
    ...booking,
    startTime: newStartTime,
    endTime: newEndTime,
  };

  const cancelUrl = getCancelUrl({ id: booking.id, token });
  const rescheduleUrl = getRescheduleUrl({ id: booking.id, token });

  await sendBookingRescheduledEmails({
    booking: rescheduledBooking,
    previousStartTime,
    guestTimezone,
    cancelUrl,
    rescheduleUrl,
    logger,
  });

  return {
    ...toPublicBookingResult(rescheduledBooking),
    cancelUrl,
    rescheduleUrl,
  };
}

export async function getPublicBookingForManagement({
  id,
  token,
}: {
  id: string;
  token: string;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      cancelTokenHash: true,
      startTime: true,
      endTime: true,
      status: true,
      guestName: true,
      bookingLink: {
        select: {
          slug: true,
          title: true,
          description: true,
          durationMinutes: true,
          slotIntervalMinutes: true,
          locationType: true,
          locationValue: true,
          emailAccount: {
            select: { name: true, image: true },
          },
        },
      },
    },
  });

  if (!isManageableBooking(booking, token)) return null;

  return {
    id: booking.id,
    status: booking.status,
    guestName: booking.guestName,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    bookingLink: {
      slug: booking.bookingLink.slug,
      title: booking.bookingLink.title,
      description: booking.bookingLink.description,
      durationMinutes: booking.bookingLink.durationMinutes,
      slotIntervalMinutes: booking.bookingLink.slotIntervalMinutes,
      locationType: booking.bookingLink.locationType,
      locationValue: booking.bookingLink.locationValue,
      hostName: booking.bookingLink.emailAccount.name ?? null,
      hostImage: booking.bookingLink.emailAccount.image ?? null,
    },
  };
}

export async function getPublicBookingAvailabilityExclusion({
  id,
  token,
}: {
  id: string;
  token: string;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      cancelTokenHash: true,
      status: true,
      startTime: true,
      endTime: true,
      providerEventId: true,
      bookingLink: {
        select: { slug: true },
      },
    },
  });

  if (!isManageableBooking(booking, token)) return null;

  return {
    id: booking.id,
    bookingLinkSlug: booking.bookingLink.slug,
    providerBusyPeriod: booking.providerEventId
      ? { start: booking.startTime, end: booking.endTime }
      : undefined,
  };
}

function getBookingHostInclude() {
  return {
    bookingLink: {
      select: {
        slug: true,
        title: true,
        locationType: true,
        locationValue: true,
        emailAccount: {
          select: { email: true, name: true, timezone: true },
        },
      },
    },
  } as const;
}

async function loadPublicBookingLink(slug: string) {
  const link = await prisma.bookingLink.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      durationMinutes: true,
      locationType: true,
      locationValue: true,
      minimumNoticeMinutes: true,
      maxDaysAhead: true,
      emailAccountId: true,
      destinationCalendarId: true,
      availabilitySchedule: {
        select: {
          windows: {
            select: {
              weekday: true,
              startMinutes: true,
              endMinutes: true,
            },
          },
        },
      },
      emailAccount: {
        select: {
          name: true,
          timezone: true,
          calendarConnections: {
            where: { isConnected: true },
            select: {
              id: true,
              calendars: {
                where: { isEnabled: true },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!link) throw new SafeError("未找到预约链接", 404);

  const enabledCalendarIds = link.emailAccount.calendarConnections.flatMap(
    (connection) => connection.calendars.map((calendar) => calendar.id),
  );
  if (enabledCalendarIds.length === 0) {
    throw new SafeError("此主机没有可用的已启用日历");
  }
  // 可用性会为任何已启用的日历生成，但预约会
  // 写入链接的 destinationCalendarId。如果该特定日历
  // 被禁用或断开，就提前失败，以免访客填写完表单后
  // 在提交时又遇到一个笼统的「Destination calendar not found」。
  if (
    link.destinationCalendarId &&
    !enabledCalendarIds.includes(link.destinationCalendarId)
  ) {
    throw new SafeError("此主机没有可用的已启用日历");
  }

  return {
    link,
    timezone: getAccountTimezone(link.emailAccount.timezone),
    windows: link.availabilitySchedule.windows.map((window) => ({
      weekday: window.weekday,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
    })) satisfies AvailabilityRule[],
  };
}

async function assertSlotAvailable({
  config,
  startTime,
  endTime,
  excludeBookingId,
  excludeBusyPeriod,
  logger,
}: {
  config: Awaited<ReturnType<typeof loadPublicBookingLink>>;
  startTime: Date;
  endTime: Date;
  excludeBookingId?: string;
  excludeBusyPeriod?: { start: Date; end: Date };
  logger: Logger;
}) {
  const busyPeriods = await getBusyPeriods({
    config,
    start: startTime,
    end: endTime,
    logger,
    providerFailureMode: "throw-safe-error",
    excludeBookingId,
    excludeBusyPeriod,
  });

  if (!busyPeriods) throw new SafeError(CALENDAR_AVAILABILITY_UNAVAILABLE);

  const slotValidation = validateSelectedSlot({
    now: new Date(),
    timezone: config.timezone,
    start: startTime,
    end: endTime,
    selectedStartTime: startTime,
    rules: config.windows,
    busyPeriods,
    policy: getPolicy(config.link),
  });

  if (!slotValidation.valid) {
    throw new SafeError(slotValidation.reason);
  }
}

async function getBusyPeriods({
  config,
  start,
  end,
  logger,
  providerFailureMode,
  excludeBookingId,
  excludeBusyPeriod,
}: {
  config: Awaited<ReturnType<typeof loadPublicBookingLink>>;
  start: Date;
  end: Date;
  logger: Logger;
  providerFailureMode: "return-null" | "throw-safe-error";
  excludeBookingId?: string;
  excludeBusyPeriod?: { start: Date; end: Date };
}): Promise<BusyPeriod[] | null> {
  const [providerBusyPeriods, existingBookings] = await Promise.all([
    getUnifiedCalendarAvailability({
      emailAccountId: config.link.emailAccountId,
      startDate: start,
      endDate: end,
      timezone: config.timezone,
      logger,
      failClosed: true,
      excludeGoogleVirtualCalendars: true,
    }).catch((error) => {
      logger.error("加载公开预约的服务商可用性失败", {
        error,
        ...getCalendarAvailabilityErrorLogContext(error),
      });

      if (providerFailureMode === "return-null") return null;

      throw new SafeError(CALENDAR_AVAILABILITY_UNAVAILABLE);
    }),
    // 进行中的预约尚未同步到日历，但已经
    // 通过部分 EXCLUDE 约束占用了该时段，因此将其显示为忙碌。
    prisma.booking
      .findMany({
        where: {
          emailAccountId: config.link.emailAccountId,
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
          status: {
            in: [BookingStatus.PENDING_PROVIDER_EVENT, BookingStatus.CONFIRMED],
          },
          startTime: { lt: end },
          endTime: { gt: start },
        },
        select: {
          startTime: true,
          endTime: true,
          status: true,
        },
      })
      .catch((error) => {
        logger.error("加载公开预约的现有预约失败", {
          error,
        });

        if (providerFailureMode === "return-null") return null;

        throw new SafeError(CALENDAR_AVAILABILITY_UNAVAILABLE);
      }),
  ]);

  if (!providerBusyPeriods || !existingBookings) return null;
  const filteredProviderBusyPeriods = excludeBusyPeriod
    ? providerBusyPeriods.filter(
        (busyPeriod) => !isSameBusyPeriod(busyPeriod, excludeBusyPeriod),
      )
    : providerBusyPeriods;

  return [
    ...filteredProviderBusyPeriods,
    ...existingBookings
      .filter((booking) => isBlockingBooking(booking))
      .map((booking) => ({
        start: booking.startTime,
        end: booking.endTime,
      })),
  ];
}

function getPolicy(link: {
  durationMinutes: number;
  minimumNoticeMinutes: number;
  maxDaysAhead: number;
}) {
  return {
    durationMinutes: link.durationMinutes,
    slotIntervalMinutes: getSlotIntervalMinutes(link.durationMinutes),
    minimumNoticeMinutes: link.minimumNoticeMinutes,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    bookingWindowDays: link.maxDaysAhead,
  };
}

function isSlotConflictError(error: unknown) {
  if (isDuplicateError(error)) return true;
  // Postgres 排他约束冲突（SQL 状态 23P01）不会以
  // P2002 的形式暴露；Prisma 会在错误消息中包含该 SQL 状态。
  return error instanceof Error && error.message.includes("23P01");
}

async function createPendingBooking({
  config,
  input,
  selectedStartTime,
  selectedEndTime,
  cancelToken,
}: {
  config: Awaited<ReturnType<typeof loadPublicBookingLink>>;
  input: PublicBookingBody;
  selectedStartTime: Date;
  selectedEndTime: Date;
  cancelToken: string;
}) {
  return prisma.booking.create({
    data: {
      bookingLinkId: config.link.id,
      emailAccountId: config.link.emailAccountId,
      guestName: input.guestName,
      guestEmail: input.guestEmail.toLowerCase(),
      guestNote: input.guestNote,
      startTime: selectedStartTime,
      endTime: selectedEndTime,
      status: BookingStatus.PENDING_PROVIDER_EVENT,
      cancelTokenHash: hashToken(cancelToken),
      idempotencyToken: input.idempotencyToken,
    },
    include: getBookingHostInclude(),
  });
}

async function findIdempotentBooking({
  bookingLinkId,
  idempotencyToken,
}: {
  bookingLinkId: string;
  idempotencyToken: string;
}) {
  return prisma.booking.findFirst({
    where: { bookingLinkId, idempotencyToken },
    include: getBookingHostInclude(),
  });
}

async function resolveExistingIdempotentBooking(
  booking: Awaited<ReturnType<typeof findIdempotentBooking>>,
) {
  if (!booking) return null;

  if (booking.status === BookingStatus.CONFIRMED) {
    return toPublicBookingResult(booking);
  }

  if (booking.status === BookingStatus.FAILED) {
    await prisma.booking.delete({ where: { id: booking.id } });
    return null;
  }

  if (
    booking.status === BookingStatus.PENDING_PROVIDER_EVENT &&
    isStalePendingBooking(booking)
  ) {
    await prisma.booking.delete({ where: { id: booking.id } });
    return null;
  }

  if (booking.status === BookingStatus.CANCELED) {
    throw new SafeError(BOOKING_CANCELED_RETRY_MESSAGE);
  }

  throw new SafeError(BOOKING_STILL_PROCESSING_MESSAGE);
}

function getProviderEventDescription({
  guestName,
  guestEmail,
  guestNote,
  manageUrl,
}: {
  guestName: string;
  guestEmail: string;
  guestNote?: string;
  manageUrl: string;
}) {
  return [
    `预订人：${cleanCalendarDescriptionText(guestName)}`,
    `来宾邮箱：${cleanCalendarDescriptionText(guestEmail)}`,
    guestNote ? `来宾备注：${cleanCalendarDescriptionText(guestNote)}` : null,
    "",
    `需要改期或取消？${manageUrl}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function getProviderEventTitle({
  bookingLinkTitle,
  guestName,
  hostName,
}: {
  bookingLinkTitle: string;
  guestName: string;
  hostName: string | null;
}) {
  const title = cleanCalendarTitleText(bookingLinkTitle) || "会议";
  const host = hostName ? cleanCalendarTitleText(hostName) : "";
  const guest = cleanCalendarTitleText(guestName);
  const participant = guest || host;
  const participants = host && guest ? `（${host} 与 ${guest}）` : "";
  const fallbackParticipant = participant ? `（与 ${participant}）` : "";

  return `${title}${participants || fallbackParticipant}`;
}

function cleanCalendarTitleText(value: string) {
  return cleanCalendarDescriptionText(value).replace(/\s+/g, " ").trim();
}

function cleanCalendarDescriptionText(value: string) {
  return value
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
}

function toPublicBookingResult(booking: {
  endTime: Date;
  id: string;
  startTime: Date;
  status: BookingStatus;
}) {
  return {
    id: booking.id,
    status: booking.status,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
  };
}

function isBlockingBooking(booking: { status: BookingStatus }) {
  return (
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.PENDING_PROVIDER_EVENT
  );
}

function isSameBusyPeriod(
  busyPeriod: BusyPeriod,
  excluded: { start: Date; end: Date },
) {
  return (
    new Date(busyPeriod.start).getTime() === excluded.start.getTime() &&
    new Date(busyPeriod.end).getTime() === excluded.end.getTime()
  );
}

function isStalePendingBooking(booking: {
  createdAt: Date;
  status: BookingStatus;
}) {
  return (
    booking.status === BookingStatus.PENDING_PROVIDER_EVENT &&
    Date.now() - booking.createdAt.getTime() > PENDING_BOOKING_TIMEOUT_MS
  );
}

function assertAvailabilityRange(start: Date, end: Date) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new SafeError("无效的日期范围");
  }
  if (end <= start) throw new SafeError("无效的日期范围");
  if (end.getTime() - start.getTime() > MAX_AVAILABILITY_RANGE_MS) {
    throw new SafeError("可用时间范围不得超过 32 天");
  }
}

function randomToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isMatchingToken({
  token,
  tokenHash,
}: {
  token: string;
  tokenHash: string;
}) {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  return secureCompareBuffers(actual, expected);
}

type ManageableBooking = {
  cancelTokenHash: string;
  status: BookingStatus;
  startTime: Date;
};

function isManageableBooking<Booking extends ManageableBooking>(
  booking: Booking | null,
  token: string,
): booking is Booking {
  if (!booking) return false;
  if (!isMatchingToken({ token, tokenHash: booking.cancelTokenHash })) {
    return false;
  }
  if (booking.status !== BookingStatus.CONFIRMED) return false;
  if (booking.startTime <= new Date()) return false;
  return true;
}

function getCancelUrl({ id, token }: { id: string; token: string }) {
  return `${env.NEXT_PUBLIC_BASE_URL}/book/cancel/${id}?token=${encodeURIComponent(
    token,
  )}`;
}

function getRescheduleUrl({ id, token }: { id: string; token: string }) {
  return `${env.NEXT_PUBLIC_BASE_URL}/book/reschedule/${id}?token=${encodeURIComponent(
    token,
  )}`;
}
