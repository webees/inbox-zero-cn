"use client";

import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { MailIcon, LightbulbIcon, UserSearchIcon } from "lucide-react";
import { SetupCard } from "@/components/SetupCard";
import { MessageText } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";

const features = [
  {
    icon: <UserSearchIcon className="size-4 text-blue-500" />,
    title: msg`Attendee research`,
    description: msg`Who they are, their company, and role`,
  },
  {
    icon: <MailIcon className="size-4 text-blue-500" />,
    title: msg`Email history`,
    description: msg`Recent conversations with this person`,
  },
  {
    icon: <LightbulbIcon className="size-4 text-blue-500" />,
    title: msg`Key context`,
    description: msg`Important details from past discussions`,
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
  const { t, i18n } = useLingui();

  return (
    <SetupCard
      imageSrc="/images/illustrations/communication.svg"
      imageAlt={t`会议简报`}
      title={t`会议简报`}
      description={t`在与外部嘉宾会面前，通过邮件或聊天应用接收简报。`}
      features={features.map((feature) => ({
        ...feature,
        title: i18n._(feature.title),
        description: i18n._(feature.description),
      }))}
    >
      {hasCalendarConnected ? (
        <>
          <MessageText>
            <Trans>一切就绪！启用会议简报即可开始：</Trans>
          </MessageText>
          <Button onClick={onEnable} loading={isEnabling}>
            <Trans>启用会议简报</Trans>
          </Button>
        </>
      ) : (
        <>
          <MessageText>
            <Trans>连接你的日历以开始使用：</Trans>
          </MessageText>
          <ConnectCalendar
            analyticsPage="meeting_briefs"
            onboardingReturnPath={`/${emailAccountId}/briefs`}
          />
        </>
      )}
    </SetupCard>
  );
}
