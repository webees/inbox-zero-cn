"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { getDateFnsLocale } from "@/utils/i18n/date-fns-locale";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();
  const { data, isLoading, error, mutate } =
    useOrganizationMembers(organizationId);
  const { data: membership } = useOrganizationMembership();
  const isAdmin = hasOrganizationAdminRole(membership?.role ?? "");
  const isOwner = membership?.role === "owner";
  const { data: executedRulesData } = useExecutedRulesCount(
    isAdmin ? organizationId : null,
  );
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);

  // 创建 Map，以 O(1) 查找代替为每位成员执行 O(n) 的 Array.find
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
        t`移除成员时出错`,
        t`成员已成功移除`,
        t`移除成员失败`,
      ),
    [handleAction, t],
  );

  const handleCancelInvitation = useCallback(
    (invitationId: string) =>
      handleAction(
        null,
        () => cancelInvitationAction({ invitationId }),
        t`取消邀请时出错`,
        t`邀请已成功取消`,
        t`取消邀请失败`,
      ),
    [handleAction, t],
  );

  const handleUpdateRole = useCallback(
    (memberId: string, role: "admin" | "member") => {
      const roleLabel = getRoleLabel(role, i18n);
      return handleAction(
        memberId,
        () => updateMemberRoleAction({ memberId, role }),
        t`更新角色时出错`,
        t`角色已更新为 ${roleLabel}`,
        t`更新角色失败`,
      );
    },
    [handleAction, t, i18n],
  );

  const handleTransferOwnership = useCallback(
    (memberId: string) =>
      handleAction(
        memberId,
        () => transferOwnershipAction({ organizationId, memberId }),
        t`转移所有权时出错`,
        t`所有权已成功转移`,
        t`转移所有权失败`,
      ),
    [handleAction, organizationId, t],
  );

  const memberCount = data?.members.length || 0;

  return (
    <LoadingContent loading={isLoading} error={error}>
      <div>
        <div className="flex justify-between items-center">
          <TypographyH3>
            <Trans>成员（{memberCount}）</Trans>
          </TypographyH3>
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
              <p className="text-muted-foreground">
                <Trans>你的组织中未找到成员</Trans>
              </p>
            </div>
          )}

        {data?.pendingInvitations && data.pendingInvitations.length > 0 && (
          <div className="space-y-4 mt-8">
            <TypographyH3>
              <Trans>待处理邀请（{data.pendingInvitations.length}）</Trans>
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
  const { t, i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const memberName = member.emailAccount.name || member.emailAccount.email;
  const joinedAt = new Date(member.createdAt).toLocaleDateString();
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
              <p>
                <Trans>加入时间：{joinedAt}</Trans>
              </p>
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
                      <Trans>分析</Trans>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/${member.emailAccount.id}/usage`}>
                      <BarChartIcon className="mr-2 size-4" />
                      <Trans>用量</Trans>
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              {canChangeRole && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={isPending}>
                    <ShieldIcon className="mr-2 size-4" />
                    <Trans>角色</Trans>
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
                        <Trans>成员</Trans>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="admin" disabled={isPending}>
                        <Trans>管理员</Trans>
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
                      <Trans>转移所有权</Trans>
                    </DropdownMenuItem>
                  }
                  title={t`转移所有权`}
                  description={t`要将组织所有权转移给 ${memberName} 吗？你将成为管理员`}
                  confirmText={t`转移`}
                  onConfirm={() => onTransferOwnership(member.id)}
                />
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onRemove(member.id)}
                className="text-red-600 hover:!bg-red-50 hover:!text-red-600"
              >
                <TrashIcon className="mr-2 size-4" />
                <Trans>移除</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          {member.emailAccount.name || t`未设置姓名`}
        </p>
        <Badge
          variant={
            hasOrganizationAdminRole(member.role) ? "default" : "secondary"
          }
          className="text-xs"
        >
          {getRoleLabel(member.role, i18n)}
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
              <Plural
                value={executedRulesCount}
                one="助手已处理 # 封邮件"
                other="助手已处理 # 封邮件"
              />
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
  const { i18n } = useLingui();
  const display = ACTIVITY_BADGE[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={display.variant} className="text-xs">
            {i18n._(display.label)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {display.tooltip({ disconnectedAt, lastProcessedEmailAt }, i18n)}
          </p>
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
  const { i18n } = useLingui();
  const expiresAt = new Date(invitation.expiresAt).toLocaleDateString();
  const inviterName = invitation.inviter.name || invitation.inviter.email;

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
                <Trans>过期时间：{expiresAt}</Trans>
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
          <Trans>取消</Trans>
        </Button>
      }
    >
      <div className="flex items-center space-x-3">
        <p className="font-medium">{invitation.email}</p>
        <Badge variant="outline" className="text-xs">
          <Trans>待处理</Trans>
        </Badge>
        {invitation.role && (
          <Badge variant="secondary" className="text-xs">
            {getRoleLabel(invitation.role, i18n)}
          </Badge>
        )}
      </div>
      <div className="flex items-center space-x-3 mt-1">
        <span className="text-xs text-muted-foreground">
          <Trans>邀请人：{inviterName}</Trans>
        </span>
      </div>
    </CardWrapper>
  );
}

const ROLE_LABELS: Record<string, MessageDescriptor> = {
  owner: msg`所有者`,
  admin: msg`管理员`,
  member: msg`成员`,
};

function getRoleLabel(role: string, i18n: I18n) {
  const label = ROLE_LABELS[role];
  if (label) return i18n._(label);
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getInitials(name: string | null | undefined, email: string) {
  return name ? name.charAt(0).toUpperCase() : email.charAt(0).toUpperCase();
}

const ACTIVITY_BADGE: Record<
  MemberActivityStatus,
  {
    label: MessageDescriptor;
    variant: "green" | "red" | "outline" | "secondary";
    tooltip: (
      dates: {
        disconnectedAt?: Date | string | null;
        lastProcessedEmailAt?: Date | string | null;
      },
      i18n: I18n,
    ) => string;
  }
> = {
  active: {
    label: msg`活跃`,
    variant: "green",
    tooltip: ({ lastProcessedEmailAt }, i18n) =>
      formatLastProcessed(lastProcessedEmailAt, i18n),
  },
  disconnected: {
    label: msg`已断开连接`,
    variant: "red",
    tooltip: ({ disconnectedAt }, i18n) => {
      if (!disconnectedAt) return i18n._(msg`邮箱账号已断开连接`);
      const relativeDate = formatRelativeDate(disconnectedAt, i18n);
      return i18n._(msg`邮箱账号已于 ${relativeDate}断开连接`);
    },
  },
  hidden: {
    label: msg`活动已隐藏`,
    variant: "outline",
    tooltip: (_dates, i18n) => i18n._(msg`该成员未允许组织管理员进行分析`),
  },
  inactive: {
    label: msg`${RECENT_ACTIVITY_HOURS} 小时内无活动`,
    variant: "secondary",
    tooltip: ({ lastProcessedEmailAt }, i18n) =>
      formatLastProcessed(lastProcessedEmailAt, i18n),
  },
  none: {
    label: msg`暂无活动`,
    variant: "secondary",
    tooltip: (_dates, i18n) => i18n._(msg`未找到该账号中由助手处理的邮件`),
  },
};

function formatLastProcessed(
  date: Date | string | null | undefined,
  i18n: I18n,
) {
  const relativeDate = formatRelativeDate(date, i18n);
  return i18n._(msg`最近处理的邮件：${relativeDate}`);
}

function formatRelativeDate(
  date: Date | string | null | undefined,
  i18n: I18n,
) {
  if (!date) return i18n._(msg`未知`);

  return formatDistanceToNow(new Date(date), {
    addSuffix: true,
    locale: getDateFnsLocale(i18n.locale),
  });
}
