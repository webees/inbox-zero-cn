"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ArrowRightIcon, SendIcon } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/Input";
import { PageHeading, TypographyP } from "@/components/Typography";
import { usersRolesInfo } from "@/app/(app)/[emailAccountId]/onboarding/config";
import { USER_ROLES } from "@/utils/constants/user-roles";
import { cn } from "@/utils";
import { ScrollableFadeContainer } from "@/components/ScrollableFadeContainer";
import {
  stepWhoSchema,
  type StepWhoSchema,
} from "@/utils/actions/onboarding.validation";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { OnboardingWrapper } from "@/app/(app)/[emailAccountId]/onboarding/OnboardingWrapper";
import { updateEmailAccountRoleAction } from "@/utils/actions/email-account";
import { Button } from "@/components/ui/button";
import { toastError } from "@/components/Toast";
import { captureException, getActionErrorMessage } from "@/utils/error";

export function StepWho({
  initialRole,
  emailAccountId,
  onNext,
}: {
  initialRole?: string | null;
  emailAccountId: string;
  onNext: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [customRole, setCustomRole] = useState("");

  // 检查初始角色是否不在我们的列表中（自定义角色）
  const isCustomRole =
    initialRole && !USER_ROLES.some((role) => role.value === initialRole);
  const defaultRole = isCustomRole ? "Other" : initialRole || "";

  const form = useForm<StepWhoSchema>({
    resolver: zodResolver(stepWhoSchema),
    defaultValues: { role: defaultRole },
  });
  const { executeAsync: saveRole } = useAction(
    updateEmailAccountRoleAction.bind(null, emailAccountId),
  );
  const { watch, setValue } = form;
  const watchedRole = watch("role");
  const displayedRoles = useMemo(
    () => USER_ROLES.filter((role) => usersRolesInfo[role.value]),
    [],
  );
  const displayedRoleValues = useMemo(
    () => displayedRoles.map((role) => role.value),
    [displayedRoles],
  );

  // 如果是自定义值，则初始化自定义角色
  useEffect(() => {
    if (isCustomRole && initialRole) {
      setCustomRole(initialRole);
    }
  }, [isCustomRole, initialRole]);

  // 挂载时滚动到已选角色
  useEffect(() => {
    if (!defaultRole || !scrollContainerRef.current) return;

    // 找到带有已选角色的按钮
    // biome-ignore lint/complexity/useIndexOf: indexOf requires exact type match but defaultRole is `string` while array has a narrower union type
    const selectedIndex = displayedRoleValues.findIndex(
      (role) => role === defaultRole,
    );
    if (selectedIndex === -1) return;

    const buttons = scrollContainerRef.current.querySelectorAll(
      'button[type="button"]',
    );
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;

    // 使用 setTimeout 确保 DOM 已就绪
    const scrollTimeout = setTimeout(() => {
      selectedButton.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);

    return () => clearTimeout(scrollTimeout);
  }, [defaultRole, displayedRoleValues]);

  return (
    <OnboardingWrapper>
      <div className="flex justify-center">
        <IconCircle size="lg">
          <SendIcon className="size-6" />
        </IconCircle>
      </div>

      <div className="text-center">
        <PageHeading className="mt-4">你是做什么的？</PageHeading>
        <TypographyP className="mt-2">
          这有助于我们按照你真正需要的方式设置你的收件箱。
        </TypographyP>
      </div>

      <Form {...form}>
        <form
          className="space-y-6 mt-4"
          onSubmit={form.handleSubmit((values) => {
            const roleToSave =
              values.role === "Other" ? customRole : values.role;
            onNext();

            saveRole({
              role: roleToSave,
            })
              .then((result) => {
                if (result?.serverError || result?.validationErrors) {
                  captureException(new Error("保存引导流程的角色失败"), {
                    extra: {
                      context: "onboarding",
                      step: "role",
                      serverError: result?.serverError,
                      validationErrors: result?.validationErrors,
                    },
                  });
                  toastError({
                    description: getActionErrorMessage(
                      {
                        serverError: result?.serverError,
                        validationErrors: result?.validationErrors,
                      },
                      {
                        prefix: "无法保存该答案，但你可以继续",
                      },
                    ),
                  });
                }
              })
              .catch((error) => {
                captureException(error, {
                  extra: {
                    context: "onboarding",
                    step: "role",
                  },
                });
                const actionError =
                  typeof error === "object" &&
                  error !== null &&
                  "error" in error
                    ? (
                        error as {
                          error: Parameters<typeof getActionErrorMessage>[0];
                        }
                      ).error
                    : {};
                toastError({
                  description: getActionErrorMessage(actionError, {
                    prefix: "无法保存该答案，但你可以继续",
                  }),
                });
              });
          })}
        >
          <div className="max-w-md w-full mx-auto">
            <ScrollableFadeContainer
              ref={scrollContainerRef}
              className="grid gap-2 px-1 pt-6 pb-6"
              fadeFromClass="from-slate-50 dark:from-background"
              height="h-[48svh] sm:h-[576px]"
            >
              {displayedRoles.map(({ value: roleName }) => {
                const role = usersRolesInfo[roleName];
                const Icon = role.icon;

                return (
                  <button
                    type="button"
                    key={roleName}
                    className={cn(
                      "rounded-xl border bg-card p-4 text-card-foreground shadow-sm text-left flex items-center gap-4 transition-all",
                      watchedRole === roleName &&
                        "border-blue-600 ring-2 ring-blue-100",
                    )}
                    onClick={() => {
                      setValue("role", roleName);
                      if (roleName !== "Other") {
                        setCustomRole("");
                      }
                    }}
                  >
                    <IconCircle size="sm">
                      <Icon className="size-4" />
                    </IconCircle>

                    <div>
                      <div className="font-medium">{roleName}</div>
                    </div>
                  </button>
                );
              })}
            </ScrollableFadeContainer>
          </div>

          {watchedRole === "Other" && (
            <div className="px-1 pb-6 max-w-md w-full mx-auto">
              <Input
                name="customRole"
                type="text"
                placeholder="输入你的角色…"
                registerProps={{
                  value: customRole,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                    setCustomRole(e.target.value),
                  autoFocus: true,
                }}
                className="w-full border-slate-300 dark:border-border focus:border-blue-600 focus:ring-blue-600 transition-all py-3 px-4 text-lg"
              />
            </div>
          )}

          <div className="flex w-full max-w-xs mx-auto">
            <Button
              type="submit"
              className="w-full"
              loading={form.formState.isSubmitting}
              disabled={
                !watchedRole || (watchedRole === "Other" && !customRole.trim())
              }
            >
              继续
              <ArrowRightIcon className="size-4 ml-2" />
            </Button>
          </div>
        </form>
      </Form>
    </OnboardingWrapper>
  );
}
