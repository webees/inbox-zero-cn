"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MessageCircleIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { CopyInput } from "@/components/CopyInput";
import { SlackNotificationTargetSelect } from "@/components/SlackNotificationTargetSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingContent } from "@/components/LoadingContent";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toastSuccess, toastError, toastInfo } from "@/components/Toast";
import { useTeamsEnabled } from "@/hooks/useFeatureFlags";
import { useMessagingChannels } from "@/hooks/useMessagingChannels";
import {
  createMessagingLinkCodeAction,
  disconnectChannelAction,
  linkSlackWorkspaceAction,
} from "@/utils/actions/messaging-channels";
import { fetchWithAccount } from "@/utils/fetch";
import { captureException } from "@/utils/error";
import { getActionErrorMessage } from "@/utils/error";
import { redirectToSafeUrl } from "@/utils/redirect";
import type { GetSlackAuthUrlResponse } from "@/app/api/slack/auth-url/route";
import {
  type MessagingProvider,
  MessagingRoutePurpose,
} from "@/generated/prisma/enums";

type LinkableMessagingProvider = "TEAMS" | "TELEGRAM";

const PROVIDER_CONFIG: Partial<
  Record<MessagingProvider, { name: string; icon: typeof MessageSquareIcon }>
> = {
  SLACK: { name: "Slack", icon: MessagesSquareIcon },
  TEAMS: { name: "Teams", icon: MessageCircleIcon },
  TELEGRAM: { name: "Telegram", icon: SendIcon },
};

export function ConnectedAppsSection({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const {
    data: channelsData,
    isLoading,
    error,
    mutate: mutateChannels,
  } = useMessagingChannels(emailAccountId);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [existingWorkspace, setExistingWorkspace] = useState<{
    teamId: string;
    teamName: string;
  } | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [linkCodeDialog, setLinkCodeDialog] = useState<{
    provider: LinkableMessagingProvider;
    code: string;
    botUrl?: string | null;
  } | null>(null);

  const connectedChannels =
    channelsData?.channels.filter((channel) => channel.isConnected) ?? [];
  const hasSlack = connectedChannels.some(
    (channel) => channel.provider === "SLACK",
  );
  const hasTeams = connectedChannels.some(
    (channel) => channel.provider === "TEAMS",
  );
  const hasTelegram = connectedChannels.some(
    (channel) => channel.provider === "TELEGRAM",
  );
  const teamsEnabled = useTeamsEnabled();
  const slackAvailable =
    channelsData?.availableProviders?.includes("SLACK") ?? false;
  const teamsAvailable =
    (channelsData?.availableProviders?.includes("TEAMS") ?? false) &&
    !!teamsEnabled;
  const telegramAvailable =
    channelsData?.availableProviders?.includes("TELEGRAM") ?? false;

  const { execute: executeLinkSlack, status: linkStatus } = useAction(
    linkSlackWorkspaceAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "Slack 已连接" });
        setExistingWorkspace(null);
        setAuthUrl(null);
        mutateChannels();
      },
      onError: (error) => {
        const msg = getActionErrorMessage(error.error);
        if (msg?.includes("Could not find your Slack account") && authUrl) {
          toastInfo({
            title: "在 Slack 中未找到该邮箱",
            description: "正在重定向到 Slack 授权…",
          });
          redirectToSafeUrl(authUrl, { allowExternal: true });
        } else {
          toastError({ description: msg ?? "关联 Slack 失败" });
        }
      },
    },
  );

  const { execute: executeCreateLinkCode, status: linkCodeStatus } = useAction(
    createMessagingLinkCodeAction.bind(null, emailAccountId),
    {
      onSuccess: ({ data }) => {
        if (!data?.code || !data.provider) return;
        setLinkCodeDialog({
          provider: data.provider,
          code: data.code,
          botUrl: data.botUrl || null,
        });
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error) ?? "生成验证码失败",
        });
      },
    },
  );

  if (
    !isLoading &&
    !slackAvailable &&
    !teamsAvailable &&
    !telegramAvailable &&
    connectedChannels.length === 0
  )
    return null;

  const handleConnectSlack = async () => {
    setConnectingSlack(true);
    try {
      const res = await fetchWithAccount({
        url: "/api/slack/auth-url",
        emailAccountId,
      });
      if (!res.ok) {
        throw new Error("获取 Slack 授权 URL 失败");
      }
      const data: GetSlackAuthUrlResponse = await res.json();

      if (data.existingWorkspace) {
        setExistingWorkspace(data.existingWorkspace);
        setAuthUrl(data.url);
        setConnectingSlack(false);
        return;
      }

      if (data.url) {
        redirectToSafeUrl(data.url, { allowExternal: true });
      } else {
        throw new Error("未返回授权 URL");
      }
    } catch (error) {
      captureException(error, {
        extra: { context: "Slack OAuth 初始化" },
      });
      toastError({ description: "连接 Slack 失败" });
      setConnectingSlack(false);
    }
  };

  const handleLinkSlack = () => {
    if (!existingWorkspace) return;
    executeLinkSlack({ teamId: existingWorkspace.teamId });
  };

  const handleCreateLinkCode = (provider: LinkableMessagingProvider) => {
    executeCreateLinkCode({ provider });
  };

  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>已连接应用</ItemTitle>
        </ItemContent>
        <ItemActions>
          <div className="flex items-center gap-2">
            {!hasSlack &&
              slackAvailable &&
              (existingWorkspace ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={linkStatus === "executing"}
                    onClick={handleLinkSlack}
                  >
                    <MessagesSquareIcon className="mr-2 h-4 w-4" />
                    {linkStatus === "executing"
                      ? "正在关联…"
                      : `关联到 ${existingWorkspace.teamName}`}
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-4"
                    onClick={() => {
                      if (authUrl) {
                        redirectToSafeUrl(authUrl, { allowExternal: true });
                      }
                    }}
                  >
                    手动安装
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={connectingSlack || isLoading}
                  onClick={handleConnectSlack}
                >
                  <MessagesSquareIcon className="mr-2 h-4 w-4" />
                  {connectingSlack ? "正在连接…" : "连接 Slack"}
                </Button>
              ))}

            {!hasTeams && teamsAvailable && (
              <Button
                variant="outline"
                size="sm"
                disabled={linkCodeStatus === "executing"}
                onClick={() => handleCreateLinkCode("TEAMS")}
              >
                <MessageCircleIcon className="mr-2 h-4 w-4" />
                连接 Teams
              </Button>
            )}

            {!hasTelegram && telegramAvailable && (
              <Button
                variant="outline"
                size="sm"
                disabled={linkCodeStatus === "executing"}
                onClick={() => handleCreateLinkCode("TELEGRAM")}
              >
                <SendIcon className="mr-2 h-4 w-4" />
                连接 Telegram
              </Button>
            )}
          </div>
        </ItemActions>
      </Item>
      <LoadingContent loading={isLoading} error={error} loadingComponent={null}>
        {connectedChannels.length > 0 && (
          <div className="space-y-2 px-4 pb-3">
            {connectedChannels.map((channel) => (
              <ConnectedChannelRow
                key={channel.id}
                channel={channel}
                emailAccountId={emailAccountId}
                onUpdate={mutateChannels}
              />
            ))}
          </div>
        )}
      </LoadingContent>
      <MessagingConnectCodeDialog
        open={Boolean(linkCodeDialog)}
        provider={linkCodeDialog?.provider ?? null}
        code={linkCodeDialog?.code ?? null}
        botUrl={linkCodeDialog?.botUrl ?? null}
        onOpenChange={(open) => {
          if (!open) setLinkCodeDialog(null);
        }}
      />
    </>
  );
}

