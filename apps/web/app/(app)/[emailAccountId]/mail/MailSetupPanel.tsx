"use client";

import { useMemo, useState } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CheckIcon, LayersIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { isBundleEligibleSplit } from "@/app/(app)/[emailAccountId]/mail/inbox-bundles";
import type { MailLayoutMode } from "@/app/(app)/[emailAccountId]/mail/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  MailLayout,
  MailSplitFilterKind,
  SystemType,
} from "@/generated/prisma/enums";
import { useRules } from "@/hooks/useRules";
import { useMailSettings } from "@/hooks/useMailSettings";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  createMailSplitAction,
  deleteMailSplitAction,
  setMailSplitBundleAction,
  setMailSplitHideFromAllAction,
} from "@/utils/actions/mail-split";
import type { UpdateMailPreferencesBody } from "@/utils/actions/mail-split.validation";
import { cn } from "@/utils";
import { getActionErrorMessage } from "@/utils/error";
import { getDefaultMailSplitDrafts } from "@/utils/split-inbox/default-splits";
import {
  OTHER_SPLIT_ID,
  type MailSplit,
} from "@/utils/split-inbox/split-query";

type Step = "layout" | "tabs" | "all" | "default" | "bundles";

const STEP_QUESTIONS: Record<Step, MessageDescriptor> = {
  layout: msg`您希望如何阅读邮件？`,
  tabs: msg`您需要哪些标签页？`,
  all: msg`“全部”应显示什么内容？`,
  default: msg`应优先打开哪个标签页？`,
  bundles: msg`是否合并低优先级邮件？`,
};

/**
 * 悬浮在邮件客户端上方而不是将其覆盖；每个选择都会即时保存，
 * 因此卡片后的收件箱就是预览。
 */
