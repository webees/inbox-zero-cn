import { z } from "zod";

export const updateMeetingBriefsEnabledBody = z.object({
  enabled: z.boolean(),
});

export type UpdateMeetingBriefsEnabledBody = z.infer<
  typeof updateMeetingBriefsEnabledBody
>;

export const updateMeetingBriefsMinutesBeforeBody = z.object({
  minutesBefore: z
    .number()
    .min(1, "数值至少为 1 分钟")
    .max(2880, "数值最多为 2880 分钟（48 小时）"),
});

export type UpdateMeetingBriefsMinutesBeforeBody = z.infer<
  typeof updateMeetingBriefsMinutesBeforeBody
>;

const attendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

export const sendDebugBriefBody = z.object({
  event: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    eventUrl: z.string().optional(),
    videoConferenceLink: z.string().optional(),
    startTime: z.string(),
    endTime: z.string(),
    attendees: z.array(attendeeSchema),
  }),
});

export type SendDebugBriefBody = z.infer<typeof sendDebugBriefBody>;
