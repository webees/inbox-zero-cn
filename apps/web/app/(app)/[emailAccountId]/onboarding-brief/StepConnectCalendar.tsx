"use client";

import { Trans } from "@lingui/react/macro";
import { Calendar, CheckIcon } from "lucide-react";
import { PageHeading, TypographyP } from "@/components/Typography";
import { useCalendars } from "@/hooks/useCalendars";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";

export function StepConnectCalendar({ onNext }: { onNext: () => void }) {
  const { emailAccountId } = useAccount();
  const { data: calendarsData } = useCalendars();

  const hasCalendarConnected =
    calendarsData?.connections && calendarsData.connections.length > 0;

  return (
    <>
      <div className="flex justify-center">
        <IconCircle size="lg">
          <Calendar className="size-6" />
        </IconCircle>
      </div>

      <div className="text-center">
        <PageHeading className="mt-4">
          <Trans>连接你的日历</Trans>
        </PageHeading>
        <TypographyP className="mt-2 max-w-lg mx-auto">
          <Trans>
            我们会自动识别你即将与外部嘉宾举行的会议，并准备个性化简报。
          </Trans>
        </TypographyP>
      </div>

      <div className="flex flex-col items-center justify-center mt-8 gap-4">
        {hasCalendarConnected ? (
          <>
            <div className="flex items-center gap-2 text-green-600 font-medium animate-in fade-in zoom-in duration-300">
              <CheckIcon className="h-5 w-5" />
              <Trans>日历已连接！</Trans>
            </div>
            <Button onClick={onNext} className="mt-2">
              <Trans>继续</Trans>
            </Button>
          </>
        ) : (
          <ConnectCalendar
            analyticsPage="meeting_briefs"
            onboardingReturnPath={prefixPath(
              emailAccountId,
              "/onboarding-brief?step=2",
            )}
          />
        )}
      </div>
    </>
  );
}