export function MailSetupPanel({
  splits,
  layout,
  bundleInbox,
  defaultSplitId,
  onUpdatePreferences,
  onToggleBundleInbox,
  onSelectSplit,
  onClose,
  canHideFromAll,
  supportsStarred,
}: {
  /** 当前显示的标签页，包括“其他”。 */
  splits: MailSplit[];
  layout: MailLayoutMode;
  bundleInbox: boolean;
  defaultSplitId: string | null;
  onUpdatePreferences: (preferences: UpdateMailPreferencesBody) => void;
  onToggleBundleInbox: () => Promise<void>;
  onSelectSplit: (splitId: string | null) => void;
  onClose: () => void;
  canHideFromAll: boolean;
  supportsStarred: boolean;
}) {
  const { t, i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const { data: rules } = useRules();
  const { data: settings, mutate: mutateSettings } = useMailSettings();
  const [stepIndex, setStepIndex] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isBundlePending, setIsBundlePending] = useState(false);

  const steps: Step[] = canHideFromAll
    ? ["layout", "tabs", "all", "default", "bundles"]
    : ["layout", "tabs", "default", "bundles"];
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  const allSplit = splits.find(
    (split) => !split.filters.length && split.id !== OTHER_SPLIT_ID,
  );
  const filteredSplits = splits.filter((split) => split.filters.length > 0);
  const defaultId = splits.some((split) => split.id === defaultSplitId)
    ? defaultSplitId
    : splits[0]?.id;

  // The category tabs onboarding sets up from the account's labelling rules,
  // then the two that need no label.
  const tabChoices = useMemo(
    () => [
      ...getDefaultMailSplitDrafts(
        (rules ?? []).filter(
          (rule) => rule.enabled && rule.systemType !== SystemType.OTP,
        ),
      ).map(({ name, filters }) => ({ name, filters })),
      {
        name: "未读",
        filters: [{ kind: MailSplitFilterKind.UNREAD, value: null }],
      },
      ...(supportsStarred
        ? [
            {
              name: "已加星标",
              filters: [{ kind: MailSplitFilterKind.STARRED, value: null }],
            },
          ]
        : []),
    ],
    [rules, supportsStarred],
  );
  // 名称和 matchAll 也必须匹配，以免开关误删
  // 恰好共享相同筛选条件的自定义标签页。
  const findTabSplit = ({ name, filters }: (typeof tabChoices)[number]) =>
    settings?.splits.find(
      (split) =>
        split.name.toLowerCase() === name.toLowerCase() &&
        split.matchAll &&
        split.filters.length === filters.length &&
        filters.every((filter) =>
          split.filters.some(
            (existing) =>
              existing.kind === filter.kind && existing.value === filter.value,
          ),
        ),
    );

  const goTo = (index: number) => {
    setStepIndex(index);
    // 这些步骤会改变收件箱标签页的内容，因此切换到该标签页。
    if ((steps[index] === "all" || steps[index] === "bundles") && allSplit)
      onSelectSplit(allSplit.id);
  };

  const runSplitChange = async (
    id: string,
    change: () => Promise<
      Parameters<typeof getActionErrorMessage>[0] | undefined
    >,
  ) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await change();
      if (result?.serverError || result?.validationErrors)
        toast.error(getActionErrorMessage(result));
    } catch {
      toast.error(t`无法保存该设置`);
    } finally {
      // 同时丢弃服务器从未保存的乐观开关状态。
      // 在此之前保持锁定，确保下次点击读取最新设置。
      await mutateSettings().catch(() => undefined);
      setBusyId(null);
    }
  };

  const toggleTab = (choice: (typeof tabChoices)[number]) => {
    const existing = findTabSplit(choice);
    return runSplitChange(choice.name, () =>
      existing
        ? deleteMailSplitAction(emailAccountId, { id: existing.id })
        : createMailSplitAction(emailAccountId, { ...choice, matchAll: true }),
    );
  };

  const setSplitFlag = (
    id: string,
    patch: { hideFromAll: boolean } | { bundleInInbox: boolean },
  ) => {
    if (busyId) return;
    if (settings) {
      mutateSettings(
        {
          ...settings,
          splits: settings.splits.map((split) =>
            split.id === id ? { ...split, ...patch } : split,
          ),
        },
        { revalidate: false },
      );
    }
    return runSplitChange(id, () =>
      "hideFromAll" in patch
        ? setMailSplitHideFromAllAction(emailAccountId, { id, ...patch })
        : setMailSplitBundleAction(emailAccountId, { id, ...patch }),
    );
  };

  return (
    <section
      aria-label={t`Mail setup`}
      className="fixed right-4 bottom-4 left-4 z-40 flex max-h-[min(32rem,calc(100vh-2rem))] flex-col overflow-hidden rounded-xl border border-blue-200 bg-popover dark:border-blue-900 text-popover-foreground text-sm shadow-xl sm:left-auto sm:w-96"
    >
      <div className="h-1 bg-blue-100 dark:bg-blue-950" aria-hidden>
        <div
          className="h-full rounded-r-full [background-image:var(--button-gradient)] transition-[width] duration-300"
          style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
      <header className="bg-gradient-to-b from-blue-50 to-transparent px-4 pt-3 pb-2 dark:from-blue-950/40">
        <div className="flex items-center justify-between">
          <span className="font-medium text-blue-600 dark:text-blue-400">
            <Trans>
              Step {stepIndex + 1} of {steps.length}
            </Trans>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t`Close mail setup`}
            className="-mr-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <h2 className="mt-1 font-medium text-base">
          {i18n._(STEP_QUESTIONS[step])}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {step === "layout" && (
          <div className="grid grid-cols-2 gap-2 px-2 pb-1">
            {(["list", "split"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={layout === mode}
                onClick={() =>
                  layout !== mode &&
                  onUpdatePreferences({
                    layout:
                      mode === "split" ? MailLayout.SPLIT : MailLayout.LIST,
                  })
                }
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-muted/50",
                  layout === mode &&
                    "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500 dark:bg-blue-950/30",
                )}
              >
                <LayoutSketch mode={mode} />
                {mode === "list" ? <Trans>列表</Trans> : <Trans>分类</Trans>}
              </button>
            ))}
          </div>
        )}

        {step === "tabs" &&
          tabChoices.map((choice) => (
            <SwitchRow
              key={choice.name}
              label={choice.name}
              checked={!!findTabSplit(choice)}
              disabled={!!busyId}
              onCheckedChange={() => toggleTab(choice)}
            />
          ))}

        {step === "all" &&
          (filteredSplits.length ? (
            filteredSplits.map((split) => (
              <SwitchRow
                key={split.id}
                label={split.name}
                checked={!split.hideFromAll}
                disabled={!!busyId}
                onCheckedChange={(checked) =>
                  setSplitFlag(split.id, { hideFromAll: !checked })
                }
              />
            ))
          ) : (
            <p className="px-2 py-1.5 text-muted-foreground">
              <Trans>暂无标签页</Trans>
            </p>
          ))}

        {step === "default" && (
          <fieldset>
            <legend className="sr-only">
              <Trans>默认标签页</Trans>
            </legend>
            {splits.map((split) => (
              <label
                key={split.id}
                className="flex cursor-pointer items-center rounded-md px-2 py-1.5 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="default-tab"
                  value={split.id}
                  checked={split.id === defaultId}
                  // Handled on click, which also fires for the option already
                  // shown as checked (the fallback when nothing is saved yet).
                  onChange={() => undefined}
                  onClick={() => {
                    if (defaultSplitId !== split.id)
                      onUpdatePreferences({ defaultSplitId: split.id });
                    onSelectSplit(split.id);
                  }}
                  className="sr-only"
                />
                <span className="flex-1 truncate">{split.name}</span>
                {split.id === defaultId && <CheckIcon className="size-4" />}
              </label>
            ))}
          </fieldset>
        )}

        {step === "bundles" && (
          <>
            <BundleSketch bundled={bundleInbox} />
            <SwitchRow
              label={t`Bundle my inbox`}
              checked={bundleInbox}
              disabled={isBundlePending}
              onCheckedChange={async () => {
                setIsBundlePending(true);
                try {
                  await onToggleBundleInbox();
                } finally {
                  setIsBundlePending(false);
                }
              }}
            />
            {bundleInbox &&
              (settings?.splits ?? [])
                .filter(isBundleEligibleSplit)
                .map((split) => (
                  <SwitchRow
                    key={split.id}
                    label={split.name}
                    inset
                    checked={split.bundleInInbox}
                    disabled={!!busyId}
                    onCheckedChange={(checked) =>
                      setSplitFlag(split.id, { bundleInInbox: checked })
                    }
                  />
                ))}
          </>
        )}
      </div>

      <footer className="flex justify-end gap-2 border-t px-4 py-3">
        {stepIndex > 0 && (
          <Button size="sm" variant="ghost" onClick={() => goTo(stepIndex - 1)}>
            <Trans>上一步</Trans>
          </Button>
        )}
        <Button
          size="sm"
          variant="gradient"
          onClick={() => (isLastStep ? onClose() : goTo(stepIndex + 1))}
        >
          {isLastStep ? <Trans>完成</Trans> : <Trans>下一步</Trans>}
        </Button>
      </footer>
    </section>
  );
}

