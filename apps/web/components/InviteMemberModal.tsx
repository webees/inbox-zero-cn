"use client";

import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { PlusIcon, XIcon } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastSuccess, toastError } from "@/components/Toast";
import { TagInput } from "@/components/TagInput";
import {
  inviteMembersAction,
  createOrganizationAndInviteAction,
} from "@/utils/actions/organization";
import { MAX_BULK_INVITES } from "@/utils/actions/organization.validation";
import { useDialogState } from "@/hooks/useDialogState";
import { useAccount } from "@/providers/EmailAccountProvider";
import { isValidEmail } from "@/utils/email";

type InviteRole = "admin" | "member";

type InviteFormValues = {
  invitations: { email: string; role: InviteRole }[];
};

export function InviteMemberModal({
  organizationId,
  onSuccess,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
}: {
  organizationId?: string;
  onSuccess?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const { t } = useLingui();
  const internalState = useDialogState();

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalState.isOpen;
  const onOpenChange = isControlled
    ? controlledOnOpenChange
    : internalState.onToggle;
  const onClose = isControlled
    ? () => controlledOnOpenChange?.(false)
    : internalState.onClose;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {trigger !== null &&
        (trigger ?? (
          <DialogTrigger asChild>
            <Button size="sm">
              <Trans>邀请成员</Trans>
            </Button>
          </DialogTrigger>
        ))}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>邀请队友</Trans>
          </DialogTitle>
          <DialogDescription>
            {organizationId
              ? t`我们会给每位队友发送一封包含加入组织链接的电子邮件。链接将在两周后失效。`
              : t`输入电子邮件地址以邀请团队成员。`}
          </DialogDescription>
        </DialogHeader>

        {organizationId ? (
          <InviteForm
            organizationId={organizationId}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        ) : (
          <CreateOrgAndInviteForm onClose={onClose} onSuccess={onSuccess} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  organizationId,
  onClose,
  onSuccess,
}: {
  organizationId: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useLingui();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    defaultValues: {
      invitations: [
        { email: "", role: "member" },
        { email: "", role: "member" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "invitations",
  });

  const invitations = watch("invitations");
  const canAddMore = fields.length < MAX_BULK_INVITES;

  const onSubmit = handleSubmit(async (data) => {
    const filled = data.invitations
      .map((i) => ({ email: i.email.trim().toLowerCase(), role: i.role }))
      .filter((i) => i.email.length > 0);

    if (filled.length === 0) {
      toastError({ description: t`请至少输入一个电子邮件地址` });
      return;
    }

    const result = await inviteMembersAction({
      organizationId,
      invitations: filled,
    });

    if (result?.serverError) {
      toastError({
        title: t`发送邀请时出错`,
        description: result.serverError,
      });
      return;
    }

    if (!result?.data) return;

    const successCount = result.data.results.filter((r) => r.success).length;
    const failures = result.data.results.filter((r) => !r.success);

    if (successCount > 0) {
      toastSuccess({
        description: t`${plural(successCount, { one: "# invitation sent successfully!", other: "# invitations sent successfully!" })}`,
      });
      onSuccess?.();
      reset();
      onClose();
    }

    if (failures.length > 0) {
      toastError({
        title: t`${plural(failures.length, { one: "Failed to send # invitation", other: "Failed to send # invitations" })}`,
        description: failures
          .map((f) => `${f.email}: ${f.error ?? t`Failed`}`)
          .join("\n"),
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Input
                type="email"
                name={`invitations.${index}.email`}
                placeholder="email@example.com"
                registerProps={register(`invitations.${index}.email`, {
                  validate: (v) =>
                    !v.trim() ||
                    isValidEmail(v.trim()) ||
                    t`Please enter a valid email address`,
                })}
                error={errors.invitations?.[index]?.email}
              />
            </div>
            <div className="w-[130px] flex-shrink-0">
              <Select
                value={invitations[index]?.role}
                onValueChange={(value) =>
                  setValue(`invitations.${index}.role`, value as InviteRole, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    <Trans>成员</Trans>
                  </SelectItem>
                  <SelectItem value="admin">
                    <Trans>管理员</Trans>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              disabled={fields.length === 1}
              aria-label={t`移除邀请`}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={() => append({ email: "", role: "member" })}
        disabled={!canAddMore}
        className="px-2 -ml-2"
      >
        <PlusIcon className="size-4 mr-2" />
        <Trans>添加另一个电子邮件地址</Trans>
      </Button>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">
            <Trans>取消</Trans>
          </Button>
        </DialogClose>
        <Button type="submit" loading={isSubmitting}>
          <Trans>发送邀请</Trans>
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreateOrgAndInviteForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const [emails, setEmails] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmailsChange = useCallback((newEmails: string[]) => {
    setEmails(newEmails.map((e) => e.toLowerCase()));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (emails.length === 0) {
      toastError({ description: t`请至少输入一个电子邮件地址` });
      return;
    }

    setIsSubmitting(true);

    const result = await createOrganizationAndInviteAction(emailAccountId, {
      emails,
    });

    setIsSubmitting(false);

    if (result?.serverError) {
      toastError({
        description: t`创建组织并发送邀请失败`,
      });
    } else if (result?.data) {
      const successCount = result.data.results.filter((r) => r.success).length;
      const errorCount = result.data.results.filter((r) => !r.success).length;

      if (successCount > 0) {
        toastSuccess({
          description: t`${plural(successCount, { one: "# invitation sent successfully!", other: "# invitations sent successfully!" })}`,
        });
      }
      if (errorCount > 0) {
        toastError({
          description: t`${plural(errorCount, { one: "Failed to send # invitation", other: "Failed to send # invitations" })}`,
        });
      }

      setEmails([]);
      onClose();
      onSuccess?.();
    }
  }, [emails, emailAccountId, onClose, onSuccess, t]);

  return (
    <div className="space-y-4">
      <TagInput
        value={emails}
        onChange={handleEmailsChange}
        validate={(email) =>
          isValidEmail(email) ? null : t`请输入有效的电子邮件地址`
        }
        label={t`电子邮件地址`}
        id="email-input"
        placeholder={t`输入电子邮件地址，用逗号分隔`}
      />

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">
            <Trans>取消</Trans>
          </Button>
        </DialogClose>
        <Button
          type="button"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={emails.length === 0}
        >
          <Plural
            value={emails.length}
            _0="Send Invitation"
            one="Send Invitation"
            other="Send Invitations"
          />
        </Button>
      </DialogFooter>
    </div>
  );
}
