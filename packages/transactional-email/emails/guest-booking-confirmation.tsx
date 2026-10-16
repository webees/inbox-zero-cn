import { Link, Section, Text } from "@react-email/components";
import { BookingEmailLayout } from "./components/booking-email-layout";

export type GuestBookingConfirmationEmailProps = {
  cancelUrl: string;
  rescheduleUrl: string;
  eventTitle: string;
  formattedTime: string;
  guestName: string;
  hostName: string;
  location?: string | null;
  dateMonth?: string;
  dateDay?: string;
  dateWeekday?: string;
  timeRange?: string;
  timezoneLabel?: string;
  guestNote?: string | null;
  meetingLink?: string | null;
};

export default function GuestBookingConfirmationEmail({
  cancelUrl,
  rescheduleUrl,
  eventTitle,
  formattedTime,
  guestName,
  hostName,
  location,
  dateMonth,
  dateDay,
  dateWeekday,
  timeRange,
  timezoneLabel,
  guestNote,
  meetingLink,
}: GuestBookingConfirmationEmailProps) {
  const meetingTitle = `${eventTitle}（与 ${hostName}）`;
  return (
    <BookingEmailLayout
      headline={`你与 ${hostName} 的会议已确认`}
      subline={formattedTime}
    >
      <Section className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <Text className="m-0 text-[13px] font-medium text-green-800">
          预约成功。日历邀请已添加到你的收件箱。
        </Text>
      </Section>

      <Text className="mb-1 mt-0 text-[15px] text-gray-900">
        你好 {guestName}，
      </Text>
      <Text className="m-0 mb-5 text-[15px] text-gray-900">
        期待与你交流。以下是详细信息：
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

      {guestNote ? (
        <Section className="mb-6 rounded-r-lg border-l-[3px] border-blue-600 bg-[#FAFBFD] px-4 py-3">
          <Text className="m-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            你的留言
          </Text>
          <Text className="m-0 mt-1 text-[13px] italic text-gray-900">
            "{guestNote}"
          </Text>
        </Section>
      ) : null}

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

GuestBookingConfirmationEmail.PreviewProps = {
  cancelUrl:
    "https://www.getinboxzero.com/book/cancel/example?token=test-token",
  rescheduleUrl:
    "https://www.getinboxzero.com/book/reschedule/example?token=test-token",
  eventTitle: "15 分钟简介",
  formattedTime: "Thu, Nov 12, 2026 · 10:00 AM",
  guestName: "Sarah Chen",
  hostName: "Elie",
  location: "Google Meet",
  dateMonth: "NOV",
  dateDay: "12",
  dateWeekday: "Thu",
  timeRange: "10:00 AM – 10:15 AM",
  timezoneLabel: "Asia/Jerusalem",
  guestNote: "嗨 Elie，我在做一款 B2B 邮件工具，很想聊聊你们的 AI 规则方案。",
  meetingLink: "https://meet.google.com/abc-defg-hij",
} satisfies GuestBookingConfirmationEmailProps;
