import { SafeError } from "@/utils/error";
import type {
  CalendarInvitation,
  InvitationResponse,
  InvitationEvent,
} from "@/utils/calendar/invitations/parser";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import type { Client } from "@microsoft/microsoft-graph-client";
import { getCalendarClientWithRefresh } from "@/utils/outlook/calendar-client";
import type {
  CalendarEvent,
  CalendarEventCancelInput,
  CalendarEventProvider,
  CalendarEventUpdateInput,
  CalendarEventWriteInput,
  CalendarEventWriteResult,
} from "@/utils/calendar/event-types";
import { findVideoConferenceLink } from "@/utils/calendar/video-conference-link";
import { BookingLinkLocationType } from "@/generated/prisma/enums";
import type { Logger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

// PidLidAppointmentSequence 跟踪组织者的会议修订版本。
const APPOINTMENT_SEQUENCE_PROPERTY =
  "Integer {00062002-0000-0000-C000-000000000046} Id 0x8201";
const APPOINTMENT_SEQUENCE_EXPAND = `singleValueExtendedProperties($filter=id eq '${APPOINTMENT_SEQUENCE_PROPERTY}')`;
const ONLINE_MEETING_JOIN_URL_POLL_DELAYS_MS = [500, 1000, 2000] as const;
const MICROSOFT_TEAMS_PROVIDER = "teamsForBusiness";

export interface MicrosoftCalendarConnectionParams {
  accessToken: string | null;
  emailAccountId: string;
  expiresAt: number | null;
  refreshToken: string | null;
}

type MicrosoftEvent = {
  id?: string;
  subject?: string;
  body?: { content?: string };
  bodyPreview?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
  }>;
  isOrganizer?: boolean;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  location?: { displayName?: string };
  webLink?: string;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  isCancelled?: boolean;
  singleValueExtendedProperties?: Array<{ id: string; value: string }>;
  responseStatus?: { response?: string };
};

type MicrosoftCalendarOnlineMeetingSettings = {
  allowedOnlineMeetingProviders?: string[];
  defaultOnlineMeetingProvider?: string;
};

type MicrosoftOnlineMeetingFields = {
  isOnlineMeeting: true;
  onlineMeetingProvider: string;
};

export class MicrosoftCalendarEventProvider implements CalendarEventProvider {
  private readonly connection: MicrosoftCalendarConnectionParams;
  private readonly logger: Logger;

  constructor(connection: MicrosoftCalendarConnectionParams, logger: Logger) {
    this.connection = connection;
    this.logger = logger;
  }

  private async getClient(): Promise<Client> {
    return getCalendarClientWithRefresh({
      accessToken: this.connection.accessToken,
      refreshToken: this.connection.refreshToken,
      expiresAt: this.connection.expiresAt,
      emailAccountId: this.connection.emailAccountId,
      logger: this.logger,
    });
  }