function SwitchRow({
  label,
  checked,
  disabled,
  inset,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  inset?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Switch inside is the control
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted",
        inset && "pl-6",
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

function LayoutSketch({ mode }: { mode: MailLayoutMode }) {
  const rows = (
    <div className="flex flex-1 flex-col gap-1">
      {[0, 1, 2, 3].map((row) => (
        <span key={row} className="h-1 rounded-full bg-muted-foreground/30" />
      ))}
    </div>
  );
  return (
    <div className="flex h-12 gap-1.5 rounded-md bg-muted p-2" aria-hidden>
      {rows}
      {mode === "split" && <div className="flex-1 rounded-sm bg-background" />}
    </div>
  );
}

/** Three rows from one tab folding into a single row as bundling turns on. */
function BundleSketch({ bundled }: { bundled: boolean }) {
  const row = (key: number, className?: string) => (
    <div key={key} className={cn("flex items-center gap-2", className)}>
      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
      <span className="h-1 flex-1 rounded-full bg-muted-foreground/25" />
    </div>
  );
  return (
    <div
      className="mx-2 mb-2 flex flex-col gap-1.5 rounded-lg bg-muted p-3"
      aria-hidden
    >
      {row(0)}
      {bundled ? (
        <div className="flex items-center gap-2 rounded-md bg-blue-100 px-1.5 py-1 dark:bg-blue-950">
          <LayersIcon className="size-3 text-blue-600 dark:text-blue-400" />
          <span className="h-1 w-16 rounded-full bg-blue-400/60" />
          <span className="ml-auto rounded-full bg-blue-600 px-1.5 font-medium text-[10px] text-white leading-4">
            3
          </span>
        </div>
      ) : (
        [1, 2, 3].map((key) => row(key, "[&>span:first-child]:bg-blue-500"))
      )}
      {row(4)}
    </div>
  );
}
