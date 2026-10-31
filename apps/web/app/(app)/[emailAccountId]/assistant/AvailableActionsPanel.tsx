import { ActionType } from "@/generated/prisma/enums";
import type { GetMessagingChannelsResponse } from "@/app/api/user/messaging-channels/route";
import { Card, CardContent } from "@/components/ui/card";
import { getActionIcon } from "@/utils/action-display";
import { SectionHeader } from "@/components/Typography";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useMessagingChannels } from "@/hooks/useMessagingChannels";
import {
  getAvailableActions,
  getExtraActions,
} from "@/utils/ai/rule/create-rule-schema";
import { TooltipExplanation } from "@/components/TooltipExplanation";
import { getMessagingProviderName } from "@/utils/messaging/platforms";
import { getConnectedRuleNotificationChannels } from "@/utils/messaging/routes";
import { getIntegrationActionLabel } from "@/utils/mcp/tool-specs";
import { useIntegrationActionsEnabled } from "@/hooks/useFeatureFlags";

const actionNames: Record<ActionType, string> = {
  [ActionType.LABEL]: "标签",
  [ActionType.MOVE_FOLDER]: "移动到文件夹",
  [ActionType.ARCHIVE]: "归档",
  [ActionType.DELETE]: "删除",
  [ActionType.DRAFT_EMAIL]: "起草回复",
  [ActionType.DRAFT_MESSAGING_CHANNEL]: "起草回复",
  [ActionType.REPLY]: "发送回复",
  [ActionType.FORWARD]: "转发",
  [ActionType.MARK_READ]: "标记为已读",
  [ActionType.STAR]: "加星标",
  [ActionType.MARK_SPAM]: "标记为垃圾邮件",
  [ActionType.SEND_EMAIL]: "发送邮件",
  [ActionType.CALL_WEBHOOK]: "调用 webhook",
  [ActionType.DIGEST]: "添加到摘要",
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: "通知",
  [ActionType.NOTIFY_SENDER]: "通知发件人",
  [ActionType.INTEGRATION]: getIntegrationActionLabel(),
};

const actionTooltips: Partial<Record<ActionType, string>> = {
  [ActionType.CALL_WEBHOOK]:
    "面向开发者：通过将邮件数据发送到自定义 URL 来触发外部集成",
  [ActionType.DIGEST]: "将邮件归组，并作为每日摘要接收",
};

export function AvailableActionsPanel() {
  const { emailAccountId, provider } = useAccount();
  const integrationActionsEnabled = useIntegrationActionsEnabled();
  const { data: messagingChannelsData } = useMessagingChannels(emailAccountId);
  const notifyActionName = getNotifyActionName(messagingChannelsData);

  return (
    <Card className="h-fit bg-slate-50 dark:bg-slate-900 hidden sm:block">
      <CardContent className="pt-4">
        <div className="grid gap-2">
          <ActionSection
            actions={[
              ...getAvailableActions(provider),
              ...getExtraActions({
                integrationActionsEnabled,
              }),
            ]}
            notifyActionName={notifyActionName}
            title="可用操作"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ActionSection({
  title,
  actions,
  notifyActionName,
}: {
  title: string;
  actions: ActionType[];
  notifyActionName: string;
}) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="grid gap-2 mt-1">
        {actions.map((actionType) => {
          const Icon = getActionIcon(actionType);
          const tooltip = actionTooltips[actionType];
          return (
            <div key={actionType} className="flex items-center gap-2">
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="text-sm">
                {actionType === ActionType.NOTIFY_MESSAGING_CHANNEL
                  ? notifyActionName
                  : actionNames[actionType]}
              </span>
              {tooltip && <TooltipExplanation text={tooltip} size="sm" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getNotifyActionName(
  messagingChannelsData: GetMessagingChannelsResponse | undefined,
) {
  const connectedChannels = getConnectedRuleNotificationChannels(
    messagingChannelsData?.channels,
  );
  const providers =
    connectedChannels.length > 0
      ? connectedChannels.map((channel) => channel.provider)
      : (messagingChannelsData?.availableProviders ?? []);
  const providerNames = Array.from(
    new Set(providers.map(getMessagingProviderName)),
  );

  return providerNames.length > 0
    ? `在 ${formatProviderList(providerNames)} 上通知`
    : "通知";
}

function formatProviderList(providerNames: string[]) {
  if (providerNames.length === 1) return providerNames[0];
  if (providerNames.length === 2) return providerNames.join(" 或 ");

  return `${providerNames.slice(0, -1).join("、")}或${providerNames.at(-1)}`;
}
