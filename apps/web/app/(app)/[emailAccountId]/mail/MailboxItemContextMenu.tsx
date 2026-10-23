"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { EmailLabelColor } from "@/utils/email/types";
import {
  labelVisibility,
  messageVisibility,
  type LabelVisibility,
  type MessageVisibility,
} from "@/utils/gmail/constants";
import { cn } from "@/utils";

export type MailboxItem = {
  id: string;
  kind: "label" | "folder";
  name: string;
};

export type MailboxItemEdit =
  | MailboxItem
  | {
      id: string;
      kind: "label";
      color?: EmailLabelColor;
      name?: string;
      labelListVisibility?: LabelVisibility;
      messageListVisibility?: MessageVisibility;
    };

/** Gmail 的逐标签可见性，以标签当前所设置的值表示。 */
export type MailboxItemVisibility = {
  labelList?: string;
  messageList?: string;
};

const LABEL_LIST_OPTIONS = [
  { value: labelVisibility.labelShow, name: "显示" },
  { value: labelVisibility.labelShowIfUnread, name: "仅在未读时显示" },
  { value: labelVisibility.labelHide, name: "隐藏" },
] as const;

const MESSAGE_LIST_OPTIONS = [
  { value: messageVisibility.show, name: "显示" },
  { value: messageVisibility.hide, name: "隐藏" },
] as const;

export type MailboxItemColorOption = EmailLabelColor & { name: string };

export function MailboxItemContextMenu({
  children,
  item,
  typeName,
  editMode,
  currentColor,
  colorOptions = [],
  visibility,
  onEdit,
  onDelete,
}: {
  children: ReactNode;
  item: MailboxItem;
  typeName: string;
  editMode: "name" | "color" | "name-and-color";
  currentColor?: {
    backgroundColor?: string | null;
    textColor?: string | null;
  };
  colorOptions?: readonly MailboxItemColorOption[];
  /** 对没有可见性设置的服务商省略，这会隐藏菜单中的相应部分。 */
  visibility?: MailboxItemVisibility;
  onEdit: (edit: MailboxItemEdit) => Promise<boolean>;
  onDelete: (item: MailboxItem) => Promise<boolean>;
}) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState<EmailLabelColor | null>(null);
  const showsName = editMode !== "color";
  const showsColor = editMode !== "name";

  const openEditor = () => {
    setName(item.name);
    setColor(
      colorOptions.find(
        (option) =>
          option.backgroundColor.toLowerCase() ===
          currentColor?.backgroundColor?.toLowerCase(),
      ) ?? (editMode === "color" ? (colorOptions[0] ?? null) : null),
    );
    setIsEditOpen(true);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (showsName && !nextName) return;
    if (showsColor && editMode === "color" && !color) return;

    const nameChanged = showsName && nextName !== item.name;
    const colorChanged = Boolean(
      showsColor &&
        color &&
        (color.backgroundColor.toLowerCase() !==
          currentColor?.backgroundColor?.toLowerCase() ||
          color.textColor.toLowerCase() !==
            currentColor?.textColor?.toLowerCase()),
    );

    if (!nameChanged && !colorChanged) {
      setIsEditOpen(false);
      return;
    }

    setIsSaving(true);
    try {
      const edit: MailboxItemEdit =
        item.kind === "folder"
          ? { ...item, name: nextName }
          : {
              kind: "label",
              id: item.id,
              ...(nameChanged ? { name: nextName } : {}),
              ...(colorChanged && color ? { color } : {}),
            };
      const success = await onEdit(edit);
      if (success) setIsEditOpen(false);
    } catch {
      toast.error(`更新${typeName}失败。请重试。`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateVisibility = async (
    update: Pick<
      Extract<MailboxItemEdit, { kind: "label" }>,
      "labelListVisibility" | "messageListVisibility"
    >,
  ) => {
    try {
      await onEdit({ kind: "label", id: item.id, ...update });
    } catch {
      toast.error(`更新${typeName}失败。请重试。`);
    }
  };

  const deleteItem = async () => {
    setIsDeleting(true);
    try {
      const success = await onDelete(item);
      if (success) setIsDeleteOpen(false);
    } catch {
      toast.error(`删除${typeName}失败。请重试。`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem className="gap-2" onSelect={openEditor}>
            <PencilIcon className="size-4" />
            编辑
          </ContextMenuItem>
          <ContextMenuItem
            className="gap-2 text-destructive focus:text-destructive"
            onSelect={() => setIsDeleteOpen(true)}
          >
            <Trash2Icon className="size-4" />
            删除
          </ContextMenuItem>
          {visibility && (
            <>
              <ContextMenuSeparator />
              <ContextMenuLabel className="text-muted-foreground text-xs">
                在{typeName}列表中
              </ContextMenuLabel>
              <ContextMenuRadioGroup
                value={visibility.labelList ?? labelVisibility.labelShow}
                onValueChange={(value) =>
                  updateVisibility({
                    labelListVisibility: value as LabelVisibility,
                  })
                }
              >
                {LABEL_LIST_OPTIONS.map((option) => (
                  <ContextMenuRadioItem key={option.value} value={option.value}>
                    {option.name}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuLabel className="text-muted-foreground text-xs">
                在邮件列表中
              </ContextMenuLabel>
              <ContextMenuRadioGroup
                value={visibility.messageList ?? messageVisibility.show}
                onValueChange={(value) =>
                  updateVisibility({
                    messageListVisibility: value as MessageVisibility,
                  })
                }
              >
                {MESSAGE_LIST_OPTIONS.map((option) => (
                  <ContextMenuRadioItem key={option.value} value={option.value}>
                    {option.name}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>编辑{typeName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit}>
            {showsName && (
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label={`${typeName}名称`}
                autoFocus
                maxLength={255}
              />
            )}
            {showsColor && (
              <div
                role="radiogroup"
                aria-label={`${typeName}颜色`}
                className={cn(
                  "grid grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] gap-3 py-1",
                  showsName && "mt-5",
                )}
              >
                {colorOptions.map((option) => (
                  <button
                    key={`${option.backgroundColor}-${option.textColor}`}
                    type="button"
                    role="radio"
                    aria-label={option.name}
                    aria-checked={
                      color?.backgroundColor === option.backgroundColor &&
                      color.textColor === option.textColor
                    }
                    onClick={() => setColor(option)}
                    className={cn(
                      "mx-auto size-8 rounded-full border-2 border-background shadow-sm ring-offset-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      color?.backgroundColor === option.backgroundColor &&
                        color.textColor === option.textColor &&
                        "ring-2 ring-ring",
                    )}
                    style={{ backgroundColor: option.backgroundColor }}
                  />
                ))}
              </div>
            )}
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditOpen(false)}
                disabled={isSaving}
              >
                取消
              </Button>
              <Button
                type="submit"
                loading={isSaving}
                disabled={
                  (showsName && !name.trim()) ||
                  (editMode === "color" && !color)
                }
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除{typeName}？</AlertDialogTitle>
            <AlertDialogDescription>
              {item.kind === "folder"
                ? `“${item.name}”及其内容将从你的邮箱中移除。`
                : `“${item.name}”将从你的邮箱中移除。使用它的邮件会保留。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await deleteItem();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
