import { subMinutes } from "date-fns/subMinutes";
import { MeetingProcessingStatus } from "@/generated/prisma/enums";
import { aiDraftMeetingFollowUp } from "@/utils/ai/meeting-recorder/draft-meeting-follow-up";
import {
  aiSummarizeMeeting,
  parseMeetingSummary,
  type MeetingSummary,
} from "@/utils/ai/meeting-recorder/summarize-meeting";
import { createEmailProvider } from "@/utils/email/provider";
import { captureException } from "@/utils/error";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { Logger } from "@/utils/logger";
import {
  getFollowUpRecipients,
  parseAttendeeSnapshot,
  type MeetingAttendee,
} from "@/utils/meeting-recorder/attendees";
import type { NormalizedTranscript } from "@/utils/meeting-recorder/bot-provider";
import {
  MAX_PROCESSING_ATTEMPTS,
  MEETING_RECORDER_MIN_TIER,
  STUCK_PROCESSING_MINUTES,
} from "@/utils/meeting-recorder/config";
import { sendMeetingRecapEmail } from "@/utils/meeting-recorder/send-recap";
import { posthogCaptureEvent } from "@/utils/posthog";
import { checkHasAccess } from "@/utils/premium/server";
import prisma from "@/utils/prisma";
import { textToHtmlParagraphs } from "@/utils/string";
import { getEmailAccountWithAi, getWritingStyle } from "@/utils/user/get";

/**
 * 将某个账号持有的已完成录制副本转换为摘要、跟进
 * 草稿和回顾邮件。每一步都由它所写入的字段加以保护，
 * 因此部分运行后的队列重试绝不会发送第二封邮件或留下
 * 第二份草稿。
 */
export async function processMeetingForAccount({
  meetingId,
  logger,
}: {
  meetingId: string;
  logger: Logger;
}): Promise<void> {
  const claim = await prisma.meeting.updateMany({
    where: {
      id: meetingId,
      // 摘要生成会调用模型，因此每次都失败的会议必须
      // 停止重试，而不是在每次 cron 触发时都产生费用。
      processingAttempts: { lt: MAX_PROCESSING_ATTEMPTS },
      OR: [
        {
          processingStatus: {
            in: [
              MeetingProcessingStatus.PENDING,
              MeetingProcessingStatus.FAILED,
            ],
          },
        },
        // 中途被杀死的运行会让该行永远处于已认领状态。每个子步骤
        // 都由所写入的字段保护，因此重新拾起是安全的。
        {
          processingStatus: MeetingProcessingStatus.PROCESSING,
          updatedAt: { lt: subMinutes(new Date(), STUCK_PROCESSING_MINUTES) },
        },
      ],
    },
    data: {
      processingStatus: MeetingProcessingStatus.PROCESSING,
      processingAttempts: { increment: 1 },
    },
  });
  if (claim.count === 0) {
    logger.info("Meeting is not claimable for processing");
    return;
  }

  try {
    await runProcessingSteps({ meetingId, logger });

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { processingStatus: MeetingProcessingStatus.COMPLETED },
    });
  } catch (error) {
    logger.error("Failed to process meeting", { error });
    captureException(error);

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { processingStatus: MeetingProcessingStatus.FAILED },
    });

    // 为 UI 标记该失败，同时让队列也看到它。在此处吞掉错误
    // 会报告成功，并耗尽瞬时的 AI 或邮箱故障所能获得的
    // 唯一一次重试。每个子步骤都单独受保护，
    // 因此重试会继续而不是重复工作。
    throw error;
  }
}

