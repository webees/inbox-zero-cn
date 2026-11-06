"use client";

import {
  MoreHorizontalIcon,
  PenIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Loading } from "@/components/Loading";
import { LoadingContent } from "@/components/LoadingContent";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TypographyH3, MutedText } from "@/components/Typography";
import { AccessDenied } from "@/components/AccessDenied";
import { toastError, toastSuccess } from "@/components/Toast";
import { useDialogState } from "@/hooks/useDialogState";
import { useOrganizationRules } from "@/hooks/useOrganizationRules";
import { useOrganizationMembership } from "@/hooks/useOrganizationMembership";
import { hasOrganizationAdminRole } from "@/utils/organizations/roles";
import {
  deleteOrganizationRuleAction,
  setOrganizationRuleEnabledAction,
} from "@/utils/actions/organization-rule";
import { ACTION_TYPE_LABELS } from "@/utils/action-display";
import type { OrganizationRulesResponse } from "@/app/api/organizations/[organizationId]/rules/route";
import { OrgRuleDialog } from "./OrgRuleDialog";

type OrgRule = OrganizationRulesResponse["rules"][number];

export function OrgRules({ organizationId }: { organizationId: string }) {
  const { data: membership, isLoading: membershipLoading } =
    useOrganizationMembership();
  const isAdmin = hasOrganizationAdminRole(membership?.role ?? "");

  const { data, isLoading, error, mutate } =
    useOrganizationRules(organizationId);

  const ruleDialog = useDialogState<{ rule?: OrgRule }>();

  if (membershipLoading) {
    return <Loading />;
  }

  if (!isAdmin) {
    return (
      <AccessDenied message="你没有管理组织规则的权限。只有管理员可以访问此页面。" />
    );
  }

  const memberCount = data?.memberCount ?? 0;

  const onToggleEnabled = async (rule: OrgRule, enabled: boolean) => {
    mutate(
      data
        ? {
            ...data,
            rules: data.rules.map((r) =>
              r.id === rule.id ? { ...r, enabled } : r,
            ),
          }
        : data,
      { revalidate: false },
    );
    try {
      const result = await setOrganizationRuleEnabledAction({
        organizationId,
        organizationRuleId: rule.id,
        enabled,
      });
      if (result?.serverError) {
        toastError({
          description: `${enabled ? "启用" : "禁用"}规则时出错。${result.serverError}`,
        });
      }
    } finally {
      mutate();
    }
  };

  const onDelete = async (rule: OrgRule) => {
    const confirmed = confirm(
      `删除“${rule.name}”？这将为所有组织成员移除该规则。`,
    );
    if (!confirmed) return;

    const result = await deleteOrganizationRuleAction({
      organizationId,
      organizationRuleId: rule.id,
    });
    if (result?.serverError) {
      toastError({ description: result.serverError });
      return;
    }
    toastSuccess({ description: "规则已删除" });
    mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <TypographyH3>组织规则</TypographyH3>
          <MutedText className="mt-1">
            你在此创建的规则会应用于组织中的每一位成员。
          </MutedText>
        </div>
        <Button size="sm" onClick={() => ruleDialog.onOpen({})}>
          <PlusIcon className="mr-2 size-4" />
          新建规则
        </Button>
      </div>

      <Card>
        <LoadingContent loading={isLoading} error={error}>
          {data?.rules.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 whitespace-nowrap">启用</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>启用范围</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Switch
                        size="sm"
                        checked={rule.enabled}
                        onCheckedChange={(enabled) =>
                          onToggleEnabled(rule, enabled)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {rule.actions.map((action) => (
                          <Badge
                            key={action.id}
                            variant="secondary"
                            className="text-xs"
                          >
                            {ACTION_TYPE_LABELS[action.type]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {rule._count.memberRules} / {memberCount} 名成员
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-haspopup="true"
                            size="icon"
                            variant="ghost"
                          >
                            <MoreHorizontalIcon className="size-4" />
                            <span className="sr-only">切换菜单</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => ruleDialog.onOpen({ rule })}
                          >
                            <PenIcon className="mr-2 size-4" />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDelete(rule)}>
                            <Trash2Icon className="mr-2 size-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyDescription>还没有组织规则。</EmptyDescription>
              <Button size="sm" onClick={() => ruleDialog.onOpen({})}>
                <PlusIcon className="mr-2 size-4" />
                创建你的第一条规则
              </Button>
            </Empty>
          )}
        </LoadingContent>
      </Card>

      <OrgRuleDialog
        organizationId={organizationId}
        rule={ruleDialog.data?.rule}
        isOpen={ruleDialog.isOpen}
        onClose={ruleDialog.onClose}
        onSuccess={() => {
          mutate();
          ruleDialog.onClose();
        }}
      />
    </div>
  );
}
