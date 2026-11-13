"use client";

import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  createSnippetAction,
  updateSnippetAction,
} from "@/utils/actions/snippet";
import {
  createSnippetBody,
  updateSnippetBody,
  type CreateSnippetBody,
  type UpdateSnippetBody,
} from "@/utils/actions/snippet.validation";
import type { GetSnippetsResponse } from "@/app/api/user/snippets/route";

type SnippetFormItem = GetSnippetsResponse["snippets"][number];

// Passed as values so the translation keeps the literal braces.
const FIRST_NAME_VARIABLE = "{first_name}";
const NAME_VARIABLE = "{name}";
const EMAIL_VARIABLE = "{email}";

export function SnippetForm({
  closeDialog,
  editingItem,
  initialValues,
  onCreated,
  refetch,
}: {
  closeDialog: () => void;
  editingItem?: SnippetFormItem | null;
  initialValues?: Partial<CreateSnippetBody>;
  onCreated?: (snippet: SnippetFormItem) => void;
  refetch: () => void;
}) {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateSnippetBody | UpdateSnippetBody>({
    resolver: zodResolver(editingItem ? updateSnippetBody : createSnippetBody),
    defaultValues: editingItem
      ? {
          content: editingItem.content,
          id: editingItem.id,
          shortcut: editingItem.shortcut,
        }
      : {
          content: initialValues?.content ?? "",
          shortcut: initialValues?.shortcut ?? "",
        },
  });

  useEffect(() => {
    if (editingItem) {
      reset({
        content: editingItem.content,
        id: editingItem.id,
        shortcut: editingItem.shortcut,
      });
      return;
    }
    reset({
      content: initialValues?.content ?? "",
      shortcut: initialValues?.shortcut ?? "",
    });
  }, [editingItem, initialValues, reset]);

  const onSubmit = async (data: CreateSnippetBody | UpdateSnippetBody) => {
    const result = editingItem
      ? await updateSnippetAction(emailAccountId, data as UpdateSnippetBody)
      : await createSnippetAction(emailAccountId, data);

    if (result?.serverError) {
      toastError({
        title: editingItem ? t`更新片段时出错` : t`创建片段时出错`,
        description: result.serverError,
      });
      return;
    }

    toastSuccess({
      description: editingItem ? t`片段已更新` : t`片段已创建`,
    });
    if (!editingItem && result?.data?.snippet) {
      onCreated?.(result.data.snippet);
    }
    refetch();
    closeDialog();
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <Input
        error={errors.shortcut}
        label={t`快捷方式`}
        leftText="/"
        name="shortcut"
        registerProps={register("shortcut")}
        type="text"
      />
      <Input
        autosizeTextarea
        error={errors.content}
        explainText={t`使用 ${FIRST_NAME_VARIABLE}、${NAME_VARIABLE} 或 ${EMAIL_VARIABLE} 表示第一位收件人。`}
        label={t`内容`}
        name="content"
        registerProps={register("content")}
        rows={6}
        type="text"
      />
      <Button loading={isSubmitting} type="submit">
        {editingItem ? t`更新` : t`保存片段`}
      </Button>
    </form>
  );
}