  async fetchEventsWithAttendee({
    attendeeEmail,
    timeMin,
    timeMax,
    maxResults,
  }: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
  }): Promise<CalendarEvent[]> {
    const client = await this.getClient();

    // 使用 calendarView 端点，它能正确返回与时间范围重叠的事件
    const response = await client
      .api("/me/calendar/calendarView")
      .query({
        startDateTime: timeMin.toISOString(),
        endDateTime: timeMax.toISOString(),
      })
      .top(maxResults * 3) // Fetch more to filter by attendee
      .orderby("start/dateTime")
      .get();

    const events: MicrosoftEvent[] = response.value || [];

    // 过滤出拥有该参与者的事件
    return events
      .filter((event) =>
        event.attendees?.some(
          (a) =>
            a.emailAddress?.address?.toLowerCase() ===
            attendeeEmail.toLowerCase(),
        ),
      )
      .slice(0, maxResults)
      .map((event) => this.parseEvent(event));
  }

  async fetchEvents({
    timeMin = new Date(),
    timeMax,
    maxResults,
  }: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    this.logger.info("开始设置 Microsoft 日历客户端");
    const client = await this.getClient();
    this.logger.info("完成 Microsoft 日历客户端设置");

    // calendarView 需要开始和结束时间，默认从 timeMin 起 30 天
    const effectiveTimeMax =
      timeMax ?? new Date(timeMin.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 使用 calendarView 端点，它能正确返回与时间范围重叠的事件
    this.logger.info("开始请求 Microsoft 日历事件");
    const response = await client
      .api("/me/calendar/calendarView")
      .query({
        startDateTime: timeMin.toISOString(),
        endDateTime: effectiveTimeMax.toISOString(),
      })
      .top(maxResults || 100)
      .orderby("start/dateTime")
      .get();

    const events: MicrosoftEvent[] = response.value || [];
    this.logger.info("完成 Microsoft 日历事件请求", {
      eventCount: events.length,
    });

    return events.map((event) => this.parseEvent(event));
  }

  async findInvitationEvent(
    invitation: CalendarInvitation,
    mailboxEventId?: string,
  ): Promise<InvitationEvent | null> {
    if (invitation.recurrenceId) return null;
    const client = await this.getClient();
    const event = mailboxEventId
      ? await this.getMailboxEvent(client, mailboxEventId)
      : await this.findEventByUid(client, invitation.uid);
    if (!event) return null;
    if (event.isCancelled) throw new SafeError("该事件已被取消。");
    if (
      !event.id ||
      event.isOrganizer ||
      event.organizer?.emailAddress?.address?.toLowerCase() !==
        invitation.organizer
    )
      return null;
    if (
      !event.attendees?.some(
        (attendee) =>
          attendee.emailAddress?.address?.toLowerCase() === invitation.attendee,
      )
    )
      return null;
    const revision = event.singleValueExtendedProperties?.find(
      (property) =>
        property.id.toLowerCase() ===
        APPOINTMENT_SEQUENCE_PROPERTY.toLowerCase(),
    )?.value;
    if (!revision || !/^\d+$/.test(revision)) return null;
    if (Number(revision) !== invitation.sequence)
      throw new SafeError("此邀请已变更。请在你日历中的最新邀请上进行回应。");
    const response = event.responseStatus?.response;
    return {
      id: event.id,
      response:
        response === "tentativelyAccepted" ? "tentative" : (response ?? null),
    };
  }

  // Exchange 会重写其他日历服务商发送的邀请的 iCalUId，
  // 因此按 UID 查找会找不到它们。邮箱会将邀请邮件链接到
  // 它所创建的事件，这就是调用方在此传入的 id。
  private async getMailboxEvent(client: Client, eventId: string) {
    try {
      return (await client
        .api(`/me/events/${encodeURIComponent(eventId)}`)
        .query({ $expand: APPOINTMENT_SEQUENCE_EXPAND })
        .get()) as MicrosoftEvent;
    } catch (error) {
      this.logger.warn("无法读取与邀请关联的事件", {
        error,
      });
      return null;
    }
  }

  private async findEventByUid(client: Client, uid: string) {
    const result = await client
      .api("/me/calendar/events")
      .query({
        $filter: `iCalUId eq '${escapeODataString(uid)}'`,
        $top: 2,
        $expand: APPOINTMENT_SEQUENCE_EXPAND,
      })
      .get();
    const events: MicrosoftEvent[] = result.value ?? [];
    if (events.length !== 1 || result["@odata.nextLink"]) return null;
    return events[0];
  }

  async respondToInvitation(
    eventId: string,
    _invitation: CalendarInvitation,
    response: InvitationResponse,
  ) {
    const client = await this.getClient();
    const action = {
      accepted: "accept",
      declined: "decline",
      tentative: "tentativelyAccept",
    }[response];
    await client
      .api(`/me/events/${encodeURIComponent(eventId)}/${action}`)
      .post({ sendResponse: true });
  }

  async createEvent(
    input: CalendarEventWriteInput,
  ): Promise<CalendarEventWriteResult> {
    const client = await this.getClient();
    const useMicrosoftTeams =
      input.locationType === BookingLinkLocationType.MICROSOFT_TEAMS;
    const onlineMeetingFields = useMicrosoftTeams
      ? await getOnlineMeetingFields({
          calendarId: input.calendarId,
          client,
          logger: this.logger,
        })
      : null;
    const requestedOnlineMeeting = Boolean(onlineMeetingFields);
    const response: MicrosoftEvent = await client
      .api(`/me/calendars/${input.calendarId}/events`)
      .post({
        subject: input.title,
        body: {
          contentType: "text",
          content: input.description || "",
        },
        start: {
          dateTime: formatMicrosoftUtcDateTime(input.startTime),
          timeZone: "UTC",
        },
        end: {
          dateTime: formatMicrosoftUtcDateTime(input.endTime),
          timeZone: "UTC",
        },
        attendees: input.attendees.map((attendee) => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.name || attendee.email,
          },
          type: "required",
        })),
        ...(onlineMeetingFields ?? {}),
        location:
          !useMicrosoftTeams && input.locationValue
            ? { displayName: input.locationValue }
            : undefined,
      });

    let videoConferenceLink = getJoinUrl(response);

    // Graph 会在事件创建后初始化在线会议，因此
    // POST 响应有时在 `onlineMeeting` 填充之前就返回。
    // 当请求了加入 URL 时，重新获取事件以检索它。
    if (requestedOnlineMeeting && !videoConferenceLink && response.id) {
      videoConferenceLink = await pollForOnlineMeetingJoinUrl({
        client,
        eventId: response.id,
        logger: this.logger,
      });
    }

    if (requestedOnlineMeeting && !videoConferenceLink && response.id) {
      try {
        const patched: MicrosoftEvent = await client
          .api(`/me/events/${response.id}`)
          .patch(onlineMeetingFields);
        videoConferenceLink = getJoinUrl(patched);
      } catch (error) {
        this.logger.warn("无法在 Microsoft 事件上启用在线会议", {
          eventId: response.id,
          error,
        });
      }
    }

    if (requestedOnlineMeeting && !videoConferenceLink && response.id) {
      videoConferenceLink = await pollForOnlineMeetingJoinUrl({
        client,
        eventId: response.id,
        logger: this.logger,
      });
    }

    if (requestedOnlineMeeting && !videoConferenceLink) {
      this.logger.warn("创建事件后缺少 Microsoft 在线会议链接", {
        eventId: response.id,
        isOnlineMeeting: response.isOnlineMeeting,
        onlineMeetingProvider: response.onlineMeetingProvider,
      });
    }

    return {
      id: response.id || "",
      providerCalendarId: input.calendarId,
      eventUrl: response.webLink,
      videoConferenceLink,
    };
  }

  async cancelEvent(input: CalendarEventCancelInput): Promise<void> {
    const client = await this.getClient();

    await client
      .api(`/me/events/${input.eventId}/cancel`)
      .post({ comment: "" });
  }

  async updateEvent(input: CalendarEventUpdateInput): Promise<void> {
    const client = await this.getClient();

    await client.api(`/me/events/${input.eventId}`).patch({
      start: {
        dateTime: formatMicrosoftUtcDateTime(input.startTime),
        timeZone: "UTC",
      },
      end: {
        dateTime: formatMicrosoftUtcDateTime(input.endTime),
        timeZone: "UTC",
      },
    });
  }

  private parseEvent(event: MicrosoftEvent) {
    return {
      id: event.id || "",
      title: event.subject || "Untitled",
      description: event.bodyPreview || undefined,
      location: event.location?.displayName || undefined,
      eventUrl: event.webLink || undefined,
      videoConferenceLink:
        getJoinUrl(event) ||
        findVideoConferenceLink(
          event.location?.displayName,
          event.body?.content ?? event.bodyPreview,
        ),
      startTime: new Date(event.start?.dateTime || Date.now()),
      endTime: new Date(event.end?.dateTime || Date.now()),
      organizerEmail: event.organizer?.emailAddress?.address || undefined,
      isOrganizer: event.isOrganizer,
      attendees:
        event.attendees?.map((attendee) => ({
          email: attendee.emailAddress?.address || "",
          name: attendee.emailAddress?.name ?? undefined,
          declined: attendee.status?.response === "declined",
        })) || [],
    };
  }
}

