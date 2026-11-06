import { Column, Link, Row, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import {
  ACCENT,
  StatsEmailCard,
  StatsEmailLayout,
} from "./components/stats-email-layout";

type EmailItem = {
  from: string;
  subject: string;
  sentAt: Date;
  // Opens the email in the user's mail client.
  url?: string;
  // Opens a search for everything from this sender.
  senderUrl?: string;
};

type ArchivedEmailItem = EmailItem & {
  ruleName: string;
};

export interface SummaryEmailProps {
  archivedEmailCount?: number;
  archivedEmails?: ArchivedEmailItem[];
  baseUrl: string;
  coldEmailCount?: number;
  coldEmailers: EmailItem[];
  // End of the week being summarized. Defaults to now.
  periodEnd?: Date;
  unsubscribeToken: string;
}

const MAX_SUBJECTS_PER_SENDER = 3;

const BADGES = {
  green: { bg: "#F3FFEF", border: "#DDF4D3", color: "#17A34A" },
  blue: { bg: "#EFF6FF", border: "#D6E8FC", color: ACCENT },
};

export default function SummaryEmail(props: SummaryEmailProps) {
  const {
    baseUrl = "https://www.getinboxzero.com",
    archivedEmailCount = 0,
    archivedEmails = [],
    coldEmailers,
    coldEmailCount = coldEmailers.length,
    periodEnd = new Date(),
    unsubscribeToken,
  } = props;

  const preview = [
    `${archivedEmailCount} 封邮件已归档`,
    `${coldEmailCount} 封冷邮件已拦截`,
  ].join(", ");

  return (
    <StatsEmailLayout
      baseUrl={baseUrl}
      unsubscribeToken={unsubscribeToken}
      preview={`${preview}。这是你本周的邮件概览。`}
      eyebrow={<>每周更新 &middot; {formatPeriod(periodEnd)}</>}
      title="你本周的邮件"
      subtitle="以下是你的 AI 助手本周处理收件箱的情况。"
    >
      <StatStrip
        stats={[
          { value: archivedEmailCount, label: "为你归档" },
          { value: coldEmailCount, label: "已拦截的冷邮件" },
        ]}
      />

      <ArchivedEmails
        archivedEmailCount={archivedEmailCount}
        archivedEmails={archivedEmails}
        baseUrl={baseUrl}
      />

      <ColdEmails
        coldEmailCount={coldEmailCount}
        coldEmailers={coldEmailers}
        baseUrl={baseUrl}
      />
    </StatsEmailLayout>
  );
}

SummaryEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  periodEnd: new Date("2024-03-20"),
  archivedEmailCount: 8,
  archivedEmails: [
    {
      from: "更新 <updates@example.com>",
      subject: "本周新功能",
      sentAt: new Date("2024-03-20"),
      ruleName: "营销",
    },
    {
      from: "更新 <updates@example.com>",
      subject: "加入我们网络研讨会的最后机会",
      sentAt: new Date("2024-03-19"),
      ruleName: "营销",
    },
    {
      from: "新闻通讯 <newsletter@example.com>",
      subject: "每周行业综述",
      sentAt: new Date("2024-03-19"),
      ruleName: "新闻通讯",
    },
    {
      from: "销售 <sales@example.com>",
      subject: "问个问题",
      sentAt: new Date("2024-03-18"),
      ruleName: "冷邮件",
    },
  ],
  coldEmailers: [
    {
      from: "James <james@example.com>",
      subject: "",
      sentAt: new Date("2024-03-15"),
    },
    {
      from: "Matt <matt@example.com>",
      subject: "",
      sentAt: new Date("2024-03-15"),
    },
    {
      from: "Paul <paul@example.com>",
      subject: "",
      sentAt: new Date("2024-03-15"),
    },
  ],
  unsubscribeToken: "123",
} satisfies SummaryEmailProps;

function StatStrip({ stats }: { stats: { value: number; label: string }[] }) {
  return (
    <Section className="pb-8">
      <Section className="rounded-2xl border border-solid border-[#EFEFEF] bg-white">
        <Row>
          {stats.map((stat, index) => (
            <Column
              key={stat.label}
              align="center"
              width={`${100 / stats.length}%`}
              className="px-3 py-[22px]"
              style={
                index < stats.length - 1
                  ? { borderRight: "1px solid #EFEFEF" }
                  : undefined
              }
            >
              <Text className="m-0 text-center text-[36px] font-medium leading-10 tracking-[-0.02em] text-[#242424]">
                {stat.value}
              </Text>
              <Text className="m-0 pt-1 text-center text-[13px] leading-[18px] text-[#6D6E70]">
                {stat.label}
              </Text>
            </Column>
          ))}
        </Row>
      </Section>
    </Section>
  );
}

function ArchivedEmails({
  archivedEmailCount,
  archivedEmails,
  baseUrl,
}: {
  archivedEmailCount: number;
  archivedEmails: ArchivedEmailItem[];
  baseUrl: string;
}) {
  if (!archivedEmailCount) return null;

  const archivedEmailGroups = groupArchivedEmailsByRule(archivedEmails);
  const hiddenCount = Math.max(archivedEmailCount - archivedEmails.length, 0);

  return (
    <StatsEmailCard
      title="为你归档"
      badge={{ label: `${archivedEmailCount} 本周`, ...BADGES.green }}
      description="你的规则已打上标签并移出收件箱的邮件。"
      footnote={
        hiddenCount > 0 ? `还有 ${hiddenCount} 封已归档邮件。` : undefined
      }
      cta={{
        href: `${baseUrl}/automation?tab=history`,
        label: "查看自动化历史",
      }}
    >
      {archivedEmailGroups.map((group) => (
        <EmailList
          key={group.ruleName}
          heading={`${group.ruleName} · ${group.emails.length}`}
          emails={group.emails}
        />
      ))}
    </StatsEmailCard>
  );
}

