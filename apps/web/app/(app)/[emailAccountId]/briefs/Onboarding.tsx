"use client";

import { MailIcon, LightbulbIcon, UserSearchIcon } from "lucide-react";
import { SetupCard } from "@/components/SetupCard";
import { MessageText } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";

const features = [
  {
    icon: <UserSearchIcon className="size-4 text-blue-500" />,
    title: "参会人调研",
    description: "他们的身份、公司和职位",
  },
  {
    icon: <MailIcon className="size-4 text-blue-500" />,
    title: "邮件历史",
    description: "与此人的近期会话",
  },
  {
    icon: <LightbulbIcon className="size-4 text-blue-500" />,
    title: "关键背景",
    description: "过往讨论中的重要细节",
  },
];

export function BriefsOnboarding({
  emailAccountId,
  hasCalendarConnected = false,
  onEnable,
  isEnabling = false,
}: {
  emailAccountId: string;
  hasCalendarConnected?: boolean;
  onEnable?: () => void;
  isEnabling?: boolean;
}) {
  return (
    <SetupCard
      imageSrc="/images/illustrations/communication.svg"
      imageAlt="会议简报"
      title="会议简报"
      description="在与外部嘉宾开会前，通过邮件或聊天应用接收简报。"
      features={features}
    >
      {hasCalendarConnected ? (
        <>
          <MessageText>一切就绪！启用会议简报即可开始：</MessageText>
          <Button onClick={onEnable} loading={isEnabling}>
            启用会议简报
          </Button>
        </>
      ) : (
        <>
          <MessageText>连接你的日历即可开始：</MessageText>
          <ConnectCalendar
            analyticsPage="meeting_briefs"
            onboardingReturnPath={`/${emailAccountId}/briefs`}
          />
        </>
      )}
    </SetupCard>
  );
}
