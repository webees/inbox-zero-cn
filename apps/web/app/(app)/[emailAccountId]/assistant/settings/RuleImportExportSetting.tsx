"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import { toastError } from "@/components/Toast";
import { useRules } from "@/hooks/useRules";
import { importRulesAction } from "@/utils/actions/rule";
import { formatUtcDate } from "@/utils/date";

export function RuleImportExportSetting({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { data, mutate } = useRules(emailAccountId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportRules = useCallback(() => {
    if (!data) return;

    const exportData = data
      .filter((rule) => !rule.organizationRuleId)
      .map((rule) => ({
        name: rule.name,
        instructions: rule.instructions,
        enabled: rule.enabled,
        automate: rule.automate,
        runOnThreads: rule.runOnThreads,
        systemType: rule.systemType,
        conditionalOperator: rule.conditionalOperator,
        from: rule.from,
        to: rule.to,
        subject: rule.subject,
        body: rule.body,
        categoryFilterType: rule.categoryFilterType,
        actions: rule.actions.map((action) => ({
          type: action.type,
          label: action.label,
          to: action.to,
          cc: action.cc,
          bcc: action.bcc,
          subject: action.subject,
          content: action.content,
          folderName: action.folderName,
          url: action.url,
          delayInMinutes: action.delayInMinutes,
          integrationName: action.integrationName,
          integrationToolName: action.integrationToolName,
          integrationArgs: action.integrationArgs,
        })),
      }));

    if (exportData.length === 0) {
      toastError({ description: "没有可导出的个人规则。" });
      return;
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inbox-zero-rules-${formatUtcDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("规则导出成功");
  }, [data]);

  const importRules = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const rules = JSON.parse(text);
        const rulesArray = Array.isArray(rules) ? rules : rules.rules;

        if (!Array.isArray(rulesArray) || rulesArray.length === 0) {
          toastError({ description: "规则文件格式无效" });
          return;
        }

        const result = await importRulesAction(emailAccountId, {
          rules: rulesArray,
        });

        if (result?.serverError) {
          toastError({
            title: "导入失败",
            description: result.serverError,
          });
        } else if (result?.data) {
          const { createdCount, updatedCount, skippedCount } = result.data;
          toast.success(
            `已导入 ${createdCount} 条新规则，更新 ${updatedCount} 条现有规则${skippedCount > 0 ? `，跳过 ${skippedCount} 条` : ""}`,
          );
          mutate();
        }
      } catch (error) {
        toastError({
          title: "导入失败",
          description: error instanceof Error ? error.message : "解析文件失败",
        });
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [emailAccountId, mutate],
  );

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>导入 / 导出规则</ItemTitle>
        </ItemContent>
        <ItemActions>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={importRules}
            className="hidden"
            aria-label="从 JSON 文件导入规则"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon className="mr-2 size-4" />
            导入
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={exportRules}
            disabled={!data?.length}
          >
            <DownloadIcon className="mr-2 size-4" />
            导出
          </Button>
        </ItemActions>
      </Item>
    </>
  );
}
