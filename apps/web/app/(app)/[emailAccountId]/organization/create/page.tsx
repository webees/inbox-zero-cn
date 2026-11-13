"use client";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import { toastSuccess, toastError } from "@/components/Toast";
import { createOrganizationAction } from "@/utils/actions/organization";
import {
  createOrganizationBody,
  type CreateOrganizationBody,
} from "@/utils/actions/organization.validation";
import { slugify } from "@/utils/string";
import { useUser } from "@/hooks/useUser";
import { LoadingContent } from "@/components/LoadingContent";
import { useAccount } from "@/providers/EmailAccountProvider";
import { PageHeader } from "@/components/PageHeader";
import { PageWrapper } from "@/components/PageWrapper";

export default function CreateOrganizationPage() {
  const { t } = useLingui();
  const router = useRouter();
  const { isLoading, mutate, error } = useUser();
  const { emailAccountId } = useAccount();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
    watch,
    setValue,
  } = useForm<CreateOrganizationBody>({
    resolver: zodResolver(createOrganizationBody),
  });

  const nameValue = watch("name");
  const userModifiedSlug = dirtyFields.slug;

  useEffect(() => {
    if (nameValue && !userModifiedSlug) {
      const generatedSlug = slugify(nameValue);
      setValue("slug", generatedSlug);
    }
  }, [nameValue, userModifiedSlug, setValue]);

  const onSubmit: SubmitHandler<CreateOrganizationBody> = useCallback(
    async (data) => {
      const result = await createOrganizationAction(emailAccountId, data);

      if (result?.serverError) {
        toastError({
          title: t`创建组织时出错`,
          description: result.serverError,
        });
      } else {
        toastSuccess({ description: t`组织创建成功！` });
        mutate();
        router.push(`/organization/${result?.data?.id}`);
      }
    },
    [mutate, router, emailAccountId, t],
  );

  return (
    <PageWrapper className="max-w-2xl mx-auto">
      <PageHeader title={t`创建组织`} />
      <LoadingContent loading={isLoading} error={error}>
        <form
          className="max-w-sm space-y-4 mt-4"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Input
            type="text"
            name="name"
            label={t`组织名称`}
            placeholder="Apple 公司"
            registerProps={register("name")}
            error={errors.name}
          />

          <Input
            type="text"
            name="slug"
            label={t`URL 标识`}
            placeholder="apple-company"
            registerProps={register("slug")}
            error={errors.slug}
          />

          <Button type="submit" loading={isSubmitting}>
            <Trans>创建组织</Trans>
          </Button>
        </form>
      </LoadingContent>
    </PageWrapper>
  );
}