function ConnectedChannelRow({
  channel,
  emailAccountId,
  onUpdate,
}: {
  channel: {
    id: string;
    provider: MessagingProvider;
    teamName: string | null;
    canSendAsDm: boolean;
    destinations: {
      ruleNotifications: {
        targetId: string | null;
        targetLabel: string | null;
        isDm: boolean;
      };
    };
  };
  emailAccountId: string;
  onUpdate: () => void;
}) {
  const config = PROVIDER_CONFIG[channel.provider];
  const Icon = config?.icon ?? MessageSquareIcon;
  const isSlackChannel = channel.provider === "SLACK";

  const { execute: executeDisconnect, status: disconnectStatus } = useAction(
    disconnectChannelAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({
          description: `${config?.name ?? channel.provider} 已断开连接`,
        });
        onUpdate();
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error) ?? "断开连接失败",
        });
      },
    },
  );

  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          {config?.name ?? channel.provider}
          {channel.teamName && (
            <span className="text-muted-foreground">
              {" "}
              &middot; {channel.teamName}
            </span>
          )}
        </span>

        {isSlackChannel && (
          <SlackNotificationTargetSelect
            emailAccountId={emailAccountId}
            messagingChannelId={channel.id}
            purpose={MessagingRoutePurpose.RULE_NOTIFICATIONS}
            targetId={channel.destinations.ruleNotifications.targetId}
            targetLabel={channel.destinations.ruleNotifications.targetLabel}
            isDm={channel.destinations.ruleNotifications.isDm}
            canSendAsDm={channel.canSendAsDm}
            onUpdate={onUpdate}
            className="h-7 w-auto gap-1 border-none bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:bg-muted"
          />
        )}
      </div>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructiveGhost"
              size="iconXs"
              disabled={disconnectStatus === "executing"}
              onClick={() => executeDisconnect({ channelId: channel.id })}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>断开连接</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function MessagingConnectCodeDialog({
  open,
  provider,
  code,
  botUrl,
  onOpenChange,
}: {
  open: boolean;
  provider: LinkableMessagingProvider | null;
  code: string | null;
  botUrl?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!provider || !code) return null;

  const providerName = getProviderDisplayName(provider);
  const command = `/connect ${code}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>连接 {providerName}</DialogTitle>
          <DialogDescription>
            在 {providerName} 上向 Inbox Zero
            机器人发送私信，输入此命令。该验证码仅可使用一次，10 分钟后失效。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">命令</div>
          <CopyInput value={command} />
        </div>
        {provider === "TELEGRAM" && botUrl && (
          <div className="pt-1">
            <Button asChild size="sm">
              <a href={botUrl} target="_blank" rel="noopener noreferrer">
                打开 Telegram 机器人
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getProviderDisplayName(provider: LinkableMessagingProvider): string {
  if (provider === "TEAMS") return "Teams";
  return "Telegram";
}

export function useSlackNotifications({
  enabled,
  onSlackConnected,
}: {
  enabled: boolean;
  onSlackConnected?: (emailAccountId: string | null) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (handled.current) return;

    const message = searchParams.get("message");
    const error = searchParams.get("error");
    const errorReason = searchParams.get("error_reason");
    const errorDetail = searchParams.get("error_detail");
    const resolvedReason = resolveSlackErrorReason(errorReason, errorDetail);

    if (!message && !error && !errorReason && !errorDetail) return;

    handled.current = true;

    if (message === "slack_connected") {
      onSlackConnected?.(searchParams.get("slack_email_account_id"));
      toastSuccess({
        title: "Slack 已连接",
        description: "接下来，打开渠道以选择 Slack 消息发送到哪里。",
      });
    }
    if (message === "processing") {
      toastInfo({
        title: "Slack 连接正在进行中",
        description: "Slack 仍在完成你的连接。请稍后刷新。",
      });
    }

    if (error === "connection_failed" || errorDetail) {
      const description = appendSlackConnectionFailureDetails({
        description: getSlackConnectionFailedDescription(resolvedReason),
        errorReason,
        errorDetail,
      });

      toastError({
        title: "Slack 连接失败",
        description,
      });
    }

    const preserved = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      if (
        key !== "message" &&
        key !== "error" &&
        key !== "error_reason" &&
        key !== "error_detail" &&
        key !== "slack_email_account_id"
      ) {
        preserved.set(key, value);
      }
    }
    const qs = preserved.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [enabled, onSlackConnected, pathname, router, searchParams]);
}

function getSlackConnectionFailedDescription(
  resolvedReason: string | null,
): string {
  if (resolvedReason === "oauth_invalid_team_for_non_distributed_app") {
    return "此 Slack 应用尚未分发到所有工作区。请使用当前受支持的工作区，或联系支持人员。";
  }

  if (resolvedReason === "oauth_invalid_code") {
    return "Slack 返回了无效或过期的验证码。请重新尝试连接。";
  }

  if (
    resolvedReason === "missing_code" ||
    resolvedReason === "missing_state" ||
    resolvedReason === "invalid_state" ||
    resolvedReason === "invalid_state_format"
  ) {
    return "Slack 会话验证失败。请重新尝试连接。";
  }

  return "我们无法完成 Slack 连接。请重试。";
}

function appendSlackConnectionFailureDetails({
  description,
  errorReason,
  errorDetail,
}: {
  description: string;
  errorReason: string | null;
  errorDetail: string | null;
}): string {
  const details = formatSlackConnectionFailureDetails(errorReason, errorDetail);

  if (!details) {
    return description;
  }

  return `${description} 详情：${details}`;
}

function formatSlackConnectionFailureDetails(
  errorReason: string | null,
  errorDetail: string | null,
): string | null {
  const parts = [
    errorReason && `原因 ${sanitizeSlackConnectionFailureDetail(errorReason)}`,
    errorDetail && `详情 ${sanitizeSlackConnectionFailureDetail(errorDetail)}`,
  ].filter(Boolean);

  return parts.length ? parts.join("; ") : null;
}

function sanitizeSlackConnectionFailureDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function resolveSlackErrorReason(
  errorReason: string | null,
  errorDetail: string | null,
): string | null {
  if (errorReason) return errorReason;
  if (!errorDetail) return null;

  const normalized = errorDetail.toLowerCase();

  if (normalized.includes("invalid_code")) {
    return "oauth_invalid_code";
  }
  if (normalized.includes("invalid_team_for_non_distributed_app")) {
    return "oauth_invalid_team_for_non_distributed_app";
  }
  if (normalized.includes("invalid_state_format")) {
    return "invalid_state_format";
  }
  if (normalized.includes("invalid_state")) {
    return "invalid_state";
  }
  if (normalized.includes("missing_state")) {
    return "missing_state";
  }
  if (normalized.includes("missing_code")) {
    return "missing_code";
  }

  return null;
}
