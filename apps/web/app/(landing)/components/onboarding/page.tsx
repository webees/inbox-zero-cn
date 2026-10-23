"use client";

import { Container } from "@/components/Container";
import { PageHeading, MutedText, TextLink } from "@/components/Typography";
import { StepInboxProcessedView } from "@/app/(app)/[emailAccountId]/onboarding/StepInboxProcessed";
import type { GetOnboardingProcessedEmailsResponse } from "@/app/api/user/onboarding/processed-emails/route";
import { SystemType } from "@/generated/prisma/enums";
import { getRuleLabel } from "@/utils/rule/consts";

export default function OnboardingComponentsPage() {
  return (
    <Container>
      <div className="space-y-10 py-8">
        <div>
          <PageHeading>引导流程组件</PageHeading>
          <MutedText className="mt-2">
            引导流程专用 UI 的 Storybook 页面。
          </MutedText>
          <div className="mt-4">
            <TextLink href="/components">← 返回所有组件</TextLink>
          </div>
        </div>

        <div>
          <div className="underline">StepInboxProcessed — 所有系统分类</div>
          <MutedText className="mt-1">
            每个 `SystemType`
            一个示例，按标签字母顺序排列，让每种徽章颜色都能一次性看到。
          </MutedText>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={getAllSystemCategoriesMock()}
              isLoading={false}
              isPremium={true}
              provider="google"
            />
          </div>
        </div>

        <div>
          <div className="underline">StepInboxProcessed — Gmail（高级版）</div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={getMockProcessedEmails()}
              isLoading={false}
              isPremium={true}
              provider="google"
            />
          </div>
        </div>

        <div>
          <div className="underline">
            StepInboxProcessed — Outlook（分类/文件夹术语）
          </div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={getMockProcessedEmails()}
              isLoading={false}
              isPremium={true}
              provider="microsoft"
            />
          </div>
        </div>

        <div>
          <div className="underline">
            StepInboxProcessed — 免费用户（显示升级提示）
          </div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={getMockProcessedEmails()}
              isLoading={false}
              isPremium={false}
              provider="google"
            />
          </div>
        </div>

        <div>
          <div className="underline">StepInboxProcessed — 加载状态</div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={undefined}
              isLoading={true}
              isPremium={true}
              provider="google"
            />
          </div>
        </div>

        <div>
          <div className="underline">
            StepInboxProcessed — 空状态回退（Gmail）
          </div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={{ totalCount: 0, draftCount: 0, emails: [] }}
              isLoading={false}
              isPremium={true}
              provider="google"
            />
          </div>
        </div>

        <div>
          <div className="underline">
            StepInboxProcessed — 空状态回退（Outlook）
          </div>
          <div className="mt-4">
            <OnboardingCompleteDemo
              data={{ totalCount: 0, draftCount: 0, emails: [] }}
              isLoading={false}
              isPremium={true}
              provider="microsoft"
            />
          </div>
        </div>
      </div>
    </Container>
  );
}

function OnboardingCompleteDemo({
  data,
  isLoading,
  isPremium,
  provider,
}: {
  data: GetOnboardingProcessedEmailsResponse | undefined;
  isLoading: boolean;
  isPremium: boolean;
  provider: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border bg-slate-50 px-4 py-10">
      <StepInboxProcessedView
        data={data}
        isLoading={isLoading}
        isPremium={isPremium}
        provider={provider}
        onNext={() => {}}
      />
    </div>
  );
}

const NOW = Date.now();
const hoursAgo = (n: number) =>
  new Date(NOW - n * 60 * 60 * 1000).toISOString();
const daysAgo = (n: number) =>
  new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

type MockSample = {
  systemType: SystemType;
  sender: string;
  subject: string;
  date: string;
  hasDraft?: boolean;
};

