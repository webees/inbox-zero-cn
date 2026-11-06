"use client";

import { useAction } from "next-safe-action/hooks";
import { ListCard } from "@/components/ListCard";
import { RadioCardGroup } from "@/components/RadioCardGroup";
import { toastError, toastSuccess } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { MutedText } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import {
  useMeetingRecorderSettings,
  useMeetingRecorderUpcoming,
} from "@/hooks/useMeetingRecorder";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import { getActionErrorMessage } from "@/utils/error";
import { updateMeetingRecorderSettingsAction } from "@/utils/actions/meeting-recorder";
import type { UpdateMeetingRecorderSettingsBody } from "@/utils/actions/meeting-recorder.validation";
import { JOIN_RULE_OPTIONS } from "@/app/(app)/[emailAccountId]/meetings/join-rule-options";

export function MeetingRecorderSettingsDialog({
  emailAccountId,
  open,
  onClose,
}: {
  emailAccountId: string;
  open: boolean;
  onClose: () => void;
}) {
  const analytics = useProductAnalytics();
  // Only mounted inside the page's `settings.enabled` branch, so the settings
  // are already loaded and SWR serves them from cache.
  const { data, mutate } = useMeetingRecorderSettings(emailAccountId);
  const { mutate: mutateUpcoming } = useMeetingRecorderUpcoming(emailAccountId);

  const { execute } = useAction(
    updateMeetingRecorderSettingsAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "设置已保存" });
        mutate();
        mutateUpcoming();
      },
      onError: ({ error }) => {
        mutate();
        toastError({
          description: getActionErrorMessage(error, {
            prefix: "保存设置失败",
          }),
        });
      },
    },
  );

  // 立即显示出变化。这些控件在 action 往返期间会一直留在屏幕上，
  // 不做这一步的话，单选框和开关看起来会卡住。
  const save = (update: UpdateMeetingRecorderSettingsBody) => {
    if (data) mutate({ ...data, ...update }, { revalidate: false });
    execute(update);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>笔记助手设置</DialogTitle>
        </DialogHeader>

        {data && (
          <div className="space-y-6">
            <div className="space-y-2">
              <ItemTitle>要加入哪些会议</ItemTitle>
              <RadioCardGroup
                name="joinRule"
                ariaLabel="要加入哪些会议"
                value={data.joinRule}
                onChange={(joinRule) => {
                  analytics.captureAction("meeting_recorder_setting_changed", {
                    setting: "join_rule",
                    value: joinRule,
                  });
                  save({ joinRule });
                }}
                options={JOIN_RULE_OPTIONS}
              />
            </div>

            <ListCard>
              <Item>
                <ItemContent>
                  <ItemTitle>把笔记发邮件给我</ItemTitle>
                </ItemContent>
                <Toggle
                  name="recapEmailEnabled"
                  ariaLabel="把笔记发邮件给我"
                  enabled={data.recapEmailEnabled}
                  onChange={(recapEmailEnabled) => {
                    analytics.captureAction(
                      "meeting_recorder_setting_changed",
                      { setting: "recap_email", value: recapEmailEnabled },
                    );
                    save({ recapEmailEnabled });
                  }}
                />
              </Item>

              <Item>
                <ItemContent>
                  <ItemTitle>起草跟进邮件</ItemTitle>
                </ItemContent>
                <Toggle
                  name="followUpDraftEnabled"
                  ariaLabel="起草跟进邮件"
                  enabled={data.followUpDraftEnabled}
                  onChange={(followUpDraftEnabled) => {
                    analytics.captureAction(
                      "meeting_recorder_setting_changed",
                      {
                        setting: "follow_up_draft",
                        value: followUpDraftEnabled,
                      },
                    );
                    save({ followUpDraftEnabled });
                  }}
                />
              </Item>
            </ListCard>

            <div className="flex items-center justify-between gap-4">
              <MutedText>会取消它已预约要加入的每一通电话。</MutedText>
              <Button
                variant="outline"
                onClick={() => {
                  analytics.captureAction("meeting_recorder_disabled");
                  save({ enabled: false });
                  onClose();
                }}
              >
                关闭
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
