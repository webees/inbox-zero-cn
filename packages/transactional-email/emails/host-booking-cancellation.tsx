import { Section, Text } from "@react-email/components";
import { BookingEmailLayout } from "./components/booking-email-layout";

export type HostBookingCancellationEmailProps = {
  eventTitle: string;
  formattedTime: string;
  guestEmail: string;
  guestName: string;
  reason?: string | null;
};

export default function HostBookingCancellationEmail({
  eventTitle,
  formattedTime,
  guestEmail,
  guestName,
  reason,
}: HostBookingCancellationEmailProps) {
  return (
    <BookingEmailLayout
      headline={`${guestName} 取消了预约`}
      subline={formattedTime}
    >
      <Text className="m-0 mb-4 text-[14px] text-gray-700">
        <strong>{eventTitle}</strong> 与 {guestName}（{guestEmail}
        ）已被取消，并已从您的日历中移除。
      </Text>

      {reason ? (
        <Section className="rounded-r-lg border-l-[3px] border-gray-300 bg-[#FAFBFD] px-4 py-3">
          <Text className="m-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            原因
          </Text>
          <Text className="m-0 mt-1 text-[13px] text-gray-900">{reason}</Text>
        </Section>
      ) : null}
    </BookingEmailLayout>
  );
}

HostBookingCancellationEmail.PreviewProps = {
  eventTitle: "15 分钟简介",
  formattedTime: "Thu, Nov 12, 2026 · 10:00 AM",
  guestEmail: "sarah@acme.co",
  guestName: "Sarah Chen",
  reason: "计划有变",
} satisfies HostBookingCancellationEmailProps;
