"use client";

import { useState } from "react";
import {
  CheckIcon,
  ListChecksIcon,
  MailPlusIcon,
  MicIcon,
  ShieldIcon,
} from "lucide-react";
import { RadioCardGroup } from "@/components/RadioCardGroup";
import { SetupCard } from "@/components/SetupCard";
import {
  MessageText,
  MutedText,
  PageHeading,
  TextLink,
} from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { MeetingJoinRule } from "@/generated/prisma/enums";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getMeetingBotDisplayName } from "@/utils/meeting-recorder/bot-provider";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { JOIN_RULE_OPTIONS } from "@/app/(app)/[emailAccountId]/meetings/join-rule-options";

const features = [
  {
    icon: <MicIcon className="size-4 text-blue-500" />,
    title: "笔记与转录文本",
    description: "每一通电话的摘要",
  },
  {
    icon: <ListChecksIcon className="size-4 text-blue-500" />,
    title: "带负责人的行动事项",
    description: "决定了什么，以及由谁负责",
  },
  {
    icon: <MailPlusIcon className="size-4 text-blue-500" />,
    title: "为你起草跟进邮件",
    description: "存在你的草稿中，绝不会发送",
  },
];

export function MeetingRecorderOnboarding({
  emailAccountId,
  hasCalendarConnected,
  onEnable,
  isEnabling,
}: {
  emailAccountId: string;
  hasCalendarConnected: boolean;
  onEnable: (joinRule: MeetingJoinRule) => void;
  isEnabling: boolean;
}) {
  const [joinRule, setJoinRule] = useState<MeetingJoinRule | null>(null);

  // 第二步之前不会写入任何内容，因此中途离开流程不会启用任何东西。
  if (joinRule !== null) {
    return (
      <ChooseJoinRule
        emailAccountId={emailAccountId}
        joinRule={joinRule}
        onChange={setJoinRule}
        onConfirm={() => onEnable(joinRule)}
        isEnabling={isEnabling}
      />
    );
  }

  return (
    <SetupCard
      imageSrc="/images/illustrations/calling-help.svg"
      imageAlt="会议笔记助手"
      title="再也不用写会议笔记"
      description="Inbox Zero 会加入你的通话、记录笔记并起草跟进邮件。"
      features={features}
    >
      {hasCalendarConnected ? (
        <Button onClick={() => setJoinRule(MeetingJoinRule.ALL)}>
          开始使用
        </Button>
      ) : (
        <>
          <MessageText>连接你的日历即可开始：</MessageText>
          <ConnectCalendar
            analyticsPage="meetings"
            onboardingReturnPath={`/${emailAccountId}/meetings`}
          />
        </>
      )}
    </SetupCard>
  );
}

function ChooseJoinRule({
  emailAccountId,
  joinRule,
  onChange,
  onConfirm,
  isEnabling,
}: {
  emailAccountId: string;
  joinRule: MeetingJoinRule;
  onChange: (rule: MeetingJoinRule) => void;
  onConfirm: () => void;
  isEnabling: boolean;
}) {
  const { emailAccount, userEmail } = useAccount();
  const botName = getMeetingBotDisplayName({
    ownerName: emailAccount?.name ?? null,
    ownerEmail: userEmail,
  });

  return (
    <div className="mx-4 mt-16 flex max-w-lg flex-col gap-6 md:mx-auto">
      <div className="flex flex-col gap-3">
        <PageHeading>我们应该加入哪些会议？</PageHeading>

        <MutedText className="flex flex-wrap items-center gap-x-2">
          <CheckIcon className="size-4 shrink-0 text-green-600" />
          {userEmail} 已连接
          <TextLink href={`/${emailAccountId}/calendars`}>更改</TextLink>
        </MutedText>
      </div>

      <RadioCardGroup
        name="joinRule"
        ariaLabel="要加入哪些会议"
        value={joinRule}
        onChange={onChange}
        options={JOIN_RULE_OPTIONS}
        disabled={isEnabling}
      />

      <Button className="self-start" loading={isEnabling} onClick={onConfirm}>
        开始录制我的会议
      </Button>

      <MutedText className="flex items-start gap-2 text-xs">
        <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
        以名为 {botName} 的可见参会者身份加入。
      </MutedText>
    </div>
  );
}
