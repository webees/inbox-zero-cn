"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { ListCard } from "@/components/ListCard";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { TypographyH3 } from "@/components/Typography";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { UpgradeToPlusButton } from "@/components/UpgradeToPlusButton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetMeetingRecorderUpcomingResponse } from "@/app/api/user/meeting-recorder/upcoming/route";
import { MeetingListItem } from "@/app/(app)/[emailAccountId]/meetings/MeetingListItem";
import { MEETING_DETAIL_STATUSES } from "@/utils/meeting-recorder/recording-lifecycle";
import { useMeetingRecorderUpcoming } from "@/hooks/useMeetingRecorder";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import { setMeetingJoinOverrideAction } from "@/utils/actions/meeting-recorder";
import { getActionErrorMessage } from "@/utils/error";

type UpcomingEvent = GetMeetingRecorderUpcomingResponse["events"][number];

export function UpcomingMeetingsToggleList({
  emailAccountId,
  onOpenMeeting,
}: {
  emailAccountId: string;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const analytics = useProductAnalytics();
  const { data, isLoading, error, mutate } =
    useMeetingRecorderUpcoming(emailAccountId);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);

  const { execute } = useAction(
    setMeetingJoinOverrideAction.bind(null, emailAccountId),
    {
      onError: ({ error }) => {
        toastError({
          description: getActionErrorMessage(error, {
            prefix: "更新此会议失败",
          }),
        });
      },
      onSettled: () => {
        setPendingEventId(null);
        mutate();
      },
    },
  );

  const toggleEvent = (event: UpcomingEvent, join: boolean) => {
    analytics.captureAction("meeting_recorder_join_override_toggled", {
      join,
    });
    setPendingEventId(event.id);
    execute({ join, calendarEventId: event.id });
  };

  const events = data?.events ?? [];
  const isLocked = data?.hasAccess === false;

  return (
    <div>
      <TypographyH3>即将开始</TypographyH3>

      <LoadingContent
        loading={isLoading}
        error={error}
        loadingComponent={<Skeleton className="mt-4 h-24 w-full" />}
      >
        {isLocked && (
          <Alert className="mt-4">
            <AlertTitle>录制会议需要 Plus 套餐</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              升级即可自动录制并总结会议。
              <UpgradeToPlusButton tooltip="升级到 Plus 套餐以录制并总结你的会议。" />
            </AlertDescription>
          </Alert>
        )}

        {!events.length ? (
          <Empty className="mt-4 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarIcon />
              </EmptyMedia>
              <EmptyTitle>没有即将开始且带视频链接的通话</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ListCard className="mt-4">
            {events.map((event) => {
              const joining = isJoining(event);
              const detailMeetingId =
                event.meetingId &&
                event.recordingStatus &&
                MEETING_DETAIL_STATUSES.includes(event.recordingStatus)
                  ? event.meetingId
                  : null;

              return (
                <MeetingListItem
                  key={event.id}
                  title={event.title}
                  startTime={event.startTime}
                  endTime={event.endTime}
                  status={event.recordingStatus}
                  failureReason={event.failureReason}
                  onClick={
                    detailMeetingId
                      ? () => onOpenMeeting(detailMeetingId)
                      : undefined
                  }
                >
                  {!detailMeetingId && (
                    <Toggle
                      name={`join-${event.id}`}
                      ariaLabel={`录制 ${event.title}`}
                      enabled={joining}
                      // 降级的用户仍应能取消已预约的会议；只有创建新预约才受限制。
                      disabled={
                        pendingEventId === event.id || (isLocked && !joining)
                      }
                      onChange={(join) => toggleEvent(event, join)}
                    />
                  )}
                </MeetingListItem>
              );
            })}
          </ListCard>
        )}
      </LoadingContent>
    </div>
  );
}

function isJoining(event: UpcomingEvent) {
  return (
    event.willRecord ||
    event.hasCancellableBooking ||
    event.joinOverride === true
  );
}
