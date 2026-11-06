"use client";

import { useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RuleForm } from "./RuleForm";
import type { CreateRuleBody } from "@/utils/actions/rule.validation";
import { useDialogState } from "@/hooks/useDialogState";
import { ActionType, LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";
import type { RulesResponse } from "@/app/api/user/rules/route";
import { SUPPORT_EMAIL } from "@/utils/branding";
import { RuleLoader } from "./RuleLoader";

interface RuleDialogProps {
  duplicateRule?: RulesResponse[number];
  editMode?: boolean;
  initialRule?: Partial<CreateRuleBody>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  ruleId?: string;
}

export function useRuleDialog() {
  const ruleDialog = useDialogState<{ ruleId: string }>();

  const RuleDialogComponent = useCallback(
    () => (
      <RuleDialog
        ruleId={ruleDialog.data?.ruleId}
        isOpen={ruleDialog.isOpen}
        onClose={ruleDialog.onClose}
        editMode={false}
      />
    ),
    [ruleDialog.data?.ruleId, ruleDialog.isOpen, ruleDialog.onClose],
  );

  return { ruleDialog, RuleDialogComponent };
}

export function RuleDialog({
  ruleId,
  duplicateRule,
  isOpen,
  onClose,
  onSuccess,
  initialRule,
  editMode = true,
}: RuleDialogProps) {
  const handleSuccess = () => {
    onSuccess?.();
    onClose();
  };

  // 将 duplicateRule 转换为 initialRule 格式
  const duplicateInitialRule = useMemo(() => {
    if (!duplicateRule) return;
    return transformRuleForDuplication(duplicateRule);
  }, [duplicateRule]);

  // 如果提供了 duplicateInitialRule 则使用它，否则使用 initialRule
  const finalInitialRule = duplicateInitialRule || initialRule;
  const dialogContentKey = ruleId || duplicateRule?.id || "new-rule";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader className={ruleId ? "sr-only" : ""}>
          <DialogTitle>{ruleId ? "编辑规则" : "创建规则"}</DialogTitle>
        </DialogHeader>
        <ErrorBoundary
          key={dialogContentKey}
          extra={{ component: "RuleDialog", ruleId }}
          fallback={<RuleDialogErrorState onClose={onClose} />}
          logMessage="规则对话框崩溃了"
          logScope="rule-dialog-error-boundary"
        >
          <div className="min-w-0">
            {ruleId ? (
              <RuleLoader ruleId={ruleId}>
                {({ rule, mutate }) => (
                  <RuleForm
                    key={rule.id}
                    rule={rule}
                    alwaysEditMode={editMode}
                    onSuccess={handleSuccess}
                    isDialog={true}
                    mutate={mutate}
                    onCancel={onClose}
                  />
                )}
              </RuleLoader>
            ) : (
              <RuleForm
                key={dialogContentKey}
                rule={{
                  name: "",
                  conditions: [
                    {
                      type: ConditionType.AI,
                    },
                  ],
                  actions: [
                    {
                      type: ActionType.LABEL,
                    },
                  ],
                  runOnThreads: true,
                  conditionalOperator: LogicalOperator.AND,
                  ...finalInitialRule,
                }}
                alwaysEditMode={true}
                onSuccess={handleSuccess}
                isDialog={true}
                onCancel={onClose}
              />
            )}
          </div>
        </ErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialogErrorState({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-4 py-4">
      <p className="text-sm text-muted-foreground">
        打开此规则时发生错误。如果问题仍然存在，请联系支持人员：{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>{" "}
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}

function transformRuleForDuplication(
  rule: RulesResponse[number],
): Partial<CreateRuleBody> {
  const conditions: CreateRuleBody["conditions"] = [];

  // 如果存在说明，则添加 AI 条件
  if (rule.instructions) {
    conditions.push({
      type: ConditionType.AI,
      instructions: rule.instructions,
    });
  }

  // 如果存在任何静态字段，则添加静态条件
  if (rule.from || rule.to || rule.subject || rule.body) {
    conditions.push({
      type: ConditionType.STATIC,
      from: rule.from || undefined,
      to: rule.to || undefined,
      subject: rule.subject || undefined,
      body: rule.body || undefined,
    });
  }

  // 如果未创建任何条件，则添加一个默认的 AI 条件
  if (conditions.length === 0) {
    conditions.push({
      type: ConditionType.AI,
    });
  }

  return {
    name: `${rule.name}（副本）`,
    instructions: rule.instructions || undefined,
    groupId: rule.groupId || undefined,
    runOnThreads: rule.runOnThreads,
    conditionalOperator: rule.conditionalOperator,
    conditions,
    actions: rule.actions.map((action) => ({
      type: action.type,
      labelId: action.labelId
        ? { value: action.labelId, name: action.label || undefined }
        : undefined,
      subject: action.subject ? { value: action.subject } : undefined,
      content: action.content ? { value: action.content } : undefined,
      to: action.to ? { value: action.to } : undefined,
      cc: action.cc ? { value: action.cc } : undefined,
      bcc: action.bcc ? { value: action.bcc } : undefined,
      url: action.url ? { value: action.url } : undefined,
      folderName: action.folderName ? { value: action.folderName } : undefined,
      folderId: action.folderId ? { value: action.folderId } : undefined,
      delayInMinutes: action.delayInMinutes || undefined,
    })),
  };
}