async function runProcessingSteps({
  meetingId,
  logger,
}: {
  meetingId: string;
  logger: Logger;
}): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      recording: { select: { transcript: true } },
      emailAccount: {
        select: {
          meetingRecorderEnabled: true,
          meetingRecorderRecapEmailEnabled: true,
          meetingRecorderFollowUpDraftEnabled: true,
        },
      },
    },
  });
  if (!meeting) throw new Error("Meeting not found");

  if (!meeting.emailAccount.meetingRecorderEnabled) {
    logger.info("Skipping meeting because the notetaker is disabled");
    return;
  }

  const transcript = meeting.recording?.transcript as
    | NormalizedTranscript
    | null
    | undefined;
  if (!transcript?.length) {
    logger.info("Skipping meeting with an empty transcript");
    return;
  }

  const emailAccount = await getEmailAccountWithAi({
    emailAccountId: meeting.emailAccountId,
  });
  if (!emailAccount) throw new Error("Email account not found");

  const hasAccess = await checkHasAccess({
    userId: emailAccount.userId,
    minimumTier: MEETING_RECORDER_MIN_TIER,
  });
  if (!hasAccess) {
    logger.info("Skipping meeting because the plan does not include it");
    return;
  }

  const attendees = parseAttendeeSnapshot(meeting.attendees);

  const summary =
    parseMeetingSummary(meeting.summary) ??
    (await summarizeAndSave({
      meetingId,
      emailAccount,
      eventTitle: meeting.eventTitle,
      attendees,
      transcript,
    }));

  const recipients = getFollowUpRecipients(attendees, emailAccount.email);
  const wantsDraft =
    meeting.emailAccount.meetingRecorderFollowUpDraftEnabled &&
    recipients.length > 0 &&
    !meeting.followUpDraftStartedAt;

  if (wantsDraft) {
    await createFollowUpDraft({
      meetingId,
      emailAccount,
      provider: emailAccount.account.provider,
      eventTitle: meeting.eventTitle,
      summary,
      recipients,
      logger,
    });
  }

  if (
    meeting.emailAccount.meetingRecorderRecapEmailEnabled &&
    !meeting.recapSentAt
  ) {
    // 在认领发送之前先读取，这样瞬时的读取失败会重试，
    // 而不是浪费掉一次性的回顾认领。
    const refreshedMeeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { followUpDraftId: true },
    });

    // 先认领发送再执行：重复的回顾比缺失的回顾更糟，
    // 而且用户随时可以在应用中打开该会议。
    const claim = await prisma.meeting.updateMany({
      where: { id: meetingId, recapSentAt: null },
      data: { recapSentAt: new Date() },
    });

    if (claim.count > 0) {
      await sendMeetingRecapEmail({
        emailAccountId: meeting.emailAccountId,
        userEmail: emailAccount.email,
        provider: emailAccount.account.provider,
        timezone: emailAccount.timezone,
        meetingTitle: meeting.eventTitle,
        startTime: meeting.startTime,
        summary,
        followUpDraftCreated: !!refreshedMeeting?.followUpDraftId,
        logger,
      });

      await posthogCaptureEvent(emailAccount.email, "Meeting recap email sent");
    }
  }
}

async function summarizeAndSave({
  meetingId,
  emailAccount,
  eventTitle,
  attendees,
  transcript,
}: {
  meetingId: string;
  emailAccount: EmailAccountWithAI;
  eventTitle: string;
  attendees: MeetingAttendee[];
  transcript: NormalizedTranscript;
}): Promise<MeetingSummary> {
  const summary = await aiSummarizeMeeting({
    emailAccount,
    eventTitle,
    attendees,
    transcript,
  });

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { summary },
  });

  await posthogCaptureEvent(emailAccount.email, "Meeting summary created", {
    attendeeCount: attendees.length,
  });

  return summary;
}

async function createFollowUpDraft({
  meetingId,
  emailAccount,
  provider,
  eventTitle,
  summary,
  recipients,
  logger,
}: {
  meetingId: string;
  emailAccount: EmailAccountWithAI;
  provider: string;
  eventTitle: string;
  summary: MeetingSummary;
  recipients: MeetingAttendee[];
  logger: Logger;
}): Promise<void> {
  const writingStyle = await getWritingStyle({
    emailAccountId: emailAccount.id,
  });

  const draft = await aiDraftMeetingFollowUp({
    emailAccount,
    eventTitle,
    summary,
    recipients,
    writingStyle,
  });

  const emailProvider = await createEmailProvider({
    emailAccountId: emailAccount.id,
    provider,
    logger,
  });

  // 只有在所有不涉及邮箱副作用的步骤都成功后才认领，
  // 这样瞬时的 AI 故障会把认领留给重试。认领仍会在
  // 邮箱写入之前完成：如果我们在两者之间崩溃，草稿就
  // 作废，因为可能留下第二份草稿的重试更糟。
  const claim = await prisma.meeting.updateMany({
    where: { id: meetingId, followUpDraftStartedAt: null },
    data: { followUpDraftStartedAt: new Date() },
  });
  if (claim.count === 0) {
    logger.info("Follow-up draft already claimed by another run");
    return;
  }

  const { id } = await emailProvider.createDraft({
    to: recipients.map((recipient) => recipient.email).join(", "),
    subject: draft.subject,
    messageHtml: textToHtmlParagraphs(draft.body),
  });

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { followUpDraftId: id },
  });

  logger.info("Created meeting follow-up draft", { draftId: id });

  await posthogCaptureEvent(
    emailAccount.email,
    "Meeting follow-up draft created",
    { recipientCount: recipients.length },
  );
}
