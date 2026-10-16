"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
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
import { useLabels } from "@/hooks/useLabels";
import { useAccount } from "@/providers/EmailAccountProvider";
import { createLabelAction } from "@/utils/actions/mail";
import { getActionErrorMessage } from "@/utils/error";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import type { MailClient } from "@inboxzero/mail-core/engine";
import { randomUuid } from "@/utils/uuid";

const GMAIL_CATEGORY_NAMES: Record<string, string> = {
  CATEGORY_PERSONAL: "个人",
  CATEGORY_SOCIAL: "社交",
  CATEGORY_PROMOTIONS: "促销",
  CATEGORY_UPDATES: "更新",
  CATEGORY_FORUMS: "论坛",
};

export function LabelPickerDialog({
  threadIds,
  onClose,
  onApplied,
  mode = "label",
}: {
  threadIds: string[];
  onClose: () => void;
  onApplied: (threadIds: string[], labelId: string) => void;
  mode?: "label" | "move";
}) {
  const { emailAccountId } = useAccount();
  const client = useOptionalMailClient();
  const { userLabels, isLoading, error, mutate } = useLabels(emailAccountId);
  const [search, setSearch] = useState("");
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const [remainingThreadIds, setRemainingThreadIds] = useState(threadIds);
  const createdLabel = useRef<{ name: string; id: string } | null>(null);
  const isMove = mode === "move";
  const name = search.trim();
  const labels = useMemo(
    () =>
      userLabels
        .map((label) => ({
          ...label,
          displayName: getLabelDisplayName(label.id, label.name),
        }))
        .sort(
          (a, b) =>
            a.displayName.localeCompare(b.displayName, "en") ||
            a.id.localeCompare(b.id, "en"),
        ),
    [userLabels],
  );
  const canCreate =
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
          mutate().catch(() => {});
        }
      }
      if (!client) throw new Error("邮件引擎不可用");
      const { succeededThreadIds, failedThreadIds, error } =
        await applyEngineLabels({
          client,
          emailAccountId,
          threadIds: remainingThreadIds,
          labelId: id,
          removeFromInbox: isMove,
        });
      if (succeededThreadIds.length) {
        onApplied(succeededThreadIds, id);
        toast.success(getSuccessMessage(mode, succeededThreadIds.length));
      }
      setRemainingThreadIds(failedThreadIds);
      if (failedThreadIds.length) {
        toast.error(getPartialFailureMessage(mode, failedThreadIds.length), {
          description: error instanceof Error ? error.message : undefined,
        });
      } else onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isMove
            ? "无法移动会话。请重试。"
            : "无法应用标签。请重试。",
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
          {isMove ? "移动会话" : "为会话添加标签"}
        </DialogTitle>
        <Command className="[&_[cmdk-input-wrapper]>svg]:hidden">
          <CommandInput
            aria-label="搜索标签"
            className="pr-8"
            placeholder={isMove ? "移至…" : "标记为…"}
            value={search}
            onValueChange={setSearch}
            disabled={isPending}
          />
          <LoadingContent loading={isLoading} error={error}>
            <CommandList aria-busy={isPending}>
              <CommandEmpty>没有匹配的标签。</CommandEmpty>
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
                    <span className="break-all">创建“{name}”</span>
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
              {isMove ? "移动中…" : "正在应用标签…"}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getSuccessMessage(mode: "label" | "move", count: number) {
  if (mode === "move") return count === 1 ? "已移动" : `已移动 ${count} 个会话`;
  return count === 1 ? "标签已应用" : `已为 ${count} 个会话应用标签`;
}

function getPartialFailureMessage(mode: "label" | "move", count: number) {
  const action = mode === "move" ? "移动" : "标记";
  return `无法${action} ${count} 个会话。请选择一个标签重试。`;
}

function getLabelDisplayName(id: string, name: string) {
  return GMAIL_CATEGORY_NAMES[id] ?? name;
}

async function applyEngineLabels({
  client,
  emailAccountId,
  threadIds,
  labelId,
  removeFromInbox,
}: {
  client: MailClient;
  emailAccountId: string;
  threadIds: string[];
  labelId: string;
  removeFromInbox: boolean;
}) {
  const succeededThreadIds: string[] = [];
  const failedThreadIds: string[] = [];
  let error: unknown;
  for (const threadId of threadIds) {
    try {
      const diagnostics = await client.getDiagnostics(emailAccountId);
      const label = await client.submitConversations({
        accountId: emailAccountId,
        commandId: randomUuid(),
        conversations: [
          { accountId: emailAccountId, conversationId: threadId },
        ],
        change: {
          kind: "set_membership",
          membership: "label",
          id: labelId,
          present: true,
        },
        observedRevision: diagnostics.revision,
      });
      if (label.status === "rejected") {
        failedThreadIds.push(threadId);
        continue;
      }
      if (removeFromInbox) {
        const archived = await client.submitConversations({
          accountId: emailAccountId,
          commandId: randomUuid(),
          conversations: [
            { accountId: emailAccountId, conversationId: threadId },
          ],
          change: { kind: "archive" },
          observedRevision: (await client.getDiagnostics(emailAccountId))
            .revision,
        });
        if (archived.status === "rejected") {
          failedThreadIds.push(threadId);
          continue;
        }
      }
      succeededThreadIds.push(threadId);
    } catch (cause) {
      error = cause;
      failedThreadIds.push(threadId);
    }
  }
  return { succeededThreadIds, failedThreadIds, error };
}
