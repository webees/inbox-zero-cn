import { Link, Section, Text } from "@react-email/components";
import { BookingEmailLayout } from "./components/booking-email-layout";

export type GuestBookingRescheduledEmailProps = {
  cancelUrl: string;
  rescheduleUrl: string;
  eventTitle: string;
  formattedTime: string;
  previousFormattedTime: string;
  guestName: string;
  hostName: string;
  location?: string | null;
  dateMonth?: string;
  dateDay?: string;
  dateWeekday?: string;
  timeRange?: string;
  timezoneLabel?: string;
  meetingLink?: string | null;
};

export default function GuestBookingRescheduledEmail({
  cancelUrl,
  rescheduleUrl,
  eventTitle,
  formattedTime,
  previousFormattedTime,
  guestName,
  hostName,
  location,
  dateMonth,
  dateDay,
  dateWeekday,
  timeRange,
  timezoneLabel,
  meetingLink,
}: GuestBookingRescheduledEmailProps) {
  const meetingTitle = `${eventTitle}（与 ${hostName}）`;
  return (
    <BookingEmailLayout
      headline={`你与 ${hostName} 的会议已重新安排`}
      subline={formattedTime}
    >
      <Section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <Text className="m-0 text-[13px] font-medium text-amber-800">
          你的会议已调整时间。更新后的日历邀请即将发送。
        </Text>
        <Text className="m-0 mt-1 text-[12px] text-amber-700">
          原时间：{previousFormattedTime}
        </Text>
      </Section>

      <Text className="mb-1 mt-0 text-[15px] text-gray-900">
        你好 {guestName}，
      </Text>
      <Text className="m-0 mb-5 text-[15px] text-gray-900">
        以下是新的详细信息：
      </Text>

      <Section className="mb-5 overflow-hidden rounded-2xl border border-gray-200">
        <Section className="bg-[#FAFBFD] px-6 py-4">
          <table>
            <tr>
              {dateMonth && dateDay ? (
                <td className="pr-4">
                  <Section className="w-[60px] rounded-xl border border-gray-200 bg-white py-1.5 text-center">
                    <Text className="m-0 text-[10px] font-semibold uppercase tracking-wider text-red-600">
                      {dateMonth}
                    </Text>
                    <Text className="m-0 text-[22px] font-semibold leading-none text-gray-900">
                      {dateDay}
                    </Text>
                    {dateWeekday ? (
                      <Text className="m-0 mt-1 text-[10px] text-gray-500">
                        {dateWeekday}
                      </Text>
                    ) : null}
                  </Section>
                </td>
              ) : null}
              <td>
                <Text className="m-0 text-[16px] font-medium tracking-tight text-gray-900">
                  {meetingTitle}
                </Text>
                {timeRange || timezoneLabel ? (
                  <Text className="m-0 mt-1 text-[13px] text-gray-600">
                    {[timeRange, timezoneLabel].filter(Boolean).join(" · ")}
                  </Text>
                ) : (
                  <Text className="m-0 mt-1 text-[13px] text-gray-600">
                    {formattedTime}
                  </Text>
                )}
              </td>
            </tr>
          </table>
        </Section>

        {meetingLink || location ? (
          <Section className="px-6 py-3">
            {meetingLink ? (
              <Text className="m-0 mb-1 text-[13px] text-gray-700">
                加入会议：{" "}
                <Link
                  href={meetingLink}
                  className="font-mono text-[12px] text-blue-600 underline"
                >
                  {meetingLink}
                </Link>
              </Text>
            ) : null}
            {location && !meetingLink ? (
              <Text className="m-0 text-[13px] text-gray-700">
                地点：<strong>{location}</strong>
              </Text>
            ) : null}
          </Section>
        ) : null}
      </Section>

      <Section className="mb-6">
        {meetingLink ? (
          <Link
            href={meetingLink}
            className="mb-2 mr-2 inline-block rounded-md bg-gray-900 px-4 py-2 text-[13px] font-medium text-white no-underline"
          >
            加入会议
          </Link>
        ) : null}
        <Link
          href={rescheduleUrl}
          className="mb-2 mr-2 inline-block rounded-md border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 no-underline"
        >
          重新安排
        </Link>
        <Link
          href={cancelUrl}
          className="mb-2 mr-2 inline-block rounded-md border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 no-underline"
        >
          取消
        </Link>
      </Section>

      <Text className="m-0 mb-1 text-[14px] text-gray-700">
        期待很快见到你，
      </Text>
      <Text className="m-0 text-[14px] font-medium text-gray-900">
        {hostName}
      </Text>
    </BookingEmailLayout>
  );
}

GuestBookingRescheduledEmail.PreviewProps = {
  cancelUrl:
    "https://www.getinboxzero.com/book/cancel/example?token=test-token",
  rescheduleUrl:
    "https://www.getinboxzero.com/book/reschedule/example?token=test-token",
  eventTitle: "15 分钟简介",
  formattedTime: "Fri, Nov 13, 2026 · 10:00 AM",
  previousFormattedTime: "Thu, Nov 12, 2026 · 10:00 AM",
  guestName: "Sarah Chen",
  hostName: "Elie",
  location: "Google Meet",
  dateMonth: "NOV",
  dateDay: "13",
  dateWeekday: "Fri",
  timeRange: "10:00 AM – 10:15 AM",
  timezoneLabel: "Asia/Jerusalem",
  meetingLink: "https://meet.google.com/abc-defg-hij",
} satisfies GuestBookingRescheduledEmailProps;
