import type {
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import type { FieldError, FieldErrors } from "react-hook-form";
import { useEffect } from "react";
import { Input, Label, ErrorMessage } from "@/components/Input";
import { toastError } from "@/components/Toast";
import { LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";
import { isConversationStatusType } from "@/utils/reply-tracker/conversation-status-config";
import type {
  CreateRuleBody,
  ZodCondition,
} from "@/utils/actions/rule.validation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from "@/components/ui/select";
import { FormControl, FormItem } from "@/components/ui/form";
import { RuleStep } from "@/app/(app)/[emailAccountId]/assistant/RuleStep";
import { SystemType } from "@/generated/prisma/enums";
import { AutosizeTextarea } from "@/components/ui/textarea";
import { RuleSteps } from "@/app/(app)/[emailAccountId]/assistant/RuleSteps";
import { TooltipExplanation } from "@/components/TooltipExplanation";

// UI 层面的条件类型
type UIConditionType = "from" | "to" | "subject" | "prompt";

const CONDITION_TYPE_OPTIONS: { label: string; value: UIConditionType }[] = [
  { label: "AI 提示词", value: "prompt" },
  { label: "发件人", value: "from" },
  { label: "收件人", value: "to" },
  { label: "主题", value: "subject" },
];
const MAX_CONDITIONS = CONDITION_TYPE_OPTIONS.length;

// 将后端条件转换为 UI 类型
function getUIConditionType(
  condition: ZodCondition,
): UIConditionType | undefined {
  if (condition.type === ConditionType.AI) {
    return "prompt";
  }
  // 对于 STATIC 条件，判断哪个字段被填充
  // 在新结构下，每个 STATIC 条件应只包含一个字段
  // 我们把启用字段设为 ""（空字符串），其余设为 null
  // 因此通过检查哪个字段不为 null 来确定 UI 类型
  if (condition.from !== null) return "from";
  if (condition.to !== null) return "to";
  if (condition.subject !== null) return "subject";
  if (condition.body !== null) return "subject"; // body maps to subject in UI
  // 如果没有字段被填充（新建/未选择的条件），返回 undefined
  return;
}

function allowMultipleConditions(systemType: SystemType | null | undefined) {
  return (
    systemType !== SystemType.COLD_EMAIL &&
    !isConversationStatusType(systemType)
  );
}

// Convert UI type to backend condition
function getConditionFromUIType(
  uiType: UIConditionType | undefined,
): ZodCondition | never {
  if (!uiType) {
    // Create empty condition with no field selected
    return {
      type: ConditionType.STATIC,
      from: null,
      to: null,
      subject: null,
      body: null,
      instructions: null,
    };
  }
  if (uiType === "prompt") {
    return {
      type: ConditionType.AI,
      instructions: "",
      from: null,
      to: null,
      subject: null,
      body: null,
    };
  }
  if (uiType === "from") {
    return {
      type: ConditionType.STATIC,
      from: "",
      to: null,
      subject: null,
      body: null,
      instructions: null,
    };
  }
  if (uiType === "to") {
    return {
      type: ConditionType.STATIC,
      from: null,
      to: "",
      subject: null,
      body: null,
      instructions: null,
    };
  }
  if (uiType === "subject") {
    return {
      type: ConditionType.STATIC,
      from: null,
      to: null,
      subject: "",
      body: null,
      instructions: null,
    };
  }
  // This should never happen, but TypeScript needs it
  throw new Error(`Unknown UI condition type: ${uiType}`);
}

export function ConditionSteps({
  conditionFields,
  conditionalOperator,
  removeCondition,
  watch,
  setValue,
  register,
  errors,
  conditions,
  ruleSystemType,
  appendCondition,
}: {
  conditionFields: Array<{ id: string }>;
  conditionalOperator: LogicalOperator | null | undefined;
  removeCondition: (index: number) => void;
  watch: UseFormWatch<CreateRuleBody>;
  setValue: UseFormSetValue<CreateRuleBody>;
  register: UseFormRegister<CreateRuleBody>;
  errors: FieldErrors<CreateRuleBody>;
  conditions: CreateRuleBody["conditions"];
  ruleSystemType: SystemType | null | undefined;
  appendCondition: (condition: ZodCondition) => void;
}) {
  // Check if we can add more conditions
  // Max 4 conditions possible (prompt, from, to, subject)
  const maxConditionsReached = conditions.length >= MAX_CONDITIONS;

  const canAddMoreConditions =
    !(ruleSystemType && isConversationStatusType(ruleSystemType)) &&
    allowMultipleConditions(ruleSystemType) &&
    !maxConditionsReached;

  // Set first condition to prompt type only if it's empty/unconfigured
  // This preserves existing static conditions when loading a rule
  useEffect(() => {
    if (conditions.length > 0) {
      const firstCondition = conditions[0];
      const uiType = getUIConditionType(firstCondition);
      // Only set to prompt if the condition is empty (undefined type)
      // Don't replace existing static conditions (from/to/subject)
      if (uiType === undefined) {
        const promptCondition = getConditionFromUIType("prompt");
        setValue("conditions.0", promptCondition);
      }
    }
  }, [conditions, setValue]);

  return (
    <RuleSteps
      onAdd={() => {
        // 创建没有默认选择项的空条件
        const newCondition = getConditionFromUIType(undefined);
        appendCondition(newCondition);
      }}
      addButtonLabel="添加条件"
      addButtonDisabled={!canAddMoreConditions}
      addButtonTooltip={
        maxConditionsReached
          ? "已达到条件的最大数量。"
          : !canAddMoreConditions
            ? "此规则只能设置一个条件。"
            : undefined
      }
    >
      {conditionFields.map((condition, index) => {
        const currentCondition = watch(`conditions.${index}`);
        const uiType = getUIConditionType(currentCondition);
        const isFirstCondition = index === 0;
        const isFirstConditionPrompt = isFirstCondition && uiType === "prompt";
        const conditionTypeLabel = getConditionTypeLabel(uiType);
        const usedUITypes = new Set(
          conditions
            .map((c, idx) =>
              idx === index ? undefined : getUIConditionType(c),
            )
            .filter(
              (type): type is UIConditionType =>
                type !== undefined && type !== null,
            ),
        );
        const previousConditionType =
          index > 0 ? getUIConditionType(conditions[index - 1]) : undefined;
        const isStaticFollowingStatic =
          uiType !== "prompt" && previousConditionType !== "prompt";
        const showOperatorSelector =
          index === 1 && previousConditionType === "prompt";

        // Hide leftContent only for first condition when it's a prompt type
        // Static conditions always need the label shown
        const leftContent = isFirstConditionPrompt ? null : (
          <FormItem>
            <Select
              onValueChange={(value: UIConditionType) => {
                // Check if we have duplicate UI condition types
                const prospectiveUITypes = conditions.map((c, idx) =>
                  idx === index ? value : getUIConditionType(c),
                );
                const configuredTypes = prospectiveUITypes.filter(
                  (type): type is UIConditionType =>
                    type !== undefined && type !== null,
                );
                const uniqueUITypes = new Set(configuredTypes);

                if (uniqueUITypes.size !== configuredTypes.length) {
                  toastError({
                    description: "每种类型只能有一个条件。",
                  });
                  return;
                }

                const newCondition = getConditionFromUIType(value);

                // If AI Prompt is selected at a non-first position,
                // insert it at position 0 and shift other conditions
                if (value === "prompt" && index !== 0) {
                  const currentConditionAtIndex = conditions[index];
                  const currentConditionType = getUIConditionType(
                    currentConditionAtIndex,
                  );

                  const newConditions = [newCondition];

                  for (let i = 0; i < conditions.length; i++) {
                    if (i !== index) {
                      newConditions.push(conditions[i]);
                    } else if (currentConditionType !== undefined) {
                      newConditions.push(currentConditionAtIndex);
                    }
                  }

                  setValue("conditions", newConditions);
                } else {
                  setValue(`conditions.${index}`, newCondition);
                }
              }}
              value={uiType || undefined}
            >
              <div className="flex items-center gap-2">
                {index === 0 ? null : showOperatorSelector ? (
                  <Select
                    value={
                      conditionalOperator === LogicalOperator.OR ? "or" : "and"
                    }
                    onValueChange={(value) => {
                      setValue(
                        "conditionalOperator",
                        value === "or"
                          ? LogicalOperator.OR
                          : LogicalOperator.AND,
                      );
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-[80px]">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="and">且</SelectItem>
                      <SelectItem value="or">或</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-muted-foreground">
                    {isStaticFollowingStatic
                      ? "且"
                      : conditionalOperator === LogicalOperator.OR
                        ? "或"
                        : "且"}
                  </p>
                )}
                <FormControl>
                  <SelectTrigger className="w-[120px]">
                    {uiType ? (
                      conditionTypeLabel
                    ) : (
                      <SelectValue placeholder="选择" />
                    )}
                  </SelectTrigger>
                </FormControl>
              </div>
              <SelectContent>
                {CONDITION_TYPE_OPTIONS.filter(
                  (option) =>
                    !usedUITypes.has(option.value) || option.value === uiType,
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        );

        // Check if this static condition should be indented
        // Only indent static conditions that follow another static condition (the AND'd group)
        // The first static after AI prompt should NOT be indented (it shows the and/or boundary)
        const firstConditionIsPrompt =
          getUIConditionType(conditions[0]) === "prompt";
        const isStaticOrEmpty = uiType !== "prompt";
        const isSecondOrLaterStaticAfterPrompt =
          firstConditionIsPrompt && isStaticOrEmpty && index > 1;
        const shouldIndent = isSecondOrLaterStaticAfterPrompt;

        return (
          <div
            className={shouldIndent ? "ml-14" : undefined}
            key={condition.id}
          >
            <RuleStep
              onRemove={() => removeCondition(index)}
              removeAriaLabel="移除条件"
              leftContent={leftContent}
              rightContent={(() => {
                const currentCondition = watch(`conditions.${index}`);
                const uiType = getUIConditionType(currentCondition);

                if (uiType === "prompt") {
                  return (
                    <>
                      {isFirstCondition && (
                        <div className="mb-2">
                          <Label
                            name={`conditions.${index}.instructions`}
                            label="匹配："
                          />
                        </div>
                      )}
                      <div className="relative">
                        <AutosizeTextarea
                          minRows={3}
                          rows={3}
                          {...register(`conditions.${index}.instructions`)}
                          placeholder="例如：新闻邮件，来自我订阅的出版物、博客或服务的常规内容"
                        />
                      </div>
                      {(
                        errors.conditions?.[index] as {
                          instructions?: FieldError;
                        }
                      )?.instructions && (
                        <div className="mt-2">
                          <ErrorMessage
                            message={
                              (
                                errors.conditions?.[index] as {
                                  instructions?: FieldError;
                                }
                              )?.instructions?.message || "无效的值"
                            }
                          />
                        </div>
                      )}
                    </>
                  );
                }

                if (uiType === "from") {
                  return (
                    <div className="relative">
                      <Input
                        type="text"
                        name={`conditions.${index}.from`}
                        registerProps={register(`conditions.${index}.from`)}
                        placeholder="hello@example.com 或 support@test.com"
                        className="pr-8"
                        error={
                          (
                            errors.conditions?.[index] as {
                              from?: FieldError;
                            }
                          )?.from
                        }
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <TooltipExplanation
                          text={getFilterTooltipText("from")}
                          side="right"
                          size="sm"
                          className="text-gray-400"
                        />
                      </div>
                    </div>
                  );
                }

                if (uiType === "to") {
                  return (
                    <div className="relative">
                      <Input
                        type="text"
                        name={`conditions.${index}.to`}
                        registerProps={register(`conditions.${index}.to`)}
                        placeholder="hello@example.com 或 support@test.com"
                        className="pr-8"
                        error={
                          (
                            errors.conditions?.[index] as {
                              to?: FieldError;
                            }
                          )?.to
                        }
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <TooltipExplanation
                          text={getFilterTooltipText("to")}
                          side="right"
                          size="sm"
                          className="text-gray-400"
                        />
                      </div>
                    </div>
                  );
                }

                if (uiType === "subject") {
                  return (
                    <div className="relative">
                      <Input
                        type="text"
                        name={`conditions.${index}.subject`}
                        registerProps={register(`conditions.${index}.subject`)}
                        placeholder="你的购买收据"
                        className="pr-8"
                        error={
                          (
                            errors.conditions?.[index] as {
                              subject?: FieldError;
                            }
                          )?.subject
                        }
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <TooltipExplanation
                          text="仅将此规则应用于主题为该内容的邮件。例如：你的购买收据"
                          side="right"
                          size="sm"
                          className="text-gray-400"
                        />
                      </div>
                    </div>
                  );
                }

                return null;
              })()}
            />
          </div>
        );
      })}
    </RuleSteps>
  );
}

const getFilterTooltipText = (filterType: "from" | "to") =>
  `仅将此规则应用于${filterType === "from" ? "来自" : "发往"}此地址的邮件。支持用逗号、竖线或 OR 分隔的多个地址。例如："@company.com"、"hello@example.com OR support@test.com"`;

function getConditionTypeLabel(uiType: UIConditionType | undefined): string {
  switch (uiType) {
    case "prompt":
      return "AI 提示词";
    case "from":
      return "发件人";
    case "to":
      return "收件人";
    case "subject":
      return "主题";
    default:
      return "选择";
  }
}
