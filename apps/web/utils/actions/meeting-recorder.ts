"use server";

import { addHours } from "date-fns/addHours";
import { differenceInMinutes } from "date-fns/differenceInMinutes";
import { Prisma } from "@/generated/prisma/client";
import { MeetingJoinRule } from "@/generated/prisma/enums";
import { actionClient } from "@/utils/actions/safe-action";
import {
  deleteMeetingNotesBody,
  setMeetingJoinOverrideBody,
  updateMeetingRecorderSettingsBody,
} from "@/utils/actions/meeting-recorder.validation";
import { fetchCalendarEventsInWindow } from "@/utils/calendar/fetch-events-in-window";
import { SafeError } from "@/utils/error";
import {
  MAX_EVENTS_PER_PROVIDER,
  MEETING_LOOKAHEAD_HOURS,
  MEETING_RECORDER_MIN_TIER,
  RECONCILE_WINDOW_MINUTES,
} from "@/utils/meeting-recorder/config";
import { checkHasAccess } from "@/utils/premium/server";
import {
  reconcileSingleEvent,
  releaseAccountBookings,
  releaseAutomaticAccountBookings,
  releaseMeetingBooking,
  upsertMeeting,
} from "@/utils/meeting-recorder/reconcile";
import prisma from "@/utils/prisma";

export const deleteMeetingNotesAction = actionClient
  .metadata({ name: "deleteMeetingNotes" })
  .inputSchema(deleteMeetingNotesBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { meetingId } }) => {
    const meeting = await prisma.meeting.findFirst({
      where: {
        id: meetingId,
        emailAccountId,
        recording: { emailAccountId },
      },
      select: { recordingId: true },
    });
    if (!meeting?.recordingId) throw new SafeError("未找到会议");

    await prisma.$transaction([
      prisma.meeting.update({
        where: {
          id: meetingId,
          emailAccountId,
          recordingId: meeting.recordingId,
        },
        data: { recordingId: null, summary: Prisma.DbNull },
      }),
      prisma.meetingRecording.delete({
        where: { id: meeting.recordingId },
      }),
    ]);
  });

export const updateMeetingRecorderSettingsAction = actionClient
  .metadata({ name: "updateMeetingRecorderSettings" })
  .inputSchema(updateMeetingRecorderSettingsBody)
  .action(async ({ ctx: { emailAccountId, userId, logger }, parsedInput }) => {
    if (parsedInput.enabled === true) {
      const hasAccess = await checkHasAccess({
        userId,
        minimumTier: MEETING_RECORDER_MIN_TIER,
      });
      if (!hasAccess) {
        throw new SafeError("你的套餐不包含记录助手");
      }
    }

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: {
        meetingRecorderEnabled: parsedInput.enabled,
        meetingRecorderJoinRule: parsedInput.joinRule,
        meetingRecorderRecapEmailEnabled: parsedInput.recapEmailEnabled,
        meetingRecorderFollowUpDraftEnabled: parsedInput.followUpDraftEnabled,
      },
    });

    // 关闭记录助手也会将此账号从定时任务查询中移除，
    // 因此没有其他机制会取消它已预约的机器人。
    if (parsedInput.enabled === false) {
      await releaseAccountBookings({ emailAccountId, logger });
    } else if (parsedInput.joinRule === MeetingJoinRule.OFF) {
      await releaseAutomaticAccountBookings({ emailAccountId, logger });
    }
  });

export const setMeetingJoinOverrideAction = actionClient
  .metadata({ name: "setMeetingJoinOverride" })
  .inputSchema(setMeetingJoinOverrideBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { join, calendarEventId },
    }) => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          id: true,
          email: true,
          name: true,
          userId: true,
          meetingRecorderEnabled: true,
          meetingRecorderJoinRule: true,
        },
      });
      if (!emailAccount) throw new SafeError("未找到邮箱账号");
      if (!emailAccount.meetingRecorderEnabled) {
        throw new SafeError("此账号的记录助手已关闭");
      }

      if (
        !join &&
        (await releaseMeetingBooking({
          emailAccountId,
          calendarEventId,
          logger,
        }))
      ) {
        return;
      }

      if (join) {
        // 定时任务在预约前会按付费档位过滤，而此路径也会预约，
        // 因此必须应用相同的权限。降级后
        // 必须仍能关闭会议记录。
        const hasAccess = await checkHasAccess({
          userId: emailAccount.userId,
          minimumTier: MEETING_RECORDER_MIN_TIER,
        });
        if (!hasAccess) {
          throw new SafeError("你的套餐不包含记录助手");
        }
      }

      const timeMin = new Date();
      const { events } = await fetchCalendarEventsInWindow({
        emailAccountId,
        timeMin,
        timeMax: addHours(timeMin, MEETING_LOOKAHEAD_HOURS),
        maxResultsPerProvider: MAX_EVENTS_PER_PROVIDER,
        logger,
      });

      // 从用户自己的日历中重新读取事件，可以防止
      // 调用方将自己附加到不属于他们的会议。
      const event = events.find(
        (candidate) => candidate.id === calendarEventId,
      );
      if (!event) throw new SafeError("你的日历中未找到该会议");
      if (!event.videoConferenceLink) {
        throw new SafeError("此会议没有可加入的视频链接");
      }

      const meeting = await upsertMeeting({
        emailAccountId,
        event,
        joinOverride: join,
      });

      // 新的未来预约可以等待定时任务。移除操作和现有
      // 预约会立即协调，这样被移动的事件不会把旧机器人
      // 遗留在定时任务窗口之外。
      const startsBeforeNextPass =
        differenceInMinutes(event.startTime, new Date()) <
        RECONCILE_WINDOW_MINUTES;

      if (!join || meeting.recordingId || startsBeforeNextPass) {
        await reconcileSingleEvent({ emailAccount, event, meeting, logger });
      }
    },
  );