function formatMicrosoftUtcDateTime(date: Date) {
  // Graph DateTimeTimeZone 期望为所提供的时区传入本地日期时间。
  return date.toISOString().replace(/Z$/, "0000");
}

function getJoinUrl(event: MicrosoftEvent): string | undefined {
  return event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;
}

async function getOnlineMeetingFields({
  calendarId,
  client,
  logger,
}: {
  calendarId: string;
  client: Client;
  logger: Logger;
}) {
  const settings = await getCalendarOnlineMeetingSettings({
    calendarId,
    client,
    logger,
  });

  let onlineMeetingProvider = settings?.defaultOnlineMeetingProvider;
  if (
    !settings ||
    settings.allowedOnlineMeetingProviders?.includes(MICROSOFT_TEAMS_PROVIDER)
  ) {
    onlineMeetingProvider = MICROSOFT_TEAMS_PROVIDER;
  }

  // 个人 Outlook 日历宣传 Skype 但忽略会议字段。
  if (
    !onlineMeetingProvider ||
    onlineMeetingProvider === "skypeForConsumer" ||
    onlineMeetingProvider === "unknown"
  ) {
    logger.warn("日历无法生成在线会议链接", {
      calendarId,
      onlineMeetingProvider,
      allowedOnlineMeetingProviders: settings?.allowedOnlineMeetingProviders,
      defaultOnlineMeetingProvider: settings?.defaultOnlineMeetingProvider,
    });
    return null;
  }

  return {
    isOnlineMeeting: true,
    onlineMeetingProvider,
  } satisfies MicrosoftOnlineMeetingFields;
}

async function getCalendarOnlineMeetingSettings({
  calendarId,
  client,
  logger,
}: {
  calendarId: string;
  client: Client;
  logger: Logger;
}): Promise<MicrosoftCalendarOnlineMeetingSettings | null> {
  try {
    return await client
      .api(`/me/calendars/${calendarId}`)
      .select("id,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider")
      .get();
  } catch (error) {
    logger.warn("无法获取 Microsoft 日历的会议提供商", {
      calendarId,
      error,
    });
    return null;
  }
}

async function pollForOnlineMeetingJoinUrl({
  client,
  eventId,
  logger,
}: {
  client: Client;
  eventId: string;
  logger: Logger;
}) {
  for (const delayMs of [0, ...ONLINE_MEETING_JOIN_URL_POLL_DELAYS_MS]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const event: MicrosoftEvent | undefined = await client
        .api(`/me/events/${eventId}`)
        .get();
      if (!event) continue;

      const joinUrl = getJoinUrl(event);
      if (joinUrl) return joinUrl;

      if (
        event.isOnlineMeeting === false &&
        event.onlineMeetingProvider === "unknown"
      ) {
        return;
      }
    } catch (error) {
      logger.warn("无法为在线会议 URL 重新获取 Microsoft 事件", {
        eventId,
        error,
      });
    }
  }

  return;
}