function ColdEmails({
  coldEmailCount,
  coldEmailers,
  baseUrl,
}: {
  coldEmailCount: number;
  coldEmailers: EmailItem[];
  baseUrl: string;
}) {
  if (!coldEmailCount) return null;

  const hiddenCount = Math.max(coldEmailCount - coldEmailers.length, 0);

  return (
    <StatsEmailCard
      title="冷邮件拦截"
      badge={{ label: `${coldEmailCount} 封已拦截`, ...BADGES.blue }}
      description="被拦截在收件箱之外的未经请求的推广邮件。"
      footnote={hiddenCount > 0 ? `还有 ${hiddenCount} 封冷邮件。` : undefined}
      cta={{ href: `${baseUrl}/cold-email-blocker`, label: "查看冷邮件" }}
    >
      <EmailList emails={coldEmailers} />
    </StatsEmailCard>
  );
}

function EmailList({
  heading,
  emails,
}: {
  heading?: string;
  emails: EmailItem[];
}) {
  if (emails.length === 0) return null;

  const senders = groupEmailsBySender(emails);

  return (
    <>
      {heading && (
        <Text
          className="m-0 px-6 pt-2.5 text-[12px] font-semibold leading-4"
          style={{ color: ACCENT }}
        >
          {heading}
        </Text>
      )}
      <Section className="px-6 pt-2">
        {senders.map((sender, index) => (
          <SenderRow
            key={sender.key}
            emails={sender.emails}
            isLast={index === senders.length - 1}
          />
        ))}
      </Section>
    </>
  );
}

function SenderRow({
  emails,
  isLast,
}: {
  emails: EmailItem[];
  isLast: boolean;
}) {
  const [latest] = emails;
  const count = emails.length;
  const { name, address } = splitFrom(latest.from);
  const senderHref = count > 1 ? latest.senderUrl || latest.url : latest.url;
  const shownEmails = emails.slice(0, MAX_SUBJECTS_PER_SENDER);
  const hiddenCount = count - shownEmails.length;
  const borderClass = `border-t border-solid border-[#EFEFEF] ${
    isLast ? "border-b" : ""
  }`;

  const sender = (
    <Text className="m-0 text-[14px] font-semibold leading-5 text-[#242424]">
      {name}
      {address && (
        <span className="font-normal text-[#848484]"> {address}</span>
      )}
    </Text>
  );

  return (
    <Row className={borderClass}>
      <Column className="py-3">
        <OptionalLink href={senderHref}>{sender}</OptionalLink>
        {shownEmails.map(
          (email, index) =>
            email.subject && (
              <OptionalLink key={`${email.subject}-${index}`} href={email.url}>
                <Text className="m-0 pt-0.5 text-[14px] leading-5 text-[#3D3D3D]">
                  {email.subject}
                </Text>
              </OptionalLink>
            ),
        )}
        {hiddenCount > 0 && (
          <OptionalLink href={latest.senderUrl}>
            <Text className="m-0 pt-0.5 text-[13px] leading-5 text-[#848484]">
              +{hiddenCount} 封
            </Text>
          </OptionalLink>
        )}
      </Column>
      <Column
        align="right"
        className="w-[70px] whitespace-nowrap py-3 align-top"
      >
        <Text className="m-0 text-[13px] leading-5 text-[#848484]">
          {formatDay(latest.sentAt)}
        </Text>
        {count > 1 && (
          <Text className="m-0 text-[12px] leading-4 text-[#848484]">
            {count} 封邮件
          </Text>
        )}
      </Column>
    </Row>
  );
}

function OptionalLink({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  if (!href) return children;
  return (
    <Link href={href} className="block no-underline">
      {children}
    </Link>
  );
}

function groupArchivedEmailsByRule(archivedEmails: ArchivedEmailItem[]) {
  const groups = new Map<string, EmailItem[]>();

  archivedEmails.forEach(({ ruleName, ...email }) => {
    const emails = groups.get(ruleName) || [];
    emails.push(email);
    groups.set(ruleName, emails);
  });

  return Array.from(groups, ([ruleName, emails]) => ({ ruleName, emails }));
}

// Keeps first-seen order, so the most recent email from each sender leads
// when the input is sorted newest first.
function groupEmailsBySender(emails: EmailItem[]) {
  const groups = new Map<string, EmailItem[]>();

  emails.forEach((email) => {
    const { name, address } = splitFrom(email.from);
    const key = (address || name).toLowerCase();
    const group = groups.get(key) || [];
    group.push(email);
    groups.set(key, group);
  });

  return Array.from(groups, ([key, emails]) => ({ key, emails }));
}

function splitFrom(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!match) return { name: from, address: "" };
  const [, name, address] = match;
  return name ? { name, address } : { name: address, address: "" };
}

function formatDay(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function formatPeriod(end: Date) {
  // 以 UTC 毫秒相减，这样本地夏令时切换不会改变日期。
  const start = new Date(new Date(end).getTime() - 6 * 24 * 60 * 60 * 1000);
  return `${formatDay(start)} 至 ${formatDay(end)}`;
}
