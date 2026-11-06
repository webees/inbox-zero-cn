import { MeetingJoinRule } from "@/generated/prisma/enums";
import type { CalendarEvent } from "@/utils/calendar/event-types";
import { partitionAttendeesForBriefing } from "@/utils/meeting-briefs/attendees";

/**
 * 记录助手是否加入会议的唯一事实来源。reconciler 和
 * upcoming-meetings API 都调用它，因此用户看到的开关
 * 始终与 cron 实际行为一致。
 */
export function shouldAutoJoin({
  event,
  rule,
  userEmail,
  joinOverride,
}: {
  event: CalendarEvent;
  rule: MeetingJoinRule;
  userEmail: string;
  joinOverride?: boolean | null;
}): boolean {
  // 针对单场会议的覆盖始终优先，包括在规则为关闭（OFF）时
  // 将某场会议开启。
  if (joinOverride != null) return joinOverride;

  if (!event.videoConferenceLink) return false;

  switch (rule) {
    case MeetingJoinRule.ALL:
      return true;
    case MeetingJoinRule.EXTERNAL_ONLY:
      return (
        partitionAttendeesForBriefing(event, userEmail).external.length > 0
      );
    case MeetingJoinRule.HOST_ONLY:
      return isHost({ event, userEmail });
    case MeetingJoinRule.OFF:
      return false;
  }
}

// `isOrganizer` 是相对于所连接日历而言的，该地址可能与邮箱账号
// 不同，因此回退到比较组织者邮箱。
function isHost({
  event,
  userEmail,
}: {
  event: CalendarEvent;
  userEmail: string;
}): boolean {
  if (event.isOrganizer === true) return true;

  const organizerEmail = event.organizerEmail?.trim().toLowerCase();
  return !!organizerEmail && organizerEmail === userEmail.trim().toLowerCase();
}