function buildMockResponse(
  idPrefix: string,
  samples: MockSample[],
): GetOnboardingProcessedEmailsResponse {
  const emails = samples.map((sample, index) => ({
    messageId: `${idPrefix}-${index}`,
    systemType: sample.systemType,
    label: getRuleLabel(sample.systemType),
    sender: sample.sender,
    subject: sample.subject,
    date: sample.date,
    hasDraft: sample.hasDraft ?? false,
  }));

  return {
    totalCount: emails.length,
    draftCount: emails.filter((e) => e.hasDraft).length,
    emails,
  };
}

function getMockProcessedEmails(): GetOnboardingProcessedEmailsResponse {
  return buildMockResponse("mock", [
    {
      systemType: SystemType.TO_REPLY,
      sender: "Sarah Chen",
      subject: "回复：周四的设计评审",
      date: hoursAgo(2),
      hasDraft: true,
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "TechNews Daily",
      subject: "你的周一邮件摘要",
      date: hoursAgo(3),
    },
    {
      systemType: SystemType.MARKETING,
      sender: "Notion",
      subject: "Notion 新功能：面向所有人的 AI 区块",
      date: hoursAgo(4),
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "Stratechery",
      subject: "没人预料到的平台转变",
      date: daysAgo(1),
    },
    {
      systemType: SystemType.TO_REPLY,
      sender: "Alex Park",
      subject: "关于引导流程的一个小问题",
      date: daysAgo(1),
      hasDraft: true,
    },
    {
      systemType: SystemType.MARKETING,
      sender: "Linear",
      subject: "试试我们新的 Cycles 工作流",
      date: daysAgo(2),
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "Lenny's Newsletter",
      subject: "优秀的 PM 如何做每周规划",
      date: daysAgo(3),
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "Morning Brew",
      subject: "市场过了一个周末",
      date: daysAgo(4),
    },
    {
      systemType: SystemType.MARKETING,
      sender: "Figma",
      subject: "诚邀你参加 Config 2026",
      date: daysAgo(5),
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "Not Boring",
      subject: "七家值得关注的公司",
      date: daysAgo(6),
    },
  ]);
}

function getAllSystemCategoriesMock(): GetOnboardingProcessedEmailsResponse {
  const samples: Omit<MockSample, "date">[] = [
    {
      systemType: SystemType.ACTIONED,
      sender: "Priya Sharma",
      subject: "回复：谢谢，都搞定了！",
    },
    {
      systemType: SystemType.AWAITING_REPLY,
      sender: "Marcus Lee",
      subject: "跟进合同事宜",
    },
    {
      systemType: SystemType.CALENDAR,
      sender: "Google Calendar",
      subject: "邀请：产品同步会 @ 周四下午 3 点",
    },
    {
      systemType: SystemType.COLD_EMAIL,
      sender: "Jordan Reyes",
      subject: "简短介绍：帮助像你这样的公司",
    },
    {
      systemType: SystemType.FYI,
      sender: "团队更新",
      subject: "每周工程总结",
    },
    {
      systemType: SystemType.MARKETING,
      sender: "Notion",
      subject: "Notion 新功能：面向所有人的 AI 区块",
    },
    {
      systemType: SystemType.NEWSLETTER,
      sender: "TechNews Daily",
      subject: "你的周一邮件摘要",
    },
    {
      systemType: SystemType.NOTIFICATION,
      sender: "GitHub",
      subject: "PR #482 有新评论",
    },
    {
      systemType: SystemType.RECEIPT,
      sender: "Stripe",
      subject: "来自 Acme Inc. 的收据",
    },
    {
      systemType: SystemType.TO_REPLY,
      sender: "Sarah Chen",
      subject: "回复：周四的设计评审",
      hasDraft: true,
    },
  ];

  return buildMockResponse(
    "category",
    samples.map((sample, index) => ({
      ...sample,
      date: index < 3 ? hoursAgo(index + 1) : daysAgo(index - 2),
    })),
  );
}
