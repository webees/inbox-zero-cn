"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { CardBasic } from "@/components/ui/card";
import { LoadingContent } from "@/components/LoadingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError, toastSuccess } from "@/components/Toast";
import type { GetAvailabilityResponse } from "@/app/api/user/availability/route";
import { useDefaultAvailability } from "@/hooks/useDefaultAvailability";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getActionErrorMessage } from "@/utils/error";
import { updateDefaultAvailabilityAction } from "@/utils/actions/booking";
import {
  collectWindows,
  DEFAULT_WEEKDAY_WINDOWS,
} from "./availability-schedule";
import { useWeeklyHours, WeeklyHoursEditor } from "./WeeklyHoursEditor";

export function AvailabilitySection() {
  const { data, isLoading, error, mutate } = useDefaultAvailability();

  return (
    <section className="space-y-3">
      <CardBasic className="px-4 py-4">
        <div className="mb-1">
          <h3 className="font-medium">空闲时间</h3>
          <p className="text-sm text-muted-foreground">
            设置助手通过邮件安排会议时可以建议的时间段。
          </p>
        </div>

        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={
            <Skeleton className="mt-4 h-96 w-full rounded-lg" />
          }
        >
          {data ? (
            <AvailabilityEditor
              key={data.schedule ? "schedule" : "default"}
              data={data}
              onSaved={mutate}
            />
          ) : null}
        </LoadingContent>
      </CardBasic>
    </section>
  );
}

function AvailabilityEditor({
  data,
  onSaved,
}: {
  data: GetAvailabilityResponse;
  onSaved: () => void;
}) {
  const { emailAccountId } = useAccount();

  const controller = useWeeklyHours(
    data.schedule?.windows ?? DEFAULT_WEEKDAY_WINDOWS,
  );

  const { execute: updateAvailability, isExecuting: isSaving } = useAction(
    updateDefaultAvailabilityAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "空闲时间已更新" });
        onSaved();
      },
      onError: (actionError) => {
        toastError({
          description:
            getActionErrorMessage(actionError.error) ?? "更新空闲时间失败",
        });
      },
    },
  );

  const handleSave = () => {
    const collected = collectWindows(controller.days);
    if (collected.windows === null) {
      toastError({ description: collected.error });
      return;
    }

    updateAvailability({ windows: collected.windows });
  };

  return (
    <div className="mt-4 space-y-4">
      <WeeklyHoursEditor controller={controller} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          我们会隐藏你已连接日历上已有活动的时间段。
        </p>
        <Button onClick={handleSave} loading={isSaving}>
          保存
        </Button>
      </div>
    </div>
  );
}
