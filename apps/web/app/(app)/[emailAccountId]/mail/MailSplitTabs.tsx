"use client";

import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { getMailCategories } from "@/app/(app)/[emailAccountId]/mail/MailSidebar";
import {
  NewSplitDialog,
  type ExistingSplit,
} from "@/app/(app)/[emailAccountId]/mail/NewSplitDialog";
import {
  SplitTabs,
  type MailSplitTab,
} from "@/app/(app)/[emailAccountId]/mail/SplitTabs";
import { useSplitCounts } from "@/app/(app)/[emailAccountId]/mail/use-split-counts";
import type { SystemType } from "@/generated/prisma/enums";
import { useLabels } from "@/hooks/useLabels";
import { useMailSettings } from "@/hooks/useMailSettings";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  buildMailSplitFromPromptAction,
  createMailSplitAction,
  deleteMailSplitAction,
  reorderMailSplitsAction,
  updateMailSplitAction,
} from "@/utils/actions/mail-split";
import { toggleRuleAction } from "@/utils/actions/rule";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { getActionErrorMessage } from "@/utils/error";
import { GmailLabel } from "@/utils/gmail/label";
import type { MailSplitFilterDraft } from "@/utils/split-inbox/split-filters";
import type {
  MailSplit,
  PortableLabelSplit,
} from "@/utils/split-inbox/split-query";
import type { EmailLabels } from "@/providers/email-label-types";

/**
 * 分栏标签栏，以及用于创建、编辑和排序分栏的对话框。
 * 分栏编辑状态保存在这里，标签栏已记忆化，这样会话
 * 导航不会重新渲染它。
 */
export const MailSplitTabs = memo(function MailSplitTabs({
  splits,
  activeSplitId,
  onSelectSplit,
  isAllAccounts,
  getSenders,
  countAccountIds,
  portableLabelSplits,
  labelsByAccount,
  leading,
}: {
  splits: (MailSplit & MailSplitTab)[];
  activeSplitId: string | null;
  onSelectSplit: (splitId: string | null) => void;
  isAllAccounts: boolean;
  /** 用户有往来的发件人，在描述分栏时读取。 */
  getSenders: () => string[];
  /** 各分栏计数所涵盖的账号。 */
  countAccountIds: string[];
  portableLabelSplits?: PortableLabelSplit[];
  labelsByAccount?: Record<string, EmailLabels>;
  leading?: ReactNode;
}) {
  const { emailAccountId, provider } = useAccount();
  const isGoogle = isGoogleProvider(provider);
  const isOutlook = isMicrosoftProvider(provider);
  const { userLabels: allLabels, mutate: mutateLabels } = useLabels();
  const { data: settings, mutate: mutateSettings } = useMailSettings();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);
  const countsById = useSplitCounts({
    accountIds: countAccountIds,
    splits,
    enabled: true,
    portableLabelSplits,
    labelsByAccount,
  });

  const labelChoices = useMemo(
    () =>
      [
        ...allLabels,
        ...(isGoogle ? [{ id: GmailLabel.IMPORTANT, name: "重要" }] : []),
      ].map((label) => ({
        id: `label:${label.id}`,
        name: label.name,
        value: label.id,
      })),
    [allLabels, isGoogle],
  );
  const categoryChoices = useMemo(
    () =>
      getMailCategories({ isGoogle, isOutlook }).map((category) => ({
        id: `category:${category.type}`,
        name: category.name,
        value: category.type,
      })),
    [isGoogle, isOutlook],
  );

  const savedSplits: ExistingSplit[] = useMemo(
    () =>
      (settings?.splits ?? []).map((split) => ({
        id: split.id,
        name: split.name,
        matchAll: split.matchAll,
        filters: split.filters,
      })),
    [settings?.splits],
  );
  const editingSplit =
    savedSplits.find((split) => split.id === editingSplitId) ?? null;

  const onCreate = useCallback(
    async (draft: {
      name: string;
      matchAll: boolean;
      filters: MailSplitFilterDraft[];
    }) => {
      const result = await createMailSplitAction(emailAccountId, draft);
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }
      await mutateSettings();
      const split = result?.data?.split;
      if (split) onSelectSplit(split.id);
      return true;
    },
    [emailAccountId, mutateSettings, onSelectSplit],
  );

  const onUpdate = useCallback(
    async (draft: {
      id: string;
      name: string;
      matchAll: boolean;
      filters: MailSplitFilterDraft[];
    }) => {
      const result = await updateMailSplitAction(emailAccountId, draft);
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }
      await mutateSettings();
      return true;
    },
    [emailAccountId, mutateSettings],
  );

  const onDescribe = useCallback(
    async (prompt: string) => {
      const result = await buildMailSplitFromPromptAction(emailAccountId, {
        prompt,
        options: [
          ...labelChoices.map((label) => ({
            id: label.id,
            name: label.name,
            kind: "LABEL" as const,
            value: label.value,
          })),
          ...categoryChoices.map((category) => ({
            id: category.id,
            name: category.name,
            kind: "CATEGORY" as const,
            value: category.value,
          })),
        ],
        senders: getSenders(),
      });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return null;
      }
      return result?.data ?? null;
    },
    [categoryChoices, emailAccountId, getSenders, labelChoices],
  );

  const onReorder = useCallback(
    async (ids: string[]) => {
      const result = await reorderMailSplitsAction(emailAccountId, { ids });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        await mutateSettings();
        return false;
      }
      await mutateSettings();
      return true;
    },
    [emailAccountId, mutateSettings],
  );

  const onDelete = useCallback(
    async (splitId: string) => {
      const result = await deleteMailSplitAction(emailAccountId, {
        id: splitId,
      });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }
      if (activeSplitId === splitId) onSelectSplit(null);
      await mutateSettings();
      return true;
    },
    [activeSplitId, emailAccountId, mutateSettings, onSelectSplit],
  );

  const onToggleSystemType = useCallback(
    async (systemType: SystemType, enabled: boolean) => {
      const result = await toggleRuleAction(emailAccountId, {
        systemType,
        enabled,
      });
      if (result?.serverError || result?.validationErrors) {
        toast.error(getActionErrorMessage(result));
        return false;
      }
      await Promise.all([mutateSettings(), mutateLabels()]);
      return true;
    },
    [emailAccountId, mutateLabels, mutateSettings],
  );

  return (
    <>
      <SplitTabs
        splits={splits}
        countsById={countsById}
        leading={leading}
        activeSplitId={activeSplitId}
        onSelect={onSelectSplit}
        onDelete={onDelete}
        onEdit={
          isAllAccounts
            ? undefined
            : (splitId) => {
                setEditingSplitId(splitId);
                setIsDialogOpen(true);
              }
        }
        onNewSplit={() => {
          setEditingSplitId(null);
          setIsDialogOpen(true);
        }}
        canCreateSplits={!isAllAccounts}
      />
      {!isAllAccounts && (
        <NewSplitDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) setEditingSplitId(null);
          }}
          labels={labelChoices}
          categories={categoryChoices}
          existingSplits={savedSplits}
          editing={editingSplit}
          supportsStarred={!isOutlook}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onReorder={onReorder}
          onEdit={setEditingSplitId}
          onDescribe={onDescribe}
          onToggleSystemType={onToggleSystemType}
        />
      )}
    </>
  );
});
