import { SafeError } from "@/utils/error";
import type { PublicBookingBody } from "@/utils/actions/booking.validation";
import {
  checkRateLimit,
  createRateLimitKey,
  hashRateLimitValue,
} from "@/utils/rate-limit";
import type { Logger } from "@/utils/logger";

type EnforceableRule = {
  id: string;
  key: string;
  limit: number;
  windowSeconds: number;
};

// 串行执行检查：一旦某个规则限流，跳过其余规则可避免
// 在我们已在拒绝的请求上递增后续窗口。
async function enforceRateLimitRules({
  rules,
  logger,
  warnMessage,
  limitedMessage,
}: {
  rules: EnforceableRule[];
  logger: Logger;
  warnMessage: string;
  limitedMessage: string;
}) {
  for (const rule of rules) {
    const result = await checkRateLimit({ rule, logger });
    if (result.limited) {
      logger.warn(warnMessage, {
        rateLimitId: rule.id,
        limit: result.limit,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      throw new SafeError(limitedMessage, 429);
    }
  }
}

const PUBLIC_BOOKING_RATE_LIMITS = {
  ipLinkBurst: { limit: 8, windowSeconds: 10 * 60 },
  ipLinkDaily: { limit: 30, windowSeconds: 24 * 60 * 60 },
  guestLinkDaily: { limit: 5, windowSeconds: 24 * 60 * 60 },
  linkHourly: { limit: 50, windowSeconds: 60 * 60 },
  linkDaily: { limit: 200, windowSeconds: 24 * 60 * 60 },
} as const;

const PUBLIC_BOOKING_MANAGE_RATE_LIMITS = {
  ipBookingBurst: { limit: 10, windowSeconds: 10 * 60 },
  ipBookingDaily: { limit: 50, windowSeconds: 24 * 60 * 60 },
  bookingHourly: { limit: 20, windowSeconds: 60 * 60 },
} as const;

const PUBLIC_AVAILABILITY_RATE_LIMITS = {
  ipLinkBurst: { limit: 30, windowSeconds: 10 * 60 },
  ipLinkDaily: { limit: 300, windowSeconds: 24 * 60 * 60 },
  linkHourly: { limit: 600, windowSeconds: 60 * 60 },
} as const;

export async function enforcePublicBookingRateLimit({
  input,
  clientIp,
  logger,
}: {
  input: PublicBookingBody;
  clientIp: string;
  logger: Logger;
}) {
  const linkKey = input.slug;
  const ipHash = hashRateLimitValue(clientIp);
  const guestEmailHash = hashRateLimitValue(input.guestEmail.toLowerCase());
  const rules = [
    {
      id: "ip-link-burst",
      key: createRateLimitKey([
        "rate-limit",
        "public-booking",
        "ip-link-burst",
        linkKey,
        ipHash,
      ]),
      ...PUBLIC_BOOKING_RATE_LIMITS.ipLinkBurst,
    },
    {
      id: "ip-link-daily",
      key: createRateLimitKey([
        "rate-limit",
        "public-booking",
        "ip-link-daily",
        linkKey,
        ipHash,
      ]),
      ...PUBLIC_BOOKING_RATE_LIMITS.ipLinkDaily,
    },
    {
      id: "guest-link-daily",
      key: createRateLimitKey([
        "rate-limit",
        "public-booking",
        "guest-link-daily",
        linkKey,
        guestEmailHash,
      ]),
      ...PUBLIC_BOOKING_RATE_LIMITS.guestLinkDaily,
    },
    {
      id: "link-hourly",
      key: createRateLimitKey([
        "rate-limit",
        "public-booking",
        "link-hourly",
        linkKey,
      ]),
      ...PUBLIC_BOOKING_RATE_LIMITS.linkHourly,
    },
    {
      id: "link-daily",
      key: createRateLimitKey([
        "rate-limit",
        "public-booking",
        "link-daily",
        linkKey,
      ]),
      ...PUBLIC_BOOKING_RATE_LIMITS.linkDaily,
    },
  ];

  await enforceRateLimitRules({
    rules,
    logger,
    warnMessage: "公开预约速率限制已超出",
    limitedMessage: "预约尝试过于频繁。请稍后再试。",
  });
}

export async function enforcePublicAvailabilityRateLimit({
  slug,
  clientIp,
  logger,
}: {
  slug: string;
  clientIp: string;
  logger: Logger;
}) {
  const linkKey = slug;
  const ipHash = hashRateLimitValue(clientIp);
  const rules = [
    {
      id: "availability-ip-link-burst",
      key: createRateLimitKey([
        "rate-limit",
        "public-availability",
        "ip-link-burst",
        linkKey,
        ipHash,
      ]),
      ...PUBLIC_AVAILABILITY_RATE_LIMITS.ipLinkBurst,
    },
    {
      id: "availability-ip-link-daily",
      key: createRateLimitKey([
        "rate-limit",
        "public-availability",
        "ip-link-daily",
        linkKey,
        ipHash,
      ]),
      ...PUBLIC_AVAILABILITY_RATE_LIMITS.ipLinkDaily,
    },
    {
      id: "availability-link-hourly",
      key: createRateLimitKey([
        "rate-limit",
        "public-availability",
        "link-hourly",
        linkKey,
      ]),
      ...PUBLIC_AVAILABILITY_RATE_LIMITS.linkHourly,
    },
  ];

  await enforceRateLimitRules({
    rules,
    logger,
    warnMessage: "公开预约可用性速率限制已超出",
    limitedMessage: "可用性查询过于频繁。请稍后再试。",
  });
}

type PublicBookingManageAction = "cancel" | "reschedule";

const MANAGE_ACTION_COPY: Record<
  PublicBookingManageAction,
  { warnMessage: string; limitedMessage: string }
> = {
  cancel: {
    warnMessage: "公开预约取消速率限制已超出",
    limitedMessage: "取消尝试过于频繁。请稍后再试。",
  },
  reschedule: {
    warnMessage: "公开预约改期速率限制已超出",
    limitedMessage: "改期尝试过于频繁。请稍后再试。",
  },
};

async function enforcePublicBookingManageRateLimit({
  action,
  bookingId,
  clientIp,
  logger,
}: {
  action: PublicBookingManageAction;
  bookingId: string;
  clientIp: string;
  logger: Logger;
}) {
  const namespace = `public-booking-${action}`;
  const bookingKey = hashRateLimitValue(bookingId);
  const ipHash = hashRateLimitValue(clientIp);
  const rules = [
    {
      id: `ip-booking-${action}-burst`,
      key: createRateLimitKey([
        "rate-limit",
        namespace,
        "ip-booking-burst",
        bookingKey,
        ipHash,
      ]),
      ...PUBLIC_BOOKING_MANAGE_RATE_LIMITS.ipBookingBurst,
    },
    {
      id: `ip-booking-${action}-daily`,
      key: createRateLimitKey([
        "rate-limit",
        namespace,
        "ip-booking-daily",
        bookingKey,
        ipHash,
      ]),
      ...PUBLIC_BOOKING_MANAGE_RATE_LIMITS.ipBookingDaily,
    },
    {
      id: `booking-${action}-hourly`,
      key: createRateLimitKey([
        "rate-limit",
        namespace,
        "booking-hourly",
        bookingKey,
      ]),
      ...PUBLIC_BOOKING_MANAGE_RATE_LIMITS.bookingHourly,
    },
  ];

  await enforceRateLimitRules({
    rules,
    logger,
    ...MANAGE_ACTION_COPY[action],
  });
}

export function enforcePublicBookingCancelRateLimit(args: {
  bookingId: string;
  clientIp: string;
  logger: Logger;
}) {
  return enforcePublicBookingManageRateLimit({ action: "cancel", ...args });
}

export function enforcePublicBookingRescheduleRateLimit(args: {
  bookingId: string;
  clientIp: string;
  logger: Logger;
}) {
  return enforcePublicBookingManageRateLimit({ action: "reschedule", ...args });
}
