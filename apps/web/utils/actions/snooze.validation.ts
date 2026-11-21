import { z } from "zod";

const MIN_SNOOZE_DELAY_MS = 60_000;

export const snoozeThreadsBody = z.object({
  threadIds: z.array(z.string().min(1).max(512)).min(1).max(100),
  snoozedUntil: z.coerce
    .date()
    .refine((date) => date.getTime() >= Date.now() + MIN_SNOOZE_DELAY_MS, {
      message: "稍后提醒时间必须至少是未来一分钟后",
    }),
});
