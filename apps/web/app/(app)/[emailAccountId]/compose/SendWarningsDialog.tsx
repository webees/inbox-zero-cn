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
import type { SendWarning } from "./send-warnings";

export function SendWarningsDialog({
  warnings,
  onDismiss,
  onSendAnyway,
}: {
  warnings: SendWarning[];
  onDismiss: () => void;
  onSendAnyway: () => void;
}) {
  return (
    <AlertDialog
      open={warnings.length > 0}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>仍要发送吗？</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {warnings.map((warning) => (
                <p key={warning.type}>{getSendWarningMessage(warning)}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>返回</AlertDialogCancel>
          <AlertDialogAction onClick={onSendAnyway}>仍要发送</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function getSendWarningMessage(warning: SendWarning) {
  if (warning.type === "missing-attachment") {
    return "你提到了附件，但并未添加任何附件。";
  }
  return `有一个未填写的占位符：${warning.placeholder}`;
}
