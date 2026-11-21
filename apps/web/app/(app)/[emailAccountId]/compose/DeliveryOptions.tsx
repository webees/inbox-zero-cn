"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/Tooltip";

export type DeliveryOptionsHandle = {
  open: (option: "sendLater" | "remindMe") => void;
};

export const DeliveryOptions = forwardRef<
  DeliveryOptionsHandle,
  {
    sendAt: string;
    remindAt: string;
    disabled: boolean;
    onSendAtChange: (value: string) => void;
    onRemindAtChange: (value: string) => void;
    shortcutOwnerId: string;
  }
>(function DeliveryOptions(
  {
    sendAt,
    remindAt,
    disabled,
    onSendAtChange,
    onRemindAtChange,
    shortcutOwnerId,
  },
  ref,
) {
  const { t } = useLingui();
  const [openOption, setOpenOption] = useState<"sendLater" | "remindMe" | null>(
    null,
  );
  useImperativeHandle(ref, () => ({ open: setOpenOption }), []);

  return (
    <>
      <DeliveryTimePicker
        label={t`Send later`}
        value={sendAt}
        onChange={onSendAtChange}
        disabled={disabled}
        open={openOption === "sendLater"}
        onOpenChange={(open) => setOpenOption(open ? "sendLater" : null)}
        shortcut="sendLater"
        shortcutOwnerId={shortcutOwnerId}
      />
      <DeliveryTimePicker
        label={t`Remind me`}
        value={remindAt}
        onChange={onRemindAtChange}
        disabled={disabled}
        after={sendAt}
        open={openOption === "remindMe"}
        onOpenChange={(open) => setOpenOption(open ? "remindMe" : null)}
        shortcut="remindMe"
        shortcutOwnerId={shortcutOwnerId}
      />
    </>
  );
});

function DeliveryTimePicker({
  label,
  value,
  onChange,
  disabled,
  after,
  open,
  onOpenChange,
  shortcut,
  shortcutOwnerId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  after?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcut: "sendLater" | "remindMe";
  shortcutOwnerId: string;
}) {
  const { t, i18n } = useLingui();
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const isReminder = shortcut === "remindMe";
  const dateTimeLabel = isReminder
    ? t`Remind me date and time`
    : t`Send later date and time`;
  const earliest = Math.max(Date.now(), after ? new Date(after).getTime() : 0);
  useEffect(() => {
    if (!open) {
      setCustom("");
      setShowCustom(false);
    }
  }, [open]);
  const choose = (date: Date) => {
    onChange(date.toISOString());
    setShowCustom(false);
    onOpenChange(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setShowCustom(false);
      }}
    >
      <Tooltip shortcuts={[shortcut]} showShortcutLabels={!!value}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghostMuted"
            size="sm"
            disabled={disabled}
            className="px-2 text-xs hover:bg-transparent"
            aria-label={label}
          >
            {value
              ? new Date(value).toLocaleString(i18n.locale, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : label}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        className="w-72 p-1"
        align="start"
        data-compose-shortcut-owner={shortcutOwnerId}
        role="dialog"
        aria-label={label}
      >
        {showCustom ? (
          <div className="space-y-3 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-1 h-7 gap-1 px-1 text-xs"
              onClick={() => setShowCustom(false)}
            >
              <ChevronLeftIcon className="size-3.5" />
              <Trans>返回</Trans>
            </Button>
            <label className="block text-xs text-muted-foreground">
              <Trans>选择日期和时间</Trans>
              <input
                aria-label={dateTimeLabel}
                type="datetime-local"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                className="mt-2 w-full rounded-md border border-input bg-background p-2 text-sm text-foreground"
              />
            </label>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!custom || new Date(custom).getTime() <= earliest}
              onClick={() => choose(new Date(custom))}
            >
              <Trans>设置时间</Trans>
            </Button>
          </div>
        ) : (
          <>
            {isReminder && (
              <p className="px-2 py-2 text-xs font-medium text-muted-foreground">
                <Trans>未收到回复时提醒我</Trans>
              </p>
            )}
            {[1, 2, 7].map((days) => {
              const date = new Date(earliest);
              date.setDate(date.getDate() + days);
              date.setHours(9, 0, 0, 0);
              return (
                <Button
                  key={days}
                  type="button"
                  variant="ghost"
                  className="flex h-9 w-full justify-between gap-3 px-2 text-xs font-normal"
                  onClick={() => choose(date)}
                >
                  <span>
                    {after
                      ? t`${plural(days, { one: "发送后 # 天", other: "发送后 # 天" })}`
                      : days === 1
                        ? t`明天早上`
                        : t`${plural(days, { one: "# 天后", other: "# 天后" })}`}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {date.toLocaleDateString(i18n.locale, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · 9:00
                  </span>
                </Button>
              );
            })}
            <div className="my-1 border-t" />
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-xs font-normal"
              onClick={() => setShowCustom(true)}
            >
              <CalendarDaysIcon className="size-3.5 text-muted-foreground" />
              <Trans>选择日期和时间</Trans>
              <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghostMuted"
                className="h-9 w-full justify-start gap-2 px-2 text-xs font-normal"
                onClick={() => {
                  onChange("");
                  onOpenChange(false);
                }}
              >
                <XIcon className="size-3.5" />
                <Trans>清除时间</Trans>
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
