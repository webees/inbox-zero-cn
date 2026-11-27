import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
import { getIntegrationActionLabelMessage } from "@/utils/mcp/tool-specs-messages";
import { useIntegrationActionsEnabled } from "@/hooks/useFeatureFlags";

const actionNames: Record<
  Exclude<ActionType, typeof ActionType.INTEGRATION>,
  MessageDescriptor
> = {
  [ActionType.LABEL]: msg`打标签`,
  [ActionType.MOVE_FOLDER]: msg`移动到文件夹`,
  [ActionType.ARCHIVE]: msg`归档`,
  [ActionType.DELETE]: msg`删除`,
  [ActionType.DRAFT_EMAIL]: msg`起草回复`,
  [ActionType.DRAFT_MESSAGING_CHANNEL]: msg`起草回复`,
  [ActionType.REPLY]: msg`发送回复`,
  [ActionType.FORWARD]: msg`转发`,
  [ActionType.MARK_READ]: msg`标记为已读`,
  [ActionType.STAR]: msg`加星标`,
  [ActionType.MARK_SPAM]: msg`标记为垃圾邮件`,
  [ActionType.SEND_EMAIL]: msg`发送邮件`,
  [ActionType.CALL_WEBHOOK]: msg`调用 Webhook`,
  [ActionType.DIGEST]: msg`添加到邮件摘要`,
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: msg`通知`,
  [ActionType.NOTIFY_SENDER]: msg`通知发件人`,
};

const actionTooltips: Partial<Record<ActionType, MessageDescriptor>> = {
  [ActionType.CALL_WEBHOOK]: msg`面向开发者：将邮件数据发送到自定义 URL，以触发外部集成`,
  [ActionType.DIGEST]: msg`将邮件汇总，并以每日摘要的形式接收`,
};

export function AvailableActionsPanel() {
  const { t, i18n } = useLingui();
  const { emailAccountId, provider } = useAccount();
  const integrationActionsEnabled = useIntegrationActionsEnabled();
  const { data: messagingChannelsData } = useMessagingChannels(emailAccountId);
  const notifyActionName = getNotifyActionName(messagingChannelsData, i18n);

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
            title={t`Available Actions`}
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
  const { i18n } = useLingui();
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="grid gap-2 mt-1">
        {actions.map((actionType) => {
          const Icon = getActionIcon(actionType);
          const tooltipMessage = actionTooltips[actionType];
          const tooltip = tooltipMessage ? i18n._(tooltipMessage) : undefined;
          return (
            <div key={actionType} className="flex items-center gap-2">
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="text-sm">
                {getActionName(actionType, notifyActionName, i18n)}
              </span>
              {tooltip && <TooltipExplanation text={tooltip} size="sm" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getActionName(
  actionType: ActionType,
  notifyActionName: string,
  i18n: I18n,
) {
  if (actionType === ActionType.NOTIFY_MESSAGING_CHANNEL)
    return notifyActionName;
  if (actionType === ActionType.INTEGRATION)
    return i18n._(getIntegrationActionLabelMessage());
  return i18n._(actionNames[actionType]);
}

function getNotifyActionName(
  messagingChannelsData: GetMessagingChannelsResponse | undefined,
  i18n: I18n,
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

  if (providerNames.length === 0) return i18n._(msg`Notify`);

  const providerList = new Intl.ListFormat(i18n.locale, {
    type: "disjunction",
  }).format(providerNames);
  return i18n._(msg`Notify on ${providerList}`);
}
