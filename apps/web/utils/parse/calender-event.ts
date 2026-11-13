import type { Attachment, ParsedMessage } from "@/utils/types";

interface CalendarEventInfo {
  endDate?: Date | null;
  eventDate?: Date | null;
  eventDateString?: string;
  eventTitle?: string;
  isCalendarEvent: boolean;
  organizer?: string;
  recurringEvent?: boolean;
  startDate?: Date | null;
}

export type CalendarEventStatus = {
  isEvent: boolean;
  timing?: "past" | "future";
};

/**
 * 检查一封邮件是否为日历事件，并提取事件日期信息
 * @param email The email to analyze
 * @returns Information about the calendar event
 */
export function analyzeCalendarEvent(email: ParsedMessage): CalendarEventInfo {
  const result: CalendarEventInfo = {
    isCalendarEvent: false,
  };

  // 检查主题中是否有日历事件标志
  const subject = email.headers.subject || "";
  const calendarKeywords = [
    "invitation",
    "calendar",
    "event",
    "meeting",
    "appointment",
    "scheduled",
    "invite",
    "calendar event",
    "reminder",
  ];

  // 检查主题是否包含日历关键词
  const hasCalendarSubject = calendarKeywords.some((keyword) =>
    subject.toLowerCase().includes(keyword.toLowerCase()),
  );

  // 检查正文中是否有日历事件标志
  const body = email.textHtml || "";

  // 根据各项检查判断它是否为日历事件
  result.isCalendarEvent = hasCalendarSubject || hasIcsAttachment(email);

  if (result.isCalendarEvent) {
    // 提取事件标题
    if (
      subject.includes("Updated invitation:") ||
      subject.includes("invitation:") ||
      subject.includes("invite:")
    ) {
      let title = subject
        .replace("Updated invitation:", "")
        .replace("invitation:", "")
        .replace("invite:", "")
        .trim();

      // 如果 "@" 之后有日程信息，只取事件名称
      if (title.includes("@")) {
        title = title.split("@")[0].trim();
      }

      result.eventTitle = title;
    } else {
      result.eventTitle = subject;
    }

    // Extract organizer
    const organizerMatch =
      body.match(
        /Organiser[\s\S]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      ) ||
      body.match(
        /Organizer[\s\S]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      );
    result.organizer = organizerMatch?.[1];

    // 在正文中查找日期模式
    result.recurringEvent =
      body.includes("Weekly") ||
      body.includes("RRULE:FREQ=") ||
      body.includes("recurring");

    // 从邮件正文的常见模式中提取日期
    const datePatterns = [
      // 带时间的完整日期模式："Monday 10 Feb to Monday 3 Mar"
      /(?:from|on)\s+(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s+(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i,

      // iCalendar 数据中 ISO 日期的模式：DTSTART、DTEND 等
      /DTSTART(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/i,

      // 日期时间字符串的模式
      /(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})/i,
    ];

    // 尝试使用这些模式查找日期
    let dateMatch = null;
    for (const pattern of datePatterns) {
      const match = body.match(pattern);
      if (match) {
        dateMatch = match;
        break;
      }
    }

    // 如果存在 iCalendar 日期则处理
    const dtStartMatch = body.match(
      /DTSTART(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/i,
    );
    if (dtStartMatch) {
      const [_, year, month, day, hour, minute, second] = dtStartMatch;
      result.startDate = new Date(
        Number.parseInt(year),
        Number.parseInt(month) - 1, // JavaScript months are 0-indexed
        Number.parseInt(day),
        Number.parseInt(hour),
        Number.parseInt(minute),
        Number.parseInt(second),
      );

      // 同时查找结束日期
      const dtEndMatch = body.match(
        /DTEND(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/i,
      );
      if (dtEndMatch) {
        const [_, yearEnd, monthEnd, dayEnd, hourEnd, minuteEnd, secondEnd] =
          dtEndMatch;
        result.endDate = new Date(
          Number.parseInt(yearEnd),
          Number.parseInt(monthEnd) - 1,
          Number.parseInt(dayEnd),
          Number.parseInt(hourEnd),
          Number.parseInt(minuteEnd),
          Number.parseInt(secondEnd),
        );
      }

      // 设置事件日期
      result.eventDate = result.startDate;
      result.eventDateString = result.eventDate.toLocaleString();
    }
    // 如果没有找到 iCalendar 日期，但找到了日期的文字描述
    else if (dateMatch) {
      // 对于 "Monday 10 Feb" 之类的文字模式
      const monthNames = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ];

      // 这是一个简化的实现——生产代码中你会需要更健壮的解析
      const day = dateMatch[1];
      const monthText = dateMatch[2].toLowerCase();

      // 确定月份编号（0-11）
      let month = monthNames.indexOf(monthText) % 12;
      if (month === -1) month = 0; // Default to January if not found

      // 匹配中可能没有年份，回退使用当前年份
      const year = dateMatch[3]
        ? Number.parseInt(dateMatch[3])
        : new Date().getFullYear();

      result.eventDate = new Date(year, month, Number.parseInt(day));
      result.eventDateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }

    // 如果尚未找到日期，则从文字模式中提取
    if (!result.eventDate) {
      // 查找诸如 "Weekly from 16:00 to 17:00 on Monday from Mon 10 Feb to Mon 3 Mar" 的模式
      const weeklyPattern =
        /Weekly.*?from.*?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
      const weeklyMatch = body.match(weeklyPattern);

      if (weeklyMatch) {
        const day = Number.parseInt(weeklyMatch[1]);
        const monthText = weeklyMatch[2];
        const monthMap: { [key: string]: number } = {
          Jan: 0,
          Feb: 1,
          Mar: 2,
          Apr: 3,
          May: 4,
          Jun: 5,
          Jul: 6,
          Aug: 7,
          Sep: 8,
          Oct: 9,
          Nov: 10,
          Dec: 11,
        };
        const month = monthMap[monthText] || 0;

        // 未指定时假定为当前年份
        const year = new Date().getFullYear();

        result.eventDate = new Date(year, month, day);
        result.eventDateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      }
    }
  }

  return result;
}

/**
 * 检查一封邮件是否有 .ics 文件附件。
 * @param email The email to check.
 * @returns True if a .ics attachment is found, false otherwise.
 */
export function hasIcsAttachment(email: ParsedMessage): boolean {
  if (!email.attachments || email.attachments.length === 0) {
    return false;
  }

  return email.attachments.some((attachment) =>
    attachment.filename?.toLowerCase().endsWith(".ics"),
  );
}

export function isCalendarEventInPast(email: ParsedMessage) {
  const calendarEvent = analyzeCalendarEvent(email);

  return (
    calendarEvent.isCalendarEvent &&
    calendarEvent.eventDate &&
    calendarEvent.eventDate < new Date()
  );
}

export function getCalendarEventStatus(
  email: ParsedMessage,
): CalendarEventStatus {
  const calendarEvent = analyzeCalendarEvent(email);

  if (!calendarEvent.isCalendarEvent) {
    return { isEvent: false };
  }

  if (!calendarEvent.eventDate) {
    return { isEvent: true };
  }

  return {
    isEvent: true,
    timing: calendarEvent.eventDate < new Date() ? "past" : "future",
  };
}

/** 用于预设规则匹配的高置信度日历检测（绕过 AI）。 */
export function isCalendarInvite(email: ParsedMessage): boolean {
  return (
    email.attachments?.some(isCalendarInviteAttachment) === true ||
    hasICalendarContent(email)
  );
}

export function isCalendarInviteAttachment(attachment: Attachment): boolean {
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (filename.endsWith(".ics")) return true;

  const mimeType = attachment.mimeType?.toLowerCase() ?? "";
  if (mimeType === "text/calendar" || mimeType === "application/ics")
    return true;

  const contentType = attachment.headers?.["content-type"]?.toLowerCase() ?? "";
  return (
    contentType.startsWith("text/calendar") ||
    contentType.startsWith("application/ics")
  );
}

function hasICalendarContent(email: ParsedMessage): boolean {
  const body = email.textHtml || email.textPlain || "";

  if (!body.includes("BEGIN:VCALENDAR")) {
    return false;
  }

  // 要求包含 DTSTART 或 METHOD 以避免误判
  return body.includes("DTSTART") || body.includes("METHOD:");
}
