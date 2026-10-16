import { Column, Link, Row, Section, Text } from "@react-email/components";
import {
  StatsEmailCard,
  StatsEmailLayout,
} from "./components/stats-email-layout";

type SuggestedSender = {
  name: string;
  email: string;
  count: number;
  readPercentage: number;
};

export interface InboxHealthEmailProps {
  baseUrl: string;
  emailAccountId: string;
  senders: SuggestedSender[];
  suggestionCount: number;
  unsubscribeToken: string;
  yearlyEmailsAvoided: number;
}

export default function InboxHealthEmail(props: InboxHealthEmailProps) {
  const {
    baseUrl = "https://www.getinboxzero.com",
    emailAccountId,
    unsubscribeToken,
    suggestionCount,
    yearlyEmailsAvoided,
    senders,
  } = props;

  const bulkUnsubscribePageUrl = `${baseUrl}/${emailAccountId}/bulk-unsubscribe`;
  const selectSuggestedUrl = `${bulkUnsubscribePageUrl}?select=suggested`;
  const senderCountText = getSenderCountText(suggestionCount);
  const hiddenCount = Math.max(suggestionCount - senders.length, 0);

  return (
    <StatsEmailLayout
      baseUrl={baseUrl}
      unsubscribeToken={unsubscribeToken}
      preview={`我们发现 ${senderCountText} 是你很少阅读的。一键清理它们。`}
      eyebrow="收件箱健康度"
      title={`我们发现 ${senderCountText} 是你很少阅读的`}
      subtitle={
        <>
          退订它们每年大约可以为你节省{" "}
          <span className="font-semibold text-[#242424]">
            {yearlyEmailsAvoided.toLocaleString("en-US")} 封邮件
          </span>
          。
        </>
      }
    >
      <StatsEmailCard
        title="很少阅读的发件人"
        description="基于你收件箱最近 3 个月的数据。"
        footnote={
          hiddenCount > 0
            ? `还有 ${hiddenCount} 位${hiddenCount === 1 ? "发件人" : "发件人"}。`
            : undefined
        }
        cta={{
          href: selectSuggestedUrl,
          label: "一键退订",
          primary: true,
        }}
      >
        <Section className="px-6 pt-2">
          {senders.map((sender, index) => (
            <SenderRow
              key={sender.email}
              sender={sender}
              href={bulkUnsubscribePageUrl}
              isLast={index === senders.length - 1}
            />
          ))}
        </Section>
      </StatsEmailCard>
    </StatsEmailLayout>
  );
}

InboxHealthEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  emailAccountId: "email-account-id",
  unsubscribeToken: "123",
  suggestionCount: 7,
  yearlyEmailsAvoided: 1248,
  senders: [
    {
      name: "每日优惠",
      email: "deals@shopping.example.com",
      count: 92,
      readPercentage: 2,
    },
    {
      name: "科技通讯",
      email: "newsletter@technews.example.com",
      count: 64,
      readPercentage: 8,
    },
    {
      name: "促销动态",
      email: "promo@retailer.example.com",
      count: 48,
      readPercentage: 0,
    },
    {
      name: "网络研讨会邀请",
      email: "events@saas.example.com",
      count: 35,
      readPercentage: 11,
    },
    {
      name: "职位提醒",
      email: "alerts@jobs.example.com",
      count: 26,
      readPercentage: 15,
    },
  ],
} satisfies InboxHealthEmailProps;

// 整行都是一个链接，这样邮件客户端不会自动链接裸露的地址。
function SenderRow({
  sender,
  href,
  isLast,
}: {
  sender: SuggestedSender;
  href: string;
  isLast: boolean;
}) {
  const showAddress = sender.name && sender.name !== sender.email;
  const borderClass = `border-t border-solid border-[#EFEFEF] ${
    isLast ? "border-b" : ""
  }`;

  return (
    <Row className={borderClass}>
      <Column className="py-3">
        <Link href={href} className="block no-underline">
          <Text className="m-0 text-[14px] font-semibold leading-5 text-[#242424]">
            {sender.name || sender.email}
          </Text>
          {showAddress && (
            <Text className="m-0 pt-0.5 text-[13px] leading-5 text-[#848484]">
              {sender.email}
            </Text>
          )}
        </Link>
      </Column>
      <Column
        align="right"
        className="w-[110px] whitespace-nowrap py-3 align-top"
      >
        <Text className="m-0 text-[14px] font-medium leading-5 text-[#242424]">
          {sender.count.toLocaleString("en-US")} 封邮件
        </Text>
        <Text className="m-0 pt-0.5 text-[13px] leading-5 text-[#848484]">
          {sender.readPercentage}% 已读
        </Text>
      </Column>
    </Row>
  );
}

export function getSenderCountText(count: number) {
  return `${count} 位发件人`;
}
