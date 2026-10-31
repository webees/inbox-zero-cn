import { z } from "zod";
import { MeetingJoinRule } from "@/generated/prisma/enums";

export const updateMeetingRecorderSettingsBody = z.object({
  enabled: z.boolean().optional(),
  joinRule: z.nativeEnum(MeetingJoinRule).optional(),
  recapEmailEnabled: z.boolean().optional(),
  followUpDraftEnabled: z.boolean().optional(),
});

export type UpdateMeetingRecorderSettingsBody = z.infer<
  typeof updateMeetingRecorderSettingsBody
>;

// 只接受事件 id。事件本身会从该账号自己的日历中重新读取，
// 因此调用方无法把记录助手指向他们从未受邀参加的会议，
// 也无法把自己附加到其他人的录制上。
export const setMeetingJoinOverrideBody = z.object({
  calendarEventId: z.string(),
  join: z.boolean(),
});

export const deleteMeetingNotesBody = z.object({
  meetingId: z.string(),
});
