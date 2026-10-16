"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { LoadingContent } from "@/components/LoadingContent";
import { useAccount } from "@/providers/EmailAccountProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrashIcon,
  MoreHorizontal,
  BarChart3,
  BarChartIcon,
  ShieldIcon,
  XIcon,
  CrownIcon,
} from "lucide-react";
import { InviteMemberModal } from "@/components/InviteMemberModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  cancelInvitationAction,
  removeMemberAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from "@/utils/actions/organization";
import { toastSuccess, toastError } from "@/components/Toast";
import type { OrganizationMembersResponse } from "@/app/api/organizations/[organizationId]/members/route";
import { useExecutedRulesCount } from "@/hooks/useExecutedRulesCount";
import { TypographyH3 } from "@/components/Typography";
import { useOrganizationMembership } from "@/hooks/useOrganizationMembership";
import { hasOrganizationAdminRole } from "@/utils/organizations/roles";
import {
  RECENT_ACTIVITY_HOURS,
  getMemberActivityStatus,
  type MemberActivityStatus,
} from "./member-activity";

type Member = OrganizationMembersResponse["members"][0];
type PendingInvitation = OrganizationMembersResponse["pendingInvitations"][0];

export function Members({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error, mutate } =
    useOrganizationMembers(organizationId);
  const { data: membership } = useOrganizationMembership();
  const isAdmin = hasOrganizationAdminRole(membership?.role ?? "");
  const isOwner = membership?.role === "owner";
  const { data: executedRulesData } = useExecutedRulesCount(
    isAdmin ? organizationId : null,
  );
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);

  // 创建 Map 以实现 O(1) 查找，而不是为每个成员进行 O(n) 的 Array.find
  const executedRulesStatsMap = useMemo(() => {
    if (!executedRulesData?.memberCounts) return new Map();

    return new Map(
      executedRulesData.memberCounts.map((item) => [
        item.emailAccountId,
        {
          executedRulesCount: item.executedRulesCount,
          lastProcessedEmailAt: item.lastProcessedEmailAt,
        },
      ]),
    );
  }, [executedRulesData?.memberCounts]);

  const handleAction = useCallback(
    async (
      memberId: string | null,
      action: () => Promise<{ serverError?: string } | undefined>,
      errorTitle: string,
      successMessage: string,
      errorMessage: string,
    ) => {
      setPendingMemberId(memberId);

      try {
        const result = await action();

        if (result?.serverError) {
          toastError({
            title: errorTitle,
            description: result.serverError,
          });
        } else {
          toastSuccess({ description: successMessage });
          await mutate();
        }
      } catch (err) {
        toastError({
          title: errorTitle,
          description: err instanceof Error ? err.message : errorMessage,
        });
      } finally {
        setPendingMemberId(null);
      }
    },
    [mutate],
  );

  const handleRemoveMember = useCallback(
    (memberId: string) =>
      handleAction(
        memberId,
        () => removeMemberAction({ memberId }),
        "移除成员时出错",
        "成员已成功移除",
        "移除成员失败",
      ),
    [handleAction],
  );

  const handleCancelInvitation = useCallback(
    (invitationId: string) =>
      handleAction(
        null,
        () => cancelInvitationAction({ invitationId }),
        "取消邀请时出错",
        "邀请已成功取消",
        "取消邀请失败",
      ),
    [handleAction],
  );

  const handleUpdateRole = useCallback(
    (memberId: string, role: "admin" | "member") =>
      handleAction(
        memberId,
        () => updateMemberRoleAction({ memberId, role }),
        "更新角色时出错",
        `角色已更新为${roleLabel(role)}`,
        "更新角色失败",
      ),
    [handleAction],
  );

  const handleTransferOwnership = useCallback(
    (memberId: string) =>
      handleAction(
        memberId,
        () => transferOwnershipAction({ organizationId, memberId }),
        "转移所有权时出错",
        "所有权已成功转移",
        "转移所有权失败",
      ),
    [handleAction, organizationId],
  );

  return (
    <LoadingContent loading={isLoading} error={error}>
      <div>
        <div className="flex justify-between items-center">
          <TypographyH3>成员（{data?.members.length || 0}）</TypographyH3>
          {isAdmin && (
            <InviteMemberModal
              organizationId={organizationId}
              onSuccess={mutate}
            />
          )}
        </div>

        <div className="space-y-2 mt-4">
          {data?.members.map((member) => {
            const executedRulesStats = executedRulesStatsMap.get(
              member.emailAccount.id,
            );

            return (
              <MemberCard
                key={member.id}
                member={member}
                onRemove={handleRemoveMember}
                onUpdateRole={handleUpdateRole}
                onTransferOwnership={handleTransferOwnership}
                executedRulesCount={executedRulesStats?.executedRulesCount}
                lastProcessedEmailAt={
                  executedRulesStats?.lastProcessedEmailAt ?? null
                }
                isAdmin={isAdmin}
                isOwner={isOwner}
                isPending={pendingMemberId === member.id}
              />
            );
          })}
        </div>

        {data?.members.length === 0 &&
          (!data?.pendingInvitations ||
            data.pendingInvitations.length === 0) && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">你的组织中没有找到成员。</p>
            </div>
          )}

        {data?.pendingInvitations && data.pendingInvitations.length > 0 && (
          <div className="space-y-4 mt-8">
            <TypographyH3>
              待处理的邀请（{data.pendingInvitations.length}）
            </TypographyH3>
            <div className="space-y-2">
              {data.pendingInvitations.map((invitation) => (
                <PendingInvitationCard
                  key={invitation.id}
                  invitation={invitation}
                  onCancel={handleCancelInvitation}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </LoadingContent>
  );
}

function CardWrapper({
  avatar,
  children,
  actions,
}: {
  avatar: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        {avatar}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {actions}
    </div>
  );
}

function MemberCard({
  member,
  onRemove,
  onUpdateRole,
  onTransferOwnership,
  executedRulesCount,
  lastProcessedEmailAt,
  isAdmin,
  isOwner,
  isPending,
}: {
  member: Member;
  onRemove: (memberId: string) => void;
  onUpdateRole: (memberId: string, role: "admin" | "member") => void;
  onTransferOwnership: (memberId: string) => void;
  executedRulesCount?: number;
  lastProcessedEmailAt?: Date | string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isPending: boolean;
}) {
  const { emailAccountId } = useAccount();
  const canChangeRole = member.role !== "owner";
  const canTransferOwnership = isOwner && canChangeRole;
  const activityStatus = getMemberActivityStatus({
    allowOrgAdminAnalytics: member.allowOrgAdminAnalytics,
    disconnectedAt: member.emailAccount.disconnectedAt,
    lastProcessedEmailAt,
  });

  return (
    <CardWrapper
      avatar={
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-10 w-10 flex-shrink-0">
                <AvatarImage
                  src={member.emailAccount.image || ""}
                  alt={member.emailAccount.name || member.emailAccount.email}
                />
                <AvatarFallback>
                  {getInitials(
                    member.emailAccount.name,
                    member.emailAccount.email,
                  )}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              <p>加入时间：{new Date(member.createdAt).toLocaleDateString()}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
      actions={
        isAdmin &&
        member.emailAccount.id !== emailAccountId &&
        member.emailAccount.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {member.allowOrgAdminAnalytics && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href={`/${member.emailAccount.id}/stats`}>
                      <BarChart3 className="mr-2 size-4" />
                      分析
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/${member.emailAccount.id}/usage`}>
                      <BarChartIcon className="mr-2 size-4" />
                      用量
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              {canChangeRole && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={isPending}>
                    <ShieldIcon className="mr-2 size-4" />
                    角色
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={member.role}
                      onValueChange={(value) => {
                        if (value === member.role) return;
                        onUpdateRole(member.id, value as "admin" | "member");
                      }}
                    >
                      <DropdownMenuRadioItem
                        value="member"
                        disabled={isPending}
                      >
                        成员
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="admin" disabled={isPending}>
                        管理员
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {canTransferOwnership && (
                <ConfirmDialog
                  trigger={
                    <DropdownMenuItem
                      onSelect={(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      disabled={isPending}
                    >
                      <CrownIcon className="mr-2 size-4" />
                      转移所有权
                    </DropdownMenuItem>
                  }
                  title="转移所有权"
                  description={`将组织所有权转移给 ${member.emailAccount.name || member.emailAccount.email}？你将成为管理员。`}
                  confirmText="转移"
                  onConfirm={() => onTransferOwnership(member.id)}
                />
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onRemove(member.id)}
                className="text-red-600 hover:!bg-red-50 hover:!text-red-600"
              >
                <TrashIcon className="mr-2 size-4" />
                移除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{member.emailAccount.name || "无名称"}</p>
        <Badge
          variant={
            hasOrganizationAdminRole(member.role) ? "default" : "secondary"
          }
          className="text-xs"
        >
          {roleLabel(member.role)}
        </Badge>
        {isAdmin && (
          <MemberActivityBadge
            status={activityStatus}
            disconnectedAt={member.emailAccount.disconnectedAt}
            lastProcessedEmailAt={lastProcessedEmailAt}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
        <span className="text-xs text-muted-foreground">
          {member.emailAccount.email}
        </span>
        {executedRulesCount !== undefined && (
          <>
            <span className="text-xs text-muted-foreground">∣</span>
            <span className="text-xs text-muted-foreground">
              AI 助手已处理 {executedRulesCount.toLocaleString()} 封邮件
            </span>
          </>
        )}
      </div>
    </CardWrapper>
  );
}

function MemberActivityBadge({
  disconnectedAt,
  lastProcessedEmailAt,
  status,
}: {
  disconnectedAt?: Date | string | null;
  lastProcessedEmailAt?: Date | string | null;
  status: MemberActivityStatus;
}) {
  const display = ACTIVITY_BADGE[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={display.variant} className="text-xs">
            {display.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{display.tooltip({ disconnectedAt, lastProcessedEmailAt })}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PendingInvitationCard({
  invitation,
  onCancel,
}: {
  invitation: PendingInvitation;
  onCancel: (invitationId: string) => void;
}) {
  return (
    <CardWrapper
      avatar={
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-10 w-10 flex-shrink-0">
                <AvatarFallback>
                  {invitation.email.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                过期时间： {new Date(invitation.expiresAt).toLocaleDateString()}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCancel(invitation.id)}
        >
          <XIcon className="size-4 mr-2" />
          取消
        </Button>
      }
    >
      <div className="flex items-center space-x-3">
        <p className="font-medium">{invitation.email}</p>
        <Badge variant="outline" className="text-xs">
          待处理
        </Badge>
        {invitation.role && (
          <Badge variant="secondary" className="text-xs">
            {roleLabel(invitation.role)}
          </Badge>
        )}
      </div>
      <div className="flex items-center space-x-3 mt-1">
        <span className="text-xs text-muted-foreground">
          邀请人：{invitation.inviter.name || invitation.inviter.email}
        </span>
      </div>
    </CardWrapper>
  );
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
  };
  return labels[role] ?? role;
}

function getInitials(name: string | null | undefined, email: string) {
  return name ? name.charAt(0).toUpperCase() : email.charAt(0).toUpperCase();
}

const ACTIVITY_BADGE: Record<
  MemberActivityStatus,
  {
    label: string;
    variant: "green" | "red" | "outline" | "secondary";
    tooltip: (dates: {
      disconnectedAt?: Date | string | null;
      lastProcessedEmailAt?: Date | string | null;
    }) => string;
  }
> = {
  active: {
    label: "活跃",
    variant: "green",
    tooltip: ({ lastProcessedEmailAt }) =>
      `上次处理邮件于${formatRelativeDate(lastProcessedEmailAt)}。`,
  },
  disconnected: {
    label: "已断开",
    variant: "red",
    tooltip: ({ disconnectedAt }) =>
      disconnectedAt
        ? `邮箱账号已于${formatRelativeDate(disconnectedAt)}断开。`
        : "邮箱账号已断开。",
  },
  hidden: {
    label: "动态已隐藏",
    variant: "outline",
    tooltip: () => "此成员尚未允许组织管理员查看分析数据。",
  },
  inactive: {
    label: `${RECENT_ACTIVITY_HOURS} 小时内无动态`,
    variant: "secondary",
    tooltip: ({ lastProcessedEmailAt }) =>
      `上次处理邮件于${formatRelativeDate(lastProcessedEmailAt)}。`,
  },
  none: {
    label: "暂无动态",
    variant: "secondary",
    tooltip: () => "此账号没有找到 AI 助手处理过的邮件。",
  },
};

function formatRelativeDate(date: Date | string | null | undefined) {
  if (!date) return "未知";

  return formatDistanceToNow(new Date(date), { addSuffix: true });
}
