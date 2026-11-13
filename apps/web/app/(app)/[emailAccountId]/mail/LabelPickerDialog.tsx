"use client";

import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { LoadingContent } from "@/components/LoadingContent";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFolders } from "@/hooks/useFolders";
import { useLabelCounts } from "@/hooks/useLabelCounts";
import { isLabelsKey, useLabels } from "@/hooks/useLabels";
import type { EmailLabel } from "@/providers/email-label-types";
import { useAccount } from "@/providers/EmailAccountProvider";
import { createLabelAction } from "@/utils/actions/mail";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { getActionErrorMessage } from "@/utils/error";
import {
  FOLDER_SEPARATOR,
  flattenOutlookFolders,
} from "@/utils/outlook/folders";
import { getLabelTree, type SidebarLabel } from "./label-tree";
import { splitLabelsByListVisibility } from "./label-visibility";

const GMAIL_CATEGORY_NAMES: Record<string, MessageDescriptor> = {
  CATEGORY_PERSONAL: msg`个人`,
  CATEGORY_SOCIAL: msg`社交`,
  CATEGORY_PROMOTIONS: msg`促销`,
  CATEGORY_UPDATES: msg`更新`,
  CATEGORY_FORUMS: msg`论坛`,
};

export function LabelPickerDialog({
  threadKeys,
  onClose,
  onApply,
  mode = "label",
}: {
  threadKeys: string[];
  onClose: () => void;
  /** 将变更加入队列，并以已排队的会话键完成。 */
  onApply: (
    threadKeys: string[],
    target: { kind: "label" | "folder"; id: string },
  ) => Promise<string[]>;
  mode?: "label" | "move";
}) {
  const { t, i18n } = useLingui();
  const { emailAccountId, provider } = useAccount();
  const isMove = mode === "move";
  // Outlook 类别不会改变邮件所在位置，因此移动操作以真实文件夹为目标。
  const isFolderMove = isMove && isMicrosoftProvider(provider);
  const {
    userLabels,
    isLoading: isLoadingLabels,
    error: labelsError,
  } = useLabels(emailAccountId);
  const { countsById } = useLabelCounts({
    emailAccountId,
    labels: userLabels,
    folders: [],
  });
  const { mutate } = useSWRConfig();
  const {
    folders,
    isLoading: isLoadingFolders,
    error: foldersError,
  } = useFolders(isFolderMove ? provider : "", emailAccountId);
  const [search, setSearch] = useState("");
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const [remainingThreadKeys, setRemainingThreadKeys] = useState(threadKeys);
  const createdLabel = useRef<{ name: string; id: string } | null>(null);
  const name = search.trim();
  const labels = useMemo(() => {
    if (isFolderMove) {
      return flattenOutlookFolders(folders)
        .filter((folder) => !folder.systemType)
        .map((folder) => ({
          id: folder.id,
          name: folder.displayName,
          displayName: folder.path.split(FOLDER_SEPARATOR).join(" / "),
        }))
        .sort(
          (a, b) =>
            a.displayName.localeCompare(b.displayName, "en") ||
            a.id.localeCompare(b.id, "en"),
        );
    }
    const { visibleLabels, hiddenLabels } = splitLabelsByListVisibility({
      labels: userLabels,
      countsById,
    });
    return [
      ...flattenLabelTree(
        getLabelTree(visibleLabels, !isMicrosoftProvider(provider)),
      ),
      ...hiddenLabels,
    ].map((label) => ({
      id: label.id,
      name: label.name,
      displayName: getLabelDisplayName(i18n, label.id, label.name),
    }));
  }, [isFolderMove, folders, userLabels, countsById, provider, i18n]);
  const canCreate =
    !isFolderMove &&
    name.length > 0 &&
    !labels.some(
      (label) => label.displayName.toLowerCase() === name.toLowerCase(),
    );

  async function apply(labelId?: string) {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    try {
      let id = labelId;
      if (!id) {
        if (createdLabel.current?.name === name) id = createdLabel.current.id;
        else {
          const result = await createLabelAction(emailAccountId, { name });
          if (!result?.data?.id)
            throw new Error(getActionErrorMessage(result ?? {}));
          id = result.data.id;
          createdLabel.current = { name, id };
          mutate(isLabelsKey).catch(() => {});
        }
      }
      const appliedKeys = new Set(
        await onApply(remainingThreadKeys, {
          kind: isFolderMove ? "folder" : "label",
          id,
        }),
      );
      const failedKeys = remainingThreadKeys.filter(
        (key) => !appliedKeys.has(key),
      );
      // The failure was already reported; stay open so a pick retries it.
      if (failedKeys.length) setRemainingThreadKeys(failedKeys);
      else onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isMove
            ? t`无法移动会话。请重试。`
            : t`无法应用标签。请重试。`,
      );
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        hideCloseButton
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DialogTitle className="sr-only">
          {isMove ? <Trans>移动会话</Trans> : <Trans>为会话添加标签</Trans>}
        </DialogTitle>
        <Command className="[&_[cmdk-input-wrapper]>svg]:hidden">
          <CommandInput
            aria-label={isFolderMove ? t`搜索文件夹` : t`搜索标签`}
            className="pr-8"
            placeholder={isMove ? t`移动到…` : t`添加标签…`}
            value={search}
            onValueChange={setSearch}
            disabled={isPending}
          />
          <LoadingContent
            loading={isFolderMove ? isLoadingFolders : isLoadingLabels}
            error={isFolderMove ? foldersError : labelsError}
          >
            <CommandList aria-busy={isPending}>
              <CommandEmpty>
                {isFolderMove ? (
                  <Trans>没有匹配的文件夹。</Trans>
                ) : (
                  <Trans>没有匹配的标签。</Trans>
                )}
              </CommandEmpty>
              <CommandGroup>
                {labels.map((label) => (
                  <CommandItem
                    key={label.id}
                    value={label.id}
                    keywords={[label.name, label.displayName]}
                    onSelect={() => apply(label.id)}
                    disabled={isPending}
                  >
                    <span className="break-all">{label.displayName}</span>
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem
                    value={`create:${name}`}
                    onSelect={() => apply()}
                    disabled={isPending}
                  >
                    <span className="break-all">
                      <Trans>创建“{name}”</Trans>
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </LoadingContent>
        </Command>
        {isPending && (
          <div
            className="absolute top-3.5 right-3 text-muted-foreground"
            role="status"
          >
            <Loader2Icon aria-hidden className="size-4 animate-spin" />
            <span className="sr-only">
              {isMove ? <Trans>正在移动…</Trans> : <Trans>正在应用标签…</Trans>}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getLabelDisplayName(i18n: I18n, id: string, name: string) {
  const categoryName = GMAIL_CATEGORY_NAMES[id];
  return categoryName ? i18n._(categoryName) : name;
}

function flattenLabelTree(nodes: SidebarLabel[]): EmailLabel[] {
  return nodes.flatMap((node) => [
    node.label,
    ...flattenLabelTree(node.children),
  ]);
}
