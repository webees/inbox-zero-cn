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

export type MeetingRecapActionItem = {
  description: string;
  owner?: string | null;
};

export type MeetingRecapContent = {
  overview: string;
  keyDecisions: string[];
  actionItems: MeetingRecapActionItem[];
  openQuestions?: string[] | null;
  nextSteps?: string[] | null;
};

export type MeetingRecapEmailProps = {
  baseUrl: string;
  emailAccountId: string;
  meetingTitle: string;
  formattedTime: string;
  recap: MeetingRecapContent;
  followUpDraftCreated: boolean;
  unsubscribeToken: string;
};

function renderBulletSection(title: string, items: string[]) {
  if (items.length === 0) return null;

  return (
    <Section className="px-8 pb-4">
      <Text className="text-sm font-semibold text-gray-900 mt-0 mb-1">
        {title}
      </Text>
      {items.map((item, index) => (
        <Text
          key={`${title}-${index}`}
          className="text-sm text-gray-800 mt-0 mb-0 pl-2"
        >
          - {item}
        </Text>
      ))}
    </Section>
  );
}

export default function MeetingRecapEmail({
  baseUrl = "https://www.getinboxzero.com",
  emailAccountId,
  meetingTitle,
  formattedTime,
  recap,
  followUpDraftCreated,
}: MeetingRecapEmailProps) {
  const actionItems = recap.actionItems.map((item) =>
    item.owner ? `${item.owner}: ${item.description}` : item.description,
  );

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto w-full max-w-[600px] p-0">
            <Section className="px-8 pt-6 pb-2">
              <Text className="text-base text-gray-900 mt-0 mb-0">
                来自 <strong>{meetingTitle}</strong> 的笔记
              </Text>
              <Text className="text-base text-gray-900 mt-0 mb-0">
                {formattedTime}
              </Text>
            </Section>

            <Section className="px-8 pt-2 pb-4">
              <Text className="text-sm text-gray-800 mt-0 mb-0">
                {recap.overview}
              </Text>
            </Section>

            {renderBulletSection("决策", recap.keyDecisions)}
            {renderBulletSection("行动项", actionItems)}
            {renderBulletSection("待解决问题", recap.openQuestions ?? [])}
            {renderBulletSection("后续步骤", recap.nextSteps ?? [])}

            {followUpDraftCreated && (
              <Section className="px-8 pb-4">
                <Text className="text-sm text-gray-700 mt-0 mb-0">
                  一封发给其他参会者的跟进邮件已保存在你的草稿中。尚未发送任何内容。
                </Text>
              </Section>
            )}

            <Section className="px-8 pb-6">
              <Text className="text-xs text-gray-400 mt-0 mb-0 italic">
                这些笔记由 AI 根据自动转录生成，可能不准确。
              </Text>
            </Section>

            <Hr className="border-solid border-gray-300 my-6 mx-8" />

            <Section className="px-8 pb-8">
              <Text className="text-xs text-gray-500 mt-0 mb-2">
                你收到这些笔记是因为你在 Inbox Zero 设置中启用了会议记录功能。
              </Text>
              <Text className="text-xs text-gray-500 mt-0 mb-0">
                <Link
                  href={`${baseUrl}/${emailAccountId}/meetings`}
                  className="text-gray-600 underline"
                >
                  查看会议
                </Link>
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

MeetingRecapEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  unsubscribeToken: "test-token",
  emailAccountId: "test-account",
  meetingTitle: "与 Acme Corp 的产品战略评审",
  formattedTime: "Mon, May 4 at 2:00 PM",
  followUpDraftCreated: true,
  recap: {
    overview:
      "Acme 介绍了他们的上线时间表，并对企业版套餐的 API 限制提出了顾虑。团队同意在下次通话前重新讨论定价。",
    keyDecisions: [
      "企业版套餐将包含更高的 API 速率限制",
      "上线时间推迟到 6 月第一周",
    ],
    actionItems: [
      { description: "发送修订后的报价单", owner: "Alice" },
      { description: "确认安全审查时间表", owner: "John" },
      { description: "分享迁移清单" },
    ],
    openQuestions: ["谁来批准安全审查？"],
    nextSteps: ["下周四带着更新后的定价再次开会"],
  },
} satisfies MeetingRecapEmailProps;

export function generateMeetingRecapSubject(
  props: Pick<MeetingRecapEmailProps, "meetingTitle">,
): string {
  return `来自 ${props.meetingTitle} 的笔记`;
}
