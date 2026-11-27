import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

export type GuestBriefing = {
  name: string;
  email: string;
  bullets: string[];
};

export type InternalTeamMember = {
  name?: string;
  email: string;
};

export type BriefingContent = {
  priorities: string[];
  guests: GuestBriefing[];
  internalTeamMembers?: InternalTeamMember[];
};

export type MeetingBriefingEmailProps = {
  baseUrl: string;
  emailAccountId: string;
  meetingTitle: string;
  formattedTime: string; // e.g., "2:00 PM"
  videoConferenceLink?: string;
  eventUrl: string;
  briefingContent: BriefingContent;
  unsubscribeToken: string;
};

function renderGuestBriefings(guests: GuestBriefing[]) {
  return guests.map((guest, guestIndex) => (
    <div key={`guest-${guestIndex}`} className={guestIndex > 0 ? "mt-4" : ""}>
      <Text className="text-sm text-gray-800 mt-0 mb-1">
        <strong>
          {guest.name} ({guest.email})
        </strong>
      </Text>
      {guest.bullets.map((bullet, bulletIndex) => (
        <Text
          key={`bullet-${guestIndex}-${bulletIndex}`}
          className="text-sm text-gray-800 mt-0 mb-0 pl-2"
        >
          - {bullet}
        </Text>
      ))}
    </div>
  ));
}

function renderInternalTeamNote(internalTeamMembers: InternalTeamMember[]) {
  if (internalTeamMembers.length === 0) return null;

  const names = internalTeamMembers
    .map((member) => member.name || member.email)
    .join(", ");

  return (
    <Text className="text-xs text-gray-500 mt-4 mb-0 italic">
      Also attending: {names} (internal team members)
    </Text>
  );
}

export default function MeetingBriefingEmail({
  baseUrl = "https://www.getinboxzero.com",
  emailAccountId,
  meetingTitle,
  formattedTime,
  videoConferenceLink,
  eventUrl,
  briefingContent,
}: MeetingBriefingEmailProps) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto w-full max-w-[600px] p-0">
            <Section className="px-8 pt-6 pb-2">
              <Text className="text-base text-gray-900 mt-0 mb-0">
                Briefing for <strong>{meetingTitle}</strong>
              </Text>
              <Text className="text-base text-gray-900 mt-0 mb-0">
                开始时间 <strong>{formattedTime}</strong>
              </Text>
            </Section>

            <Section className="px-8 pt-2 pb-6">
              {videoConferenceLink && (
                <Text className="text-sm text-gray-700 mt-0 mb-2">
                  - 加入链接：{" "}
                  <Link
                    href={videoConferenceLink}
                    className="text-blue-600 underline"
                  >
                    {videoConferenceLink}
                  </Link>
                </Text>
              )}
              {eventUrl && (
                <Text className="text-sm text-gray-700 mt-0 mb-0">
                  - 日历链接：{" "}
                  <Link href={eventUrl} className="text-blue-600 underline">
                    {eventUrl}
                  </Link>
                </Text>
              )}
            </Section>

            {briefingContent.priorities.length > 0 && (
              <Section className="px-8 pb-4">
                <Text className="text-sm text-gray-900 mt-0 mb-2">
                  <strong>会议重点</strong>
                </Text>
                {briefingContent.priorities.map((priority, index) => (
                  <Text
                    key={`priority-${index}`}
                    className="text-sm text-gray-800 mt-0 mb-2"
                  >
                    - {priority}
                  </Text>
                ))}
              </Section>
            )}

            <Section className="px-8 pb-4">
              {renderGuestBriefings(briefingContent.guests)}
              {renderInternalTeamNote(
                briefingContent.internalTeamMembers ?? [],
              )}
            </Section>

            <Section className="px-8 pb-6">
              <Text className="text-xs text-gray-400 mt-0 mb-0 italic">
                注意：本简报由 AI 生成，可能不准确，尤其是常见姓名。
              </Text>
            </Section>

            <Hr className="border-solid border-gray-300 my-6 mx-8" />

            <Section className="px-8 pb-8">
              <Text className="text-xs text-gray-500 mt-0 mb-2">
                你收到本简报，是因为你在 Inbox Zero 设置中启用了会议简报功能。
              </Text>
              <Text className="text-xs text-gray-500 mt-0 mb-0">
                <Link
                  href={`${baseUrl}/${emailAccountId}/briefs`}
                  className="text-gray-600 underline"
                >
                  管理设置
                </Link>
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

MeetingBriefingEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  unsubscribeToken: "test-token",
  emailAccountId: "test-account",
  meetingTitle: "与 Acme Corp 的产品战略评审",
  formattedTime: "2:00 PM",
  videoConferenceLink: "https://meet.google.com/abc-defg-hij",
  eventUrl: "https://calendar.google.com/event/123",
  briefingContent: {
    priorities: ["就集成时间表达成一致，并确认由谁负责技术评估。"],
    guests: [
      {
        name: "约翰·史密斯",
        email: "john@acmecorp.com",
        bullets: [
          "Acme Corp 首席执行官，2019 年加入",
          "3 周前季度评审时见过面",
          "近期邮件：讨论了企业版套餐定价",
          "对 API 集成感兴趣",
          "其 50 多人团队的决策者",
        ],
      },
      {
        name: "莎拉·约翰逊",
        email: "sarah@acmecorp.com",
        bullets: [
          "Acme Corp 工程副总裁",
          "首次与这位联系人会面",
          "该交易的技术评估人",
        ],
      },
    ],
    internalTeamMembers: [
      { name: "爱丽丝·陈", email: "alice@mycompany.com" },
      { name: "鲍勃·威廉姆斯", email: "bob@mycompany.com" },
    ],
  },
};

export function generateMeetingBriefingSubject(
  props: Pick<MeetingBriefingEmailProps, "meetingTitle" | "formattedTime">,
): string {
  const { meetingTitle, formattedTime } = props;

  return `关于 ${meetingTitle} 的会议简报，开始时间 ${formattedTime}`;
}
