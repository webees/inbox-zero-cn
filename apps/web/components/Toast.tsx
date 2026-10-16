import { CircleAlert, Loader2, X } from "lucide-react";
import { Toaster as SonnerToaster, toast } from "sonner";
import { Kbd } from "@/components/Kbd";
import { cn } from "@/utils";

// 应用的主色在浅色模式下接近黑色、深色模式下接近白色，
// 因此链接和侧边栏显式使用邮件调色板的蓝色。
const ACCENT_TEXT = "text-blue-600 dark:text-blue-400";

export function toastSuccess(options: {
  title?: string;
  description: string;
  id?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}) {
  // 复用某个撤销 toast 的 id 会替换它，因此其撤销不再适用。
  if (options.id && latestToastUndo?.id === options.id) latestToastUndo = null;
  return toast.success(options.title || options.description, {
    description: options.title ? options.description : undefined,
    id: options.id,
    duration: options.duration,
    action: options.action,
  });
}

export function toastError(options: { title?: string; description: string }) {
  return toast.error(options.title || options.description, {
    description: options.title ? options.description : undefined,
    duration: 10_000,
  });
}

export function toastInfo(options: {
  title: string;
  description: string;
  id?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}) {
  return toast(options.title, {
    description: options.description,
    id: options.id,
    duration: options.duration,
    action: options.action,
  });
}

type ToastUndoHandler = () => void | Promise<void>;

let latestToastUndo: { id: string; onUndo: ToastUndoHandler } | null = null;

export function toastUndo(options: {
  id?: string;
  message: string;
  shortcut?: string;
  duration?: number;
  onUndo: ToastUndoHandler;
}) {
  const id = options.id ?? "undo";
  const onUndo = options.onUndo;
  latestToastUndo = { id, onUndo };
  const release = () => {
    if (latestToastUndo?.onUndo === onUndo) latestToastUndo = null;
  };
  return toast.success(options.message, {
    id,
    duration: options.duration,
    onAutoClose: release,
    onDismiss: release,
    action: {
      label: (
        <>
          撤销
          {options.shortcut && (
            <Kbd className={cn("ml-1.5", ACCENT_TEXT)}>{options.shortcut}</Kbd>
          )}
        </>
      ),
      onClick: onUndo,
    },
  });
}

export async function undoLatestToast() {
  const current = latestToastUndo;
  if (!current) return false;
  latestToastUndo = null;
  toast.dismiss(current.id);
  await current.onUndo();
  return true;
}

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-left"
      closeButton
      visibleToasts={9}
      gap={8}
      icons={{
        success: null,
        info: null,
        warning: <CircleAlert className="size-4 text-amber-500" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        loading: <Loader2 className={cn("size-4 animate-spin", ACCENT_TEXT)} />,
        close: <X className="size-4" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-popover py-3 pl-4 pr-2 text-popover-foreground shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-blue-500 data-[type=error]:before:bg-destructive data-[type=warning]:before:bg-amber-500",
          icon: "relative flex size-4 shrink-0 items-center justify-center",
          content: "min-w-0 flex-1",
          title: "text-sm font-medium leading-5",
          description: "mt-0.5 text-sm leading-5 text-muted-foreground",
          actionButton: cn(
            "inline-flex shrink-0 items-center rounded px-1.5 py-1 text-sm font-medium hover:bg-blue-600/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ACCENT_TEXT,
          ),
          cancelButton:
            "inline-flex shrink-0 items-center rounded px-1.5 py-1 text-sm font-medium text-muted-foreground hover:bg-muted",
          closeButton:
            "order-last inline-flex shrink-0 items-center rounded p-1.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        },
      }}
    />
  );
}
