"use client";

import { useMemo, useState } from "react";
import { useForm, useFieldArray, type UseFormReturn } from "react-hook-form";
import { InboxIcon, ZapIcon } from "lucide-react";
import { LogicalOperator } from "@/generated/prisma/enums";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { Toggle } from "@/components/Toggle";
import { toastError, toastSuccess } from "@/components/Toast";
import { Form } from "@/components/ui/form";
import { useAction } from "next-safe-action/hooks";
import {
  createOrganizationRuleAction,
  updateOrganizationRuleAction,
} from "@/utils/actions/organization-rule";
import type { OrganizationRuleActionSchema } from "@/utils/actions/organization-rule.validation";
import type { CreateRuleBody } from "@/utils/actions/rule.validation";
import { ConditionType } from "@/utils/config";
import {
  getConditions,
  getEmptyCondition,
  flattenConditions,
} from "@/utils/condition";
import { createScopedLogger } from "@/utils/logger";
import { ConditionSteps } from "@/app/(app)/[emailAccountId]/assistant/ConditionSteps";
import { RuleSectionCard } from "@/app/(app)/[emailAccountId]/assistant/RuleSectionCard";
import { OrgActionSteps } from "./OrgActionSteps";
import { EMPTY_ORG_ACTION, type OrgRuleFormValues } from "./orgRuleForm";
import type { OrganizationRulesResponse } from "@/app/api/organizations/[organizationId]/rules/route";

type OrgRule = OrganizationRulesResponse["rules"][number];

const logger = createScopedLogger("org-rule-dialog");

export function OrgRuleDialog({
  organizationId,
  rule,
  isOpen,
  onClose,
  onSuccess,
}: {
  organizationId: string;
  rule?: OrgRule;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const editing = !!rule;
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpen forces a re-derive so reopening "New rule" starts clean.
  const values = useMemo(() => toFormValues(rule), [rule, isOpen]);

  const form = useForm<OrgRuleFormValues>({ values });
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const {
    fields: conditionFields,
    append: appendCondition,
    remove: removeCondition,
  } = useFieldArray({ control, name: "conditions" });
  const {
    fields: actionFields,
    append: appendAction,
    remove: removeAction,
  } = useFieldArray({ control, name: "actions", keyName: "fieldId" });

  const createAction = useAction(createOrganizationRuleAction);
  const updateAction = useAction(updateOrganizationRuleAction);
  const isSubmitting = createAction.isExecuting || updateAction.isExecuting;

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const conditions = watch("conditions");
  const conditionalOperator = watch("conditionalOperator");

  const onSubmit = handleSubmit(async (formValues) => {
    const conditionFieldValues = flattenConditions(
      formValues.conditions,
      logger,
    );

    const actions = formValues.actions.map((action) => ({
      id: action.id,
      type: action.type as OrganizationRuleActionSchema["type"],
      label: action.label || null,
      subject: action.subject || null,
      content: action.content || null,
      to: action.to || null,
      cc: action.cc || null,
      bcc: action.bcc || null,
      url: action.url || null,
      folderName: action.folderName || null,
      delayInMinutes:
        action.delayInMinutes && action.delayInMinutes > 0
          ? action.delayInMinutes
          : null,
    }));

    const shared = {
      name: formValues.name,
      instructions: conditionFieldValues.instructions || null,
      from: conditionFieldValues.from || null,
      to: conditionFieldValues.to || null,
      subject: conditionFieldValues.subject || null,
      body: formValues.body || null,
      conditionalOperator: formValues.conditionalOperator,
      runOnThreads: formValues.runOnThreads,
      actions,
    };

    const result =
      editing && rule
        ? await updateAction.executeAsync({
            organizationId,
            organizationRuleId: rule.id,
            ...shared,
          })
        : await createAction.executeAsync({ organizationId, ...shared });

    if (result?.serverError || result?.validationErrors) {
      toastError({
        description:
          result.serverError || "保存规则时出错。请检查各字段后重试。",
      });
      return;
    }

    toastSuccess({ description: editing ? "规则已更新" : "规则已创建" });
    onSuccess();
  });

  // ConditionSteps 的类型是针对个人规则表单的，但它只读写 `conditions` /
  // `conditionalOperator`，这两个字段在两种表单中完全相同。在此处进行类型转换，
  // 可以避免把共享的条件编辑器改造成泛型。
  const conditionStepsForm = form as unknown as UseFormReturn<CreateRuleBody>;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑组织规则" : "新建组织规则"}</DialogTitle>
          <DialogDescription>
            此规则适用于你组织中的每一位成员。
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <Input
              type="text"
              name="name"
              label="名称"
              registerProps={register("name", {
                required: "请输入名称",
              })}
              error={errors.name}
              placeholder="例如：给发票打标签"
            />

            <RuleSectionCard
              icon={InboxIcon}
              color="blue"
              title="当我收到邮件时"
            >
              <ConditionSteps
                conditionFields={conditionFields}
                conditionalOperator={conditionalOperator}
                removeCondition={removeCondition}
                watch={conditionStepsForm.watch}
                setValue={conditionStepsForm.setValue}
                register={conditionStepsForm.register}
                errors={conditionStepsForm.formState.errors}
                conditions={conditions}
                ruleSystemType={null}
                appendCondition={appendCondition}
              />
            </RuleSectionCard>

            <RuleSectionCard icon={ZapIcon} color="green" title="然后">
              <OrgActionSteps
                fields={actionFields}
                register={register}
                control={control}
                watch={watch}
                setValue={setValue}
                append={appendAction}
                remove={removeAction}
              />
            </RuleSectionCard>

            <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
              <CollapsibleHeading>高级选项</CollapsibleHeading>
              <CollapsibleContent>
                <div className="rounded-md border">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">应用于会话</p>
                      <p className="text-sm text-muted-foreground">
                        对会话中的每一封回复都执行，而不仅是第一封邮件。
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Toggle
                        name="runOnThreads"
                        enabled={watch("runOnThreads")}
                        onChange={(enabled) =>
                          setValue("runOnThreads", enabled)
                        }
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editing ? "保存规则" : "创建规则"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function toFormValues(rule?: OrgRule): OrgRuleFormValues {
  // 共享的条件编辑器没有 Body 类型，因此从可编辑列表中移除任何仅使用 Body 的旧条件，
  // 并单独传递该值，而不是将其显示为一个虚假的空 Subject 条件。
  const conditions = (rule ? getConditions(rule) : []).filter(
    (condition) => !(condition.type === ConditionType.STATIC && condition.body),
  );
  if (conditions.length === 0) {
    conditions.push(getEmptyCondition(ConditionType.AI));
  }

  return {
    name: rule?.name ?? "",
    conditions,
    body: rule?.body ?? null,
    conditionalOperator: rule?.conditionalOperator ?? LogicalOperator.AND,
    runOnThreads: rule?.runOnThreads ?? false,
    actions: rule?.actions.length
      ? rule.actions.map((action) => ({
          id: action.id,
          type: action.type,
          label: action.label ?? "",
          subject: action.subject ?? "",
          content: action.content ?? "",
          to: action.to ?? "",
          cc: action.cc ?? "",
          bcc: action.bcc ?? "",
          url: action.url ?? "",
          folderName: action.folderName ?? "",
          delayInMinutes: action.delayInMinutes ?? null,
        }))
      : [EMPTY_ORG_ACTION],
  };
}
