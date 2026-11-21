import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { i18n } = useLingui();
  return (
    <AlertDialog
      open={warnings.length > 0}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>仍要发送吗？</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {warnings.map((warning) => (
                <p key={warning.type}>
                  {i18n._(getSendWarningMessage(warning))}
                </p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>返回</Trans>
          </AlertDialogCancel>
          <AlertDialogAction onClick={onSendAnyway}>
            <Trans>仍要发送</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function getSendWarningMessage(warning: SendWarning) {
  if (warning.type === "missing-attachment") {
    return msg`你提到了附件，但并未附加任何文件。`;
  }
  return msg`有未填写的占位符：${warning.placeholder}`;
}
