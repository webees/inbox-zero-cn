import type { BookingLinkLocationType } from "@/generated/prisma/enums";

export interface CalendarEventAttendee {
  declined?: boolean;
  email: string;
  name?: string;
}

export interface CalendarEvent {
  attendees: CalendarEventAttendee[];
  description?: string;
  endTime: Date;
  eventUrl?: string;
  id: string;
  // 当已连接日历自身的账号组织该事件时为 true。这是
  // 相对于日历连接的，而日历连接并不总是 EmailAccount。
  isOrganizer?: boolean;
  location?: string;
  organizerEmail?: string;
  startTime: Date;
  title: string;
  videoConferenceLink?: string;
}

export interface CalendarEventWriteInput {
  attendees: CalendarEventAttendee[];
  calendarId: string;
  description?: string;
  endTime: Date;
  locationType: BookingLinkLocationType;
  locationValue?: string | null;
  startTime: Date;
  timezone: string;
  title: string;
}

export interface CalendarEventWriteResult {
  eventUrl?: string;
  id: string;
  providerCalendarId: string;
  videoConferenceLink?: string;
}

export interface CalendarEventCancelInput {
  calendarId: string;
  eventId: string;
}

export interface CalendarEventUpdateInput {
  calendarId: string;
  endTime: Date;
  eventId: string;
  startTime: Date;
  timezone: string;
}

export interface CalendarEventProvider {
  fetchEvents(options: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  }): Promise<CalendarEvent[]>;
  fetchEventsWithAttendee(options: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
  }): Promise<CalendarEvent[]>;
}
