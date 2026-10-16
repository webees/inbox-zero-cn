import type { Attachment as MailAttachment } from "nodemailer/lib/mailer";
import {
  Actions,
  Button,
  Card,
  CardText,
  LinkButton,
  Select,
  SelectOption,
  type ActionEvent,
  type CardElement,
  type CardChild,
  type ModalResponse,
  type ModalSubmitEvent,
} from "chat";
import { cardToBlockKit, cardToFallbackText } from "@chat-adapter/slack";
import prisma from "@/utils/prisma";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";
import {
  disableSlackLinkUnfurls,
  resolveSlackRouteDestination,
} from "@/utils/messaging/providers/slack/send";
import { sendAutomationMessage } from "@/utils/automation-jobs/messaging";
import {
  escapeSlackText,
  richTextToSlackMrkdwn,
} from "@/utils/messaging/providers/slack/format";
import {
  ActionType,
  AttachmentSourceType,
  DraftEmailStatus,
  MessagingMessageStatus,
  MessagingProvider,
  MessagingRoutePurpose,
  MessagingRouteTargetType,
  SystemType,
} from "@/generated/prisma/enums";
import type { ExecutedRule } from "@/generated/prisma/client";
import type { Logger } from "@/utils/logger";
import {
  convertNewlinesToBr,
  escapeHtml,
  removeExcessiveWhitespace,
  truncate,
} from "@/utils/string";
import { analyzeCalendarEvent } from "@/utils/parse/calender-event";
import { createEmailProvider } from "@/utils/email/provider";
import { getFormattedSenderAddress } from "@/utils/email/get-formatted-sender-address";
import { resolveActionAttachments } from "@/utils/ai/action-attachments";
import { quotePlainTextContent } from "@/utils/email/quoted-plain-text";
import { formatReplySubject } from "@/utils/email/subject";
import { emailToContent } from "@/utils/mail";
import {
  extractDraftPlainText,
  stripQuotedContent,
} from "@/utils/ai/choose-rule/draft-management";
import type { ParsedMessage } from "@/utils/types";
import he from "he";
import { isDraftReplyActionType } from "@/utils/actions/draft-reply";
import { extractEmailAddress, extractNameFromEmail } from "@/utils/email";
import {
  isMessagingChannelOperational,
  isOperationalSlackChannel,
} from "@/utils/messaging/channel-validity";
import {
  getSlackTeamId,
  getTelegramChatId,
} from "@/utils/messaging/action-event-identifiers";
import { getMessagingAdapterRegistry } from "@/utils/messaging/chat-sdk/adapters";
import { markdownToTelegramText } from "@/utils/messaging/providers/telegram/format";
import { getMessagingRoute } from "@/utils/messaging/routes";
import {
  getEmailUrlForOptionalMessage,
  getOpenInMailboxLabel,
} from "@/utils/url";
import {
  attachmentSourceInputSchema,
  selectedAttachmentSchema,
} from "@/utils/attachments/source-schema";

const DRAFT_PREVIEW_MAX_CHARS = 900;
const SUMMARY_PREVIEW_MAX_CHARS = 2000;
const MAX_DRAFT_ATTACHMENT_NAMES = 5;
const RULE_DRAFT_SEND_ACTION_ID = "rule_draft_send";
const RULE_DRAFT_EDIT_ACTION_ID = "rule_draft_edit";
const RULE_DRAFT_DISMISS_ACTION_ID = "rule_draft_dismiss";
const RULE_NOTIFY_ARCHIVE_ACTION_ID = "rule_notify_archive";
const RULE_NOTIFY_MARK_READ_ACTION_ID = "rule_notify_mark_read";
const RULE_NOTIFY_MORE_ACTION_ID = "rule_notify_more";
const RULE_NOTIFY_TRASH_ACTION_ID = "rule_notify_trash";
const RULE_NOTIFY_MARK_SPAM_ACTION_ID = "rule_notify_mark_spam";
export const SLACK_DRAFT_EDIT_MODAL_ID = "rule_draft_edit_modal";
const SLACK_DRAFT_EDIT_FIELD_ID = "draft_content";
const WEB_REPLY_HANDLED_TEXT = "已在网页端回复。";
const DRAFT_ALREADY_SENT_TEXT = "草稿已发送。无需操作。";

export const RULE_NOTIFICATION_ACTION_IDS = [
  RULE_DRAFT_SEND_ACTION_ID,
  RULE_DRAFT_EDIT_ACTION_ID,
  RULE_DRAFT_DISMISS_ACTION_ID,
  RULE_NOTIFY_ARCHIVE_ACTION_ID,
  RULE_NOTIFY_MARK_READ_ACTION_ID,
  RULE_NOTIFY_MORE_ACTION_ID,
  // 保留旧版直接监听器，用于处理在破坏性操作移入“更多”菜单之前发布的 Slack 卡片。
  RULE_NOTIFY_TRASH_ACTION_ID,
  RULE_NOTIFY_MARK_SPAM_ACTION_ID,
] as const;

type NotificationContext = NonNullable<
  Awaited<ReturnType<typeof getNotificationContext>>
>;

type NotificationContent = {
  details?: string[];
  summary: string;
  title: string;
};

type NotificationContentFormat = "plain" | "slack";

type NotificationOpenLink = {
  label: string;
  url: string;
};

type NotificationEmailPreview = {
  externalUrl?: string;
  headers: {
    from: string;
    subject: string;
  };
  snippet: string;
  textPlain?: string;
  textHtml?: string;
  attachments?: Array<{ filename: string }>;
};

export function buildSlackRuleNotificationPreviewBlocks({
  actionId,
  actionType,
  email,
  systemType = null,
  draftContent,
  draftAttachmentNames,
  openLink,
}: {
  actionId: string;
  actionType: ActionType;
  email: NotificationEmailPreview;
  systemType?: SystemType | null;
  draftContent?: string | null;
  draftAttachmentNames?: string[];
  openLink?: NotificationOpenLink | null;
}) {
  const content = buildNotificationContent({
    actionType,
    email,
    systemType,
    draftContent,
    draftAttachmentNames,
    format: "slack",
  });

  return cardToBlockKit(
    buildNotificationCard({
      actionId,
      actionType,
      content,
      openLink,
    }),
  );
}

type MessagingRuleNotificationResult = {
  delivered: boolean;
  kind: "interactive" | "view_only" | "none";
};

export async function sendMessagingRuleNotification({
  executedActionId,
  email,
  logger,
}: {
  executedActionId: string;
  email: NotificationEmailPreview;
  logger: Logger;
}): Promise<boolean> {
  const result = await getMessagingRuleNotificationResult({
    executedActionId,
    email,
    logger,
  });

  return result.delivered;
}

export async function replaceMessagingDraftNotificationsWithHandledOnWebState({
  executedRuleId,
  logger,
}: {
  executedRuleId: string;
  logger: Logger;
}) {
  await replaceMessagingDraftNotificationsWithTerminalState({
    executedRuleId,
    logger,
    terminalStatus: MessagingMessageStatus.EXPIRED,
    terminalMessage: WEB_REPLY_HANDLED_TEXT,
  });
}

export async function replaceMessagingDraftNotificationsWithDraftSentState({
  executedRuleId,
  logger,
  excludeExecutedActionId,
}: {
  executedRuleId: string;
  logger: Logger;
  excludeExecutedActionId?: string;
}) {
  await replaceMessagingDraftNotificationsWithTerminalState({
    executedRuleId,
    logger,
    excludeExecutedActionId,
    terminalStatus: MessagingMessageStatus.DRAFT_SENT,
    terminalMessage: DRAFT_ALREADY_SENT_TEXT,
  });
}

async function replaceMessagingDraftNotificationsWithTerminalState({
  executedRuleId,
  logger,
  excludeExecutedActionId,
  terminalStatus,
  terminalMessage,
}: {
  executedRuleId: string;
  logger: Logger;
  excludeExecutedActionId?: string;
  terminalStatus: MessagingMessageStatus;
  terminalMessage: string;
}) {
  try {
    const notificationActions = await prisma.executedAction.findMany({
      where: {
        id: excludeExecutedActionId
          ? { not: excludeExecutedActionId }
          : undefined,
        executedRuleId,
        type: ActionType.DRAFT_MESSAGING_CHANNEL,
        messagingMessageId: { not: null },
        messagingChannel: {
          isConnected: true,
        },
        OR: [
          { messagingMessageStatus: null },
          {
            messagingMessageStatus: {
              in: [
                MessagingMessageStatus.SENT,
                MessagingMessageStatus.DRAFT_EDITED,
              ],
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    const results = await Promise.allSettled(
      notificationActions.map(({ id }) =>
        replaceMessagingDraftNotificationWithTerminalState({
          executedActionId: id,
          logger,
          terminalStatus,
          terminalMessage,
        }),
      ),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn("折叠一条消息草稿通知失败", {
          executedRuleId,
          terminalStatus,
          error: result.reason,
        });
      }
    }
  } catch (error) {
    logger.warn("折叠消息草稿通知失败", {
      executedRuleId,
      terminalStatus,
      error,
    });
  }
}

export async function getMessagingRuleNotificationResult({
  executedActionId,
  email,
  logger,
}: {
  executedActionId: string;
  email: NotificationEmailPreview;
  logger: Logger;
}): Promise<MessagingRuleNotificationResult> {
  const context = await getNotificationContext(executedActionId);
  if (!context) return { delivered: false, kind: "none" };

  if (
    context.messagingChannel &&
    context.messagingChannel.emailAccountId !==
      context.executedRule.emailAccount.id
  ) {
    logger.warn("渠道归属不匹配，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
      emailAccountId: context.executedRule.emailAccount.id,
      channelEmailAccountId: context.messagingChannel.emailAccountId,
    });
    return { delivered: false, kind: "none" };
  }

  if (context.messagingChannel?.provider === MessagingProvider.SLACK) {
    return sendSlackRuleNotificationWithContext({
      context,
      email,
      logger,
    });
  }

  if (
    context.messagingChannel?.provider === MessagingProvider.TELEGRAM &&
    isDraftReplyActionType(context.type)
  ) {
    return sendTelegramRuleNotificationWithContext({
      context,
      email,
      logger,
    });
  }

  return sendLinkedRuleNotification({
    context,
    email,
    logger,
  });
}

async function sendSlackRuleNotificationWithContext({
  context,
  email,
  logger,
}: {
  context: NotificationContext;
  email: NotificationEmailPreview;
  logger: Logger;
}): Promise<MessagingRuleNotificationResult> {
  if (
    !context.messagingChannel ||
    !isOperationalSlackChannel(context.messagingChannel)
  ) {
    logger.warn("Slack 渠道未启用，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const route = getMessagingRoute(
    context.messagingChannel.routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  if (!route) {
    logger.warn("缺少 Slack 路由，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const destinationChannelId = await resolveSlackRouteDestination({
    accessToken: context.messagingChannel.accessToken,
    route,
  });

  if (!destinationChannelId) {
    logger.warn("缺少 Slack 目标，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const draftContent = await getNotificationDraftContent({
    context,
    logger,
  });
  const draftAttachmentNames = getNotificationDraftAttachmentNames({
    context,
    logger,
  });

  const content = buildNotificationContent({
    actionType: context.type,
    email,
    systemType: context.executedRule.rule?.systemType ?? null,
    draftContent,
    draftAttachmentNames,
    format: "slack",
  });

  const rootMessageId =
    (await findSlackRootMessageId({
      executedActionId: context.id,
      emailAccountId: context.executedRule.emailAccount.id,
      messagingChannelId: context.messagingChannel.id,
      threadId: context.executedRule.threadId,
    })) ?? null;

  const card = buildNotificationCard({
    actionId: context.id,
    actionType: context.type,
    content,
    openLink: getNotificationOpenLink(context, email.externalUrl),
  });

  try {
    const responseTs = await postSlackCard({
      accessToken: context.messagingChannel.accessToken,
      card,
      route,
      destinationChannelId,
      rootMessageId,
    });

    await prisma.executedAction.update({
      where: { id: context.id },
      data: {
        messagingMessageId: responseTs ?? rootMessageId ?? null,
        messagingMessageSentAt: new Date(),
        messagingMessageStatus: MessagingMessageStatus.SENT,
      },
    });
    return { delivered: true, kind: "interactive" };
  } catch (error) {
    logger.warn("发送 Slack 规则通知失败", {
      executedActionId: context.id,
      error,
    });
    return { delivered: false, kind: "none" };
  }
}

async function sendLinkedRuleNotification({
  context,
  email,
  logger,
}: {
  context: NotificationContext;
  email: NotificationEmailPreview;
  logger: Logger;
}): Promise<MessagingRuleNotificationResult> {
  if (
    !context.messagingChannel ||
    !isMessagingChannelOperational(context.messagingChannel) ||
    (context.messagingChannel.provider !== MessagingProvider.TEAMS &&
      context.messagingChannel.provider !== MessagingProvider.TELEGRAM)
  ) {
    logger.warn("已关联渠道未启用，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const route = getMessagingRoute(
    context.messagingChannel.routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  if (
    !route &&
    !hasLinkedMessagingDirectMessageDestination(context.messagingChannel)
  ) {
    logger.warn("缺少已关联渠道路由，跳过消息通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
      provider: context.messagingChannel.provider,
    });
    return { delivered: false, kind: "none" };
  }

  const draftContent = await getNotificationDraftContent({
    context,
    logger,
  });
  const draftAttachmentNames = getNotificationDraftAttachmentNames({
    context,
    logger,
  });

  const content = buildNotificationContent({
    actionType: context.type,
    email,
    systemType: context.executedRule.rule?.systemType ?? null,
    draftContent,
    draftAttachmentNames,
    format: "plain",
  });
  const text = buildMessagingRuleNotificationText({
    actionType: context.type,
    content,
    provider: context.messagingChannel.provider,
  });

  try {
    const response = await sendAutomationMessage({
      channel: context.messagingChannel,
      route,
      text,
      logger,
    });

    await prisma.executedAction.update({
      where: { id: context.id },
      data: {
        messagingMessageId: response.messageId ?? response.channelId ?? null,
        messagingMessageSentAt: new Date(),
        messagingMessageStatus: MessagingMessageStatus.SENT,
      },
    });
    return { delivered: true, kind: "view_only" };
  } catch (error) {
    logger.warn("发送已关联的消息规则通知失败", {
      executedActionId: context.id,
      provider: context.messagingChannel.provider,
      error,
    });
    return { delivered: false, kind: "none" };
  }
}

function hasLinkedMessagingDirectMessageDestination(channel: {
  provider: MessagingProvider;
  providerUserId?: string | null;
  teamId?: string | null;
}) {
  switch (channel.provider) {
    case MessagingProvider.TEAMS:
      return Boolean(channel.providerUserId);
    case MessagingProvider.TELEGRAM:
      return Boolean(channel.teamId || channel.providerUserId);
    default:
      return false;
  }
}

async function sendTelegramRuleNotificationWithContext({
  context,
  email,
  logger,
}: {
  context: NotificationContext;
  email: NotificationEmailPreview;
  logger: Logger;
}): Promise<MessagingRuleNotificationResult> {
  if (
    !context.messagingChannel?.isConnected ||
    context.messagingChannel.provider !== MessagingProvider.TELEGRAM
  ) {
    logger.warn("Telegram 渠道未启用，跳过通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const route = getMessagingRoute(
    context.messagingChannel.routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );
  const destination = route?.targetId || context.messagingChannel.teamId;

  if (!destination) {
    logger.warn("缺少路由目标，跳过 Telegram 通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  let telegramAdapter: ReturnType<
    typeof getMessagingAdapterRegistry
  >["typedAdapters"]["telegram"];

  try {
    telegramAdapter = getMessagingAdapterRegistry().typedAdapters.telegram;
  } catch {
    telegramAdapter = undefined;
  }

  if (!telegramAdapter) {
    logger.warn("缺少适配器，跳过 Telegram 通知", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
    });
    return { delivered: false, kind: "none" };
  }

  const draftContent = await getNotificationDraftContent({
    context,
    logger,
  });
  const draftAttachmentNames = getNotificationDraftAttachmentNames({
    context,
    logger,
  });

  const content = buildNotificationContent({
    actionType: context.type,
    email,
    systemType: context.executedRule.rule?.systemType ?? null,
    draftContent,
    draftAttachmentNames,
    format: "plain",
  });

  try {
    const threadId = await telegramAdapter.openDM(destination);
    const response = await telegramAdapter.postMessage(
      threadId,
      buildTelegramNotificationCard({
        actionId: context.id,
        content,
        openLink: getNotificationOpenLink(context, email.externalUrl),
      }),
    );

    await prisma.executedAction.update({
      where: { id: context.id },
      data: {
        messagingMessageId: response.id ?? threadId,
        messagingMessageSentAt: new Date(),
        messagingMessageStatus: MessagingMessageStatus.SENT,
      },
    });
    return { delivered: true, kind: "interactive" };
  } catch (error) {
    logger.warn("发送 Telegram 规则通知失败", {
      executedActionId: context.id,
      error,
    });
    return { delivered: false, kind: "none" };
  }
}

export async function handleRuleNotificationAction({
  event,
  logger,
}: {
  event: ActionEvent;
  logger: Logger;
}) {
  const selection = getRuleNotificationActionSelection(event);
  if (!selection) {
    await postNotificationFeedback({
      event,
      logger,
      text: "该通知已失效或已过期。",
    });
    return;
  }

  const context =
    event.adapter.name === "telegram"
      ? await getAuthorizedTelegramNotificationContext({
          executedActionId: selection.executedActionId,
          logger,
          chatId: getTelegramChatId(event),
          userId: event.user.userId,
          event,
        })
      : await getAuthorizedSlackNotificationContext({
          executedActionId: selection.executedActionId,
          logger,
          teamId: getSlackTeamId(event.raw),
          userId: event.user.userId,
          event,
        });
  if (!context) return;

  switch (selection.actionId) {
    case RULE_DRAFT_SEND_ACTION_ID:
      await handleDraftSend({ context, event, logger });
      return;
    case RULE_DRAFT_EDIT_ACTION_ID:
      if (context.messagingChannel?.provider !== MessagingProvider.SLACK) {
        await postNotificationFeedback({
          event,
          logger,
          text: "此处暂不支持编辑。请直接在这里回复你想修改的内容。",
        });
        return;
      }
      await handleDraftEdit({ context, event, logger });
      return;
    case RULE_DRAFT_DISMISS_ACTION_ID:
      await handleDismissNotification({ context, event, logger });
      return;
    case RULE_NOTIFY_ARCHIVE_ACTION_ID:
      await handleArchiveNotification({ context, event, logger });
      return;
    case RULE_NOTIFY_MARK_READ_ACTION_ID:
      await handleMarkReadNotification({ context, event, logger });
      return;
    case RULE_NOTIFY_TRASH_ACTION_ID:
      await handleTrashNotification({ context, event, logger });
      return;
    case RULE_NOTIFY_MARK_SPAM_ACTION_ID:
      await handleMarkSpamNotification({ context, event, logger });
      return;
    default:
      await postNotificationFeedback({
        event,
        logger,
        text: "不支持该通知操作。",
      });
  }
}

export async function handleSlackRuleNotificationModalSubmit({
  event,
  logger,
}: {
  event: ModalSubmitEvent;
  logger: Logger;
}): Promise<ModalResponse | undefined> {
  const executedActionId = event.privateMetadata?.trim();
  if (!executedActionId) {
    return { action: "close" };
  }

  const context = await getAuthorizedSlackNotificationContext({
    executedActionId,
    logger,
    teamId: getSlackTeamId(event.raw),
    userId: event.user.userId,
  });
  if (!context) {
    return { action: "close" };
  }

  const nextContent = event.values[SLACK_DRAFT_EDIT_FIELD_ID]?.trim() || "";
  if (!nextContent) {
    return {
      action: "errors",
      errors: {
        [SLACK_DRAFT_EDIT_FIELD_ID]: "草稿内容不能为空。",
      },
    };
  }

  if (!canEditDraft(context.messagingMessageStatus)) {
    return { action: "close" };
  }

  const mailboxDraftAction = getMailboxDraftActionForMessagingDraft(context);

  if (mailboxDraftAction?.draftId) {
    try {
      const provider = await createProviderForContext(context, logger);

      await provider.updateDraft(mailboxDraftAction.draftId, {
        messageHtml: convertNewlinesToBr(escapeHtml(nextContent)),
        ...(mailboxDraftAction.subject
          ? { subject: mailboxDraftAction.subject }
          : {}),
      });
    } catch (error) {
      logger.warn("将编辑后的 Slack 草稿同步回邮件草稿失败", {
        executedActionId: context.id,
        mailboxDraftActionId: mailboxDraftAction.id,
        error,
      });
      return {
        action: "errors",
        errors: {
          [SLACK_DRAFT_EDIT_FIELD_ID]: "无法更新该草稿。请重试。",
        },
      };
    }
  }

  await prisma.executedAction.updateMany({
    where: {
      id: {
        in: [context.id, mailboxDraftAction?.id].filter(Boolean) as string[],
      },
    },
    data: {
      content: nextContent,
    },
  });

  try {
    await sendDraftReplyFromNotification({
      context: { ...context, content: nextContent },
      logger,
      editMessage: async (card) => {
        if (!event.relatedMessage) {
          throw new Error("提交 Slack 草稿弹窗时缺少关联消息");
        }

        await event.relatedMessage.edit(card);
      },
    });
  } catch (error) {
    logger.warn("发送编辑后的 Slack 草稿通知回复失败", {
      executedActionId: context.id,
      error,
    });
    return {
      action: "errors",
      errors: {
        [SLACK_DRAFT_EDIT_FIELD_ID]: "无法发送该草稿。请重试。",
      },
    };
  }

  return { action: "close" };
}

function getRuleNotificationActionSelection(event: ActionEvent): {
  actionId: string;
  executedActionId: string;
} | null {
  const value = event.value?.trim();
  if (!value) return null;

  if (event.actionId !== RULE_NOTIFY_MORE_ACTION_ID) {
    if (!isDirectRuleNotificationActionId(event.actionId)) return null;

    return {
      actionId: event.actionId,
      executedActionId: value,
    };
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;

  const selectedActionId = value.slice(0, separatorIndex);
  if (
    selectedActionId !== RULE_NOTIFY_TRASH_ACTION_ID &&
    selectedActionId !== RULE_NOTIFY_MARK_SPAM_ACTION_ID
  ) {
    return null;
  }

  return {
    actionId: selectedActionId,
    executedActionId: value.slice(separatorIndex + 1),
  };
}

function isDirectRuleNotificationActionId(actionId: string) {
  return (
    actionId === RULE_DRAFT_SEND_ACTION_ID ||
    actionId === RULE_DRAFT_EDIT_ACTION_ID ||
    actionId === RULE_DRAFT_DISMISS_ACTION_ID ||
    actionId === RULE_NOTIFY_ARCHIVE_ACTION_ID ||
    actionId === RULE_NOTIFY_MARK_READ_ACTION_ID ||
    actionId === RULE_NOTIFY_TRASH_ACTION_ID ||
    actionId === RULE_NOTIFY_MARK_SPAM_ACTION_ID
  );
}

async function handleDraftSend({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  if (!canSendDraft(context.messagingMessageStatus)) {
    await postNotificationFeedback({
      event,
      logger,
      text: "该草稿已处理完毕。",
    });
    return;
  }

  try {
    const result = await sendDraftReplyFromNotification({
      context,
      logger,
      editMessage: async (card) => {
        await event.adapter.editMessage(event.threadId, event.messageId, card);
      },
    });

    if (result === "draft_unavailable") {
      await postNotificationFeedback({
        event,
        logger,
        text: "该草稿已不可用。",
      });
    }
  } catch (error) {
    logger.warn("发送 Slack 草稿通知回复失败", {
      executedActionId: context.id,
      error,
    });
    await postNotificationFeedback({
      event,
      logger,
      text: "无法发送该草稿。请重试。",
    });
  }
}

async function sendDraftReplyFromNotification({
  context,
  logger,
  editMessage,
}: {
  context: NotificationContext;
  logger: Logger;
  editMessage: (card: CardElement) => Promise<void>;
}): Promise<"sent" | "draft_unavailable"> {
  const provider = await createProviderForContext(context, logger);

  const mailboxDraftAction = getMailboxDraftActionForMessagingDraft(context);
  const finalDraftContent = await getEditableDraftContent({
    context,
    provider,
    mailboxDraftAction,
  });
  const sourceMessageSummary = await getSourceMessageSummaryForProvider({
    context,
    provider,
  });
  const draftAttachmentNames = getNotificationDraftAttachmentNames({
    context,
    logger,
  });
  const notificationContent = buildNotificationContent({
    actionType: context.type,
    email: sourceMessageSummary,
    systemType: context.executedRule.rule?.systemType ?? null,
    draftContent: finalDraftContent,
    draftAttachmentNames,
    format:
      context.messagingChannel?.provider === MessagingProvider.SLACK
        ? "slack"
        : "plain",
  });

  if (mailboxDraftAction?.draftId) {
    await provider.sendDraft(mailboxDraftAction.draftId);
  } else {
    const sourceMessage = await provider.getMessage(
      context.executedRule.messageId,
    );
    const attachments = await resolveActionAttachments({
      email: sourceMessage,
      emailAccount: {
        email: context.executedRule.emailAccount.email,
        id: context.executedRule.emailAccount.id,
        userId: context.executedRule.emailAccount.userId,
      },
      executedRule: {
        id: context.executedRule.id,
        threadId: context.executedRule.threadId,
        emailAccountId: context.executedRule.emailAccount.id,
        ruleId: context.executedRule.ruleId,
      } as ExecutedRule,
      logger,
      staticAttachments: context.staticAttachments,
      selectedAttachments: context.selectedAttachments,
      includeAiSelectedAttachments: true,
    });

    const content = context.content?.trim();
    if (!content) {
      await prisma.executedAction.update({
        where: { id: context.id },
        data: {
          messagingMessageStatus: MessagingMessageStatus.EXPIRED,
        },
      });

      await editMessage(
        buildTerminalCard({
          title: "草稿不可用",
          message: "该草稿已不可用。",
        }),
      );

      return "draft_unavailable";
    }

    const formattedFrom = await getFormattedSenderAddress({
      emailAccountId: context.executedRule.emailAccount.id,
      fallbackEmail: context.executedRule.emailAccount.email,
    });

    await provider.sendEmailWithHtml(
      buildNotificationReplySendBody({
        sourceMessage,
        fallbackThreadId: context.executedRule.threadId,
        to: context.to,
        cc: context.cc,
        bcc: context.bcc,
        subject: context.subject,
        content,
        formattedFrom,
        attachments: serializeMailAttachments(attachments),
      }),
    );
  }

  try {
    await Promise.all([
      prisma.executedAction.update({
        where: { id: context.id },
        data: {
          draftStatus: DraftEmailStatus.LIKELY_SENT,
          messagingMessageStatus: MessagingMessageStatus.DRAFT_SENT,
        },
      }),
      ...(mailboxDraftAction?.id && mailboxDraftAction.id !== context.id
        ? [
            prisma.executedAction.update({
              where: { id: mailboxDraftAction.id },
              data: { draftStatus: DraftEmailStatus.LIKELY_SENT },
            }),
          ]
        : []),
    ]);
  } catch (error) {
    logger.warn("将通知中的草稿回复标记为已发送失败", {
      executedActionId: context.id,
      mailboxDraftActionId: mailboxDraftAction?.id,
      error,
    });
  }

  await updateSentDraftNotificationMessage({
    context,
    logger,
    editMessage,
    card: buildHandledNotificationCardForProvider({
      provider: context.messagingChannel?.provider,
      content: notificationContent,
      openLink: getNotificationOpenLink(
        context,
        sourceMessageSummary.externalUrl,
      ),
      status: "回复已发送。✅",
    }),
  });

  await replaceMessagingDraftNotificationsWithDraftSentState({
    executedRuleId: context.executedRule.id,
    logger,
    excludeExecutedActionId: context.id,
  });

  return "sent";
}

async function updateSentDraftNotificationMessage({
  context,
  logger,
  editMessage,
  card,
}: {
  context: NotificationContext;
  logger: Logger;
  editMessage: (card: CardElement) => Promise<void>;
  card: CardElement;
}) {
  try {
    await editMessage(card);
    return;
  } catch (error) {
    logger.warn("更新已发送草稿的通知消息失败", {
      executedActionId: context.id,
      error,
    });
  }

  await updateStoredSlackNotificationMessage({
    context,
    logger,
    card,
  });
}

async function updateStoredSlackNotificationMessage({
  context,
  logger,
  card,
}: {
  context: NotificationContext;
  logger: Logger;
  card: CardElement;
}) {
  if (
    !context.messagingMessageId ||
    !context.messagingChannel ||
    !isOperationalSlackChannel(context.messagingChannel)
  ) {
    return;
  }

  const route = getMessagingRoute(
    context.messagingChannel.routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  try {
    const destinationChannelId = await resolveSlackRouteDestination({
      accessToken: context.messagingChannel.accessToken,
      route,
    });

    if (!destinationChannelId) {
      logger.warn("缺少路由，跳过已发送 Slack 草稿通知的更新", {
        executedActionId: context.id,
        messagingChannelId: context.messagingChannelId,
      });
      return;
    }

    await updateSlackCard({
      accessToken: context.messagingChannel.accessToken,
      channel: destinationChannelId,
      ts: context.messagingMessageId,
      card,
    });
  } catch (error) {
    logger.warn("更新已存储的 Slack 草稿通知消息失败", {
      executedActionId: context.id,
      messagingMessageId: context.messagingMessageId,
      error,
    });
  }
}

async function updateSlackCard({
  accessToken,
  channel,
  ts,
  card,
}: {
  accessToken: string;
  channel: string;
  ts: string;
  card: CardElement;
}) {
  await createSlackClient(accessToken).chat.update(
    disableSlackLinkUnfurls({
      channel,
      ts,
      text: cardToFallbackText(card),
      blocks: cardToBlockKit(card),
    }),
  );
}

export function buildNotificationReplySendBody({
  sourceMessage,
  fallbackThreadId,
  to,
  cc,
  bcc,
  subject,
  content,
  formattedFrom,
  attachments,
}: {
  sourceMessage: Pick<ParsedMessage, "id" | "threadId" | "headers">;
  fallbackThreadId: string;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  subject?: string | null;
  content: string;
  formattedFrom?: string | null;
  attachments: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}) {
  return {
    replyToEmail: {
      threadId: sourceMessage.threadId || fallbackThreadId,
      headerMessageId: sourceMessage.headers["message-id"] || "",
      references: sourceMessage.headers.references,
      messageId: sourceMessage.id,
    },
    to: to || sourceMessage.headers["reply-to"] || sourceMessage.headers.from,
    cc: cc ?? undefined,
    bcc: bcc ?? undefined,
    subject: subject || formatReplySubject(sourceMessage.headers.subject),
    messageHtml: convertNewlinesToBr(escapeHtml(content)),
    ...(formattedFrom ? { from: formattedFrom } : {}),
    attachments,
  };
}

async function handleDraftEdit({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  if (!canEditDraft(context.messagingMessageStatus)) {
    await postNotificationFeedback({
      event,
      logger,
      text: "该草稿已处理完毕。",
    });
    return;
  }

  const provider = await createProviderForContext(context, logger);

  const mailboxDraftAction = getMailboxDraftActionForMessagingDraft(context);
  const initialContent = await getEditableDraftContent({
    context,
    provider,
    mailboxDraftAction,
  });

  await event.openModal({
    type: "modal",
    callbackId: SLACK_DRAFT_EDIT_MODAL_ID,
    title: "编辑草稿",
    submitLabel: "发送回复",
    privateMetadata: context.id,
    children: [
      {
        type: "text_input",
        id: SLACK_DRAFT_EDIT_FIELD_ID,
        label: "草稿",
        multiline: true,
        initialValue: initialContent,
      },
    ],
  });
}

async function handleDismissNotification({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  if (!canSendDraft(context.messagingMessageStatus)) {
    await postNotificationFeedback({
      event,
      logger,
      text: isDraftReplyActionType(context.type)
        ? "该草稿已处理完毕。"
        : "该通知已处理完毕。",
    });
    return;
  }

  await prisma.executedAction.update({
    where: { id: context.id },
    data: {
      messagingMessageStatus: MessagingMessageStatus.DISMISSED,
    },
  });

  await event.adapter.editMessage(
    event.threadId,
    event.messageId,
    buildTerminalCard({
      title: isDraftReplyActionType(context.type)
        ? "回复草稿"
        : getInfoNotificationTitle(
            context.executedRule.rule?.systemType ?? null,
          ),
      message: "已忽略。",
    }),
  );
}

async function handleArchiveNotification({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  const provider = await createProviderForContext(context, logger);

  await provider.archiveThread(
    context.executedRule.threadId,
    context.executedRule.emailAccount.email,
  );

  await event.adapter.editMessage(
    event.threadId,
    event.messageId,
    buildTerminalCard({
      title: getInfoNotificationTitle(
        context.executedRule.rule?.systemType ?? null,
      ),
      message: "已归档。",
    }),
  );
}

async function handleMarkReadNotification({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  const provider = await createProviderForContext(context, logger);

  await provider.markRead(context.executedRule.threadId);

  await event.adapter.editMessage(
    event.threadId,
    event.messageId,
    buildTerminalCard({
      title: getInfoNotificationTitle(
        context.executedRule.rule?.systemType ?? null,
      ),
      message: "已标记为已读。",
    }),
  );
}

async function handleTrashNotification({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  const provider = await createProviderForContext(context, logger);

  await provider.trashThread(
    context.executedRule.threadId,
    context.executedRule.emailAccount.email,
    "user",
  );

  await event.adapter.editMessage(
    event.threadId,
    event.messageId,
    buildTerminalCard({
      title: getInfoNotificationTitle(
        context.executedRule.rule?.systemType ?? null,
      ),
      message: "已移至回收站。",
    }),
  );
}

async function handleMarkSpamNotification({
  context,
  event,
  logger,
}: {
  context: NotificationContext;
  event: ActionEvent;
  logger: Logger;
}) {
  const provider = await createProviderForContext(context, logger);

  await provider.markSpam(context.executedRule.threadId);

  await event.adapter.editMessage(
    event.threadId,
    event.messageId,
    buildTerminalCard({
      title: getInfoNotificationTitle(
        context.executedRule.rule?.systemType ?? null,
      ),
      message: "已标记为垃圾邮件。",
    }),
  );
}

async function getAuthorizedSlackNotificationContext({
  executedActionId,
  logger,
  teamId,
  userId,
  event,
}: {
  executedActionId: string;
  logger: Logger;
  teamId: string | null;
  userId: string;
  event?: ActionEvent;
}) {
  const context = await getNotificationContext(executedActionId);

  if (
    !context?.messagingChannel ||
    !isOperationalSlackChannel(context.messagingChannel)
  ) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "该通知已不再有效。",
      });
    }
    return null;
  }

  if (
    context.messagingChannel.providerUserId &&
    context.messagingChannel.providerUserId !== userId
  ) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "你无权对该通知执行操作。",
      });
    }
    return null;
  }

  if (teamId && context.messagingChannel.teamId !== teamId) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "该通知已不再匹配此工作区。",
      });
    }
    return null;
  }

  return context;
}

async function getAuthorizedTelegramNotificationContext({
  executedActionId,
  logger,
  chatId,
  userId,
  event,
}: {
  executedActionId: string;
  logger: Logger;
  chatId: string | null;
  userId: string;
  event?: ActionEvent;
}) {
  const context = await getNotificationContext(executedActionId);

  if (
    !context?.messagingChannel ||
    context.messagingChannel.provider !== MessagingProvider.TELEGRAM ||
    !context.messagingChannel.isConnected
  ) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "该通知已不再有效。",
      });
    }
    return null;
  }

  if (
    context.messagingChannel.providerUserId &&
    context.messagingChannel.providerUserId !== userId
  ) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "你无权对该通知执行操作。",
      });
    }
    return null;
  }

  const expectedChatId =
    getMessagingRoute(
      context.messagingChannel.routes,
      MessagingRoutePurpose.RULE_NOTIFICATIONS,
    )?.targetId ?? context.messagingChannel.teamId;

  if (chatId && expectedChatId !== chatId) {
    if (event) {
      await postNotificationFeedback({
        event,
        logger,
        text: "该通知已不再匹配此聊天。",
      });
    }
    return null;
  }

  return context;
}

async function getNotificationContext(executedActionId: string) {
  return prisma.executedAction.findUnique({
    where: { id: executedActionId },
    select: {
      id: true,
      type: true,
      content: true,
      subject: true,
      to: true,
      cc: true,
      bcc: true,
      draftId: true,
      staticAttachments: true,
      selectedAttachments: true,
      messagingChannelId: true,
      messagingMessageId: true,
      messagingMessageStatus: true,
      executedRule: {
        select: {
          id: true,
          ruleId: true,
          messageId: true,
          threadId: true,
          emailAccount: {
            select: {
              id: true,
              userId: true,
              email: true,
              account: {
                select: {
                  provider: true,
                },
              },
            },
          },
          rule: {
            select: {
              systemType: true,
            },
          },
          actionItems: {
            where: {
              id: { not: executedActionId },
              type: ActionType.DRAFT_EMAIL,
              draftId: { not: null },
            },
            select: {
              id: true,
              draftId: true,
              subject: true,
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
          },
        },
      },
      messagingChannel: {
        select: {
          id: true,
          emailAccountId: true,
          provider: true,
          isConnected: true,
          teamId: true,
          providerUserId: true,
          accessToken: true,
          routes: {
            select: {
              purpose: true,
              targetType: true,
              targetId: true,
            },
          },
        },
      },
    },
  });
}

function getMailboxDraftActionForMessagingDraft(context: NotificationContext) {
  if (context.draftId) {
    return {
      id: context.id,
      draftId: context.draftId,
      subject: context.subject,
    };
  }

  return context.executedRule.actionItems?.[0] ?? null;
}

async function getEditableDraftContent({
  context,
  provider,
  mailboxDraftAction,
}: {
  context: NotificationContext;
  provider: Awaited<ReturnType<typeof createEmailProvider>>;
  mailboxDraftAction: Awaited<
    ReturnType<typeof getMailboxDraftActionForMessagingDraft>
  >;
}) {
  if (mailboxDraftAction?.draftId) {
    try {
      const latestDraft = await provider.getDraft(mailboxDraftAction.draftId);
      if (latestDraft) {
        const text = stripQuotedContent(extractDraftPlainText(latestDraft));
        if (text) return text;
      }
    } catch {
      // 回退到下方已存储的内容。
    }
  }

  return stripQuotedContent(context.content || "");
}

async function getNotificationDraftContent({
  context,
  logger,
}: {
  context: NotificationContext;
  logger: Logger;
}) {
  if (!isDraftReplyActionType(context.type)) return context.content;

  const mailboxDraftAction = getMailboxDraftActionForMessagingDraft(context);

  if (!mailboxDraftAction?.draftId) return context.content;

  try {
    const provider = await createProviderForContext(context, logger);

    return await getEditableDraftContent({
      context,
      provider,
      mailboxDraftAction,
    });
  } catch (error) {
    logger.warn("加载用于通知预览的已同步邮箱草稿失败", {
      executedActionId: context.id,
      mailboxDraftActionId: mailboxDraftAction.id,
      error,
    });
    return context.content;
  }
}

function getNotificationDraftAttachmentNames({
  context,
  logger,
}: {
  context: NotificationContext;
  logger: Logger;
}) {
  if (!isDraftReplyActionType(context.type)) return [];

  const staticAttachmentNames = getStaticDraftAttachmentNames(
    context.staticAttachments,
  );
  const selectedAttachmentNames = getSelectedDraftAttachmentNames(
    context.selectedAttachments,
    logger,
    context.id,
  );

  return [...selectedAttachmentNames, ...staticAttachmentNames];
}

function getStaticDraftAttachmentNames(raw: unknown) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return [];

  const parsed = attachmentSourceInputSchema.array().safeParse(raw);
  if (!parsed.success) return [];

  return parsed.data
    .filter((attachment) => attachment.type === AttachmentSourceType.FILE)
    .map((attachment) => attachment.name);
}

function getSelectedDraftAttachmentNames(
  raw: unknown,
  logger: Logger,
  executedActionId: string,
) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return [];

  const parsed = selectedAttachmentSchema.array().safeParse(raw);
  if (!parsed.success) {
    logger.warn("跳过无效的已选附件元数据", {
      executedActionId,
    });
    return [];
  }

  return parsed.data.map((attachment) => attachment.filename);
}

async function getSourceMessageSummaryForProvider({
  context,
  provider,
}: {
  context: NotificationContext;
  provider: Awaited<ReturnType<typeof createEmailProvider>>;
}) {
  const message = await provider.getMessage(context.executedRule.messageId);

  return {
    headers: {
      from: message.headers.from,
      subject: message.headers.subject,
    },
    snippet: message.snippet,
    textPlain: message.textPlain,
    textHtml: message.textHtml,
    attachments: message.attachments,
    externalUrl: message.externalUrl,
  };
}

function buildNotificationContent({
  actionType,
  email,
  systemType,
  draftContent,
  draftAttachmentNames,
  format,
}: {
  actionType: ActionType;
  email: NotificationEmailPreview;
  systemType: SystemType | null;
  draftContent?: string | null;
  draftAttachmentNames?: string[];
  format: NotificationContentFormat;
}): NotificationContent {
  if (isDraftReplyActionType(actionType)) {
    const senderName = formatNotificationText(
      extractNameFromEmail(email.headers.from),
      format,
    );
    const senderEmail = formatNotificationText(
      extractEmailAddress(email.headers.from),
      format,
    );
    const senderDisplay =
      senderEmail && senderName !== senderEmail
        ? `${senderName} (${senderEmail})`
        : senderName;
    const subject = formatNotificationText(
      truncate(he.decode(email.headers.subject), 80),
      format,
    );

    const emailPreview = buildEmailPreview(email, { format });
    const draftPreview = buildDraftPreview(draftContent, { format });

    const summary = `你收到了一封来自 *${senderDisplay}* 的邮件。\n*主题：* ${subject}`;

    const details: string[] = [];
    if (emailPreview) {
      const preview =
        format === "slack"
          ? quotePlainTextContent(emailPreview) || emailPreview
          : emailPreview;
      details.push(`💬 *对方写道：*\n${preview}`);
    }
    details.push(`✍️ *我已为你拟好回复草稿：*\n${draftPreview}`);
    const attachmentSummary = buildDraftAttachmentSummary(
      draftAttachmentNames,
      { format },
    );
    if (attachmentSummary) {
      details.push(`📎 *附件：* ${attachmentSummary}`);
    }

    return {
      title: "✍️ 我已为你拟好回复草稿",
      summary,
      details,
    };
  }

  if (systemType === SystemType.CALENDAR) {
    const calendarEvent = analyzeCalendarEvent(toCalendarPreviewMessage(email));

    const lines = [
      calendarEvent.eventTitle
        ? `事件：${calendarEvent.eventTitle}`
        : `主题：${email.headers.subject}`,
      calendarEvent.eventDateString
        ? `时间：${calendarEvent.eventDateString}`
        : null,
      calendarEvent.organizer ? `组织者：${calendarEvent.organizer}` : null,
      buildEmailPreview(email, { format }),
    ].filter(Boolean);

    return {
      title: "📅 给你的日历邀请",
      summary: lines.join("\n"),
    };
  }

  return {
    title: getNotificationTitleForSystemType(systemType),
    summary: buildEmailSummary(email),
    details: [
      buildNotificationDetailSection({
        label: "预览",
        value: buildEmailPreview(email, { format }),
      }),
    ].filter(Boolean) as string[],
  };
}

function getDraftReplyButtons({
  actionId,
  openLink,
}: {
  actionId: string;
  openLink?: NotificationOpenLink | null;
}) {
  return {
    send: Button({
      id: RULE_DRAFT_SEND_ACTION_ID,
      label: "发送回复",
      style: "primary",
      value: actionId,
    }),
    open: openLink ? LinkButton(openLink) : null,
    dismiss: Button({
      id: RULE_DRAFT_DISMISS_ACTION_ID,
      label: "忽略",
      value: actionId,
    }),
  };
}

function buildNotificationCard({
  actionId,
  actionType,
  content,
  openLink,
}: {
  actionId: string;
  actionType: ActionType;
  content: NotificationContent;
  openLink?: NotificationOpenLink | null;
}): CardElement {
  const children = buildNotificationCardBody(content);
  const draftButtons = getDraftReplyButtons({ actionId, openLink });

  children.push(
    Actions(
      isDraftReplyActionType(actionType)
        ? [
            draftButtons.send,
            Button({
              id: RULE_DRAFT_EDIT_ACTION_ID,
              label: "编辑草稿",
              value: actionId,
            }),
            ...(draftButtons.open ? [draftButtons.open] : []),
            draftButtons.dismiss,
          ]
        : [
            Button({
              id: RULE_NOTIFY_ARCHIVE_ACTION_ID,
              label: "归档",
              style: "primary",
              value: actionId,
            }),
            Button({
              id: RULE_NOTIFY_MARK_READ_ACTION_ID,
              label: "标记已读",
              value: actionId,
            }),
            ...(openLink ? [LinkButton(openLink)] : []),
            Button({
              id: RULE_DRAFT_DISMISS_ACTION_ID,
              label: "忽略",
              value: actionId,
            }),
            Select({
              id: RULE_NOTIFY_MORE_ACTION_ID,
              label: "更多",
              placeholder: "更多",
              options: [
                SelectOption({
                  label: "删除",
                  value: `${RULE_NOTIFY_TRASH_ACTION_ID}:${actionId}`,
                }),
                SelectOption({
                  label: "垃圾邮件",
                  value: `${RULE_NOTIFY_MARK_SPAM_ACTION_ID}:${actionId}`,
                }),
              ],
            }),
          ],
    ),
  );

  return Card({
    title: content.title,
    children,
  });
}

function buildTerminalCard({
  title,
  message,
}: {
  title: string;
  message: string;
}): CardElement {
  return Card({
    title,
    children: [CardText(message)],
  });
}

function buildTelegramNotificationCard({
  actionId,
  content,
  openLink,
}: {
  actionId: string;
  content: NotificationContent;
  openLink?: NotificationOpenLink | null;
}): CardElement {
  const children = buildNotificationCardBody(
    sanitizeTelegramNotificationContent(content),
  );
  const { send, open, dismiss } = getDraftReplyButtons({
    actionId,
    openLink,
  });
  children.push(Actions([send, ...(open ? [open] : []), dismiss]));

  return Card({
    children,
  });
}

function buildTelegramHandledNotificationCard({
  content,
  openLink,
  status,
}: {
  content: NotificationContent;
  openLink?: NotificationOpenLink | null;
  status: string;
}): CardElement {
  const children = buildNotificationCardBody(
    sanitizeTelegramNotificationContent(content),
  );
  children.push(CardText(sanitizeTelegramCardText(`状态：${status}`)));
  if (openLink) {
    children.push(Actions([LinkButton(openLink)]));
  }

  return Card({
    children,
  });
}

function buildHandledNotificationCardForProvider({
  provider,
  content,
  openLink,
  status,
}: {
  provider?: MessagingProvider | null;
  content: NotificationContent;
  openLink?: NotificationOpenLink | null;
  status: string;
}): CardElement {
  if (provider === MessagingProvider.TELEGRAM) {
    return buildTelegramHandledNotificationCard({ content, openLink, status });
  }

  return buildHandledNotificationCard({ content, openLink, status });
}

function sanitizeTelegramNotificationContent(
  content: NotificationContent,
): NotificationContent {
  return {
    title: sanitizeTelegramCardText(content.title),
    summary: sanitizeTelegramCardText(content.summary),
    details: content.details?.map(sanitizeTelegramCardText),
  };
}

function sanitizeTelegramCardText(text: string) {
  return neutralizeTelegramAutolinks(markdownToTelegramText(text));
}

function neutralizeTelegramAutolinks(text: string) {
  return text.replace(
    /https?:\/\/\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    (value) => `\`${value.replace(/`/g, "'")}\``,
  );
}

function buildHandledNotificationCard({
  content,
  openLink,
  status,
}: {
  content: NotificationContent;
  openLink?: NotificationOpenLink | null;
  status: string;
}): CardElement {
  const children = buildNotificationCardBody(content);
  children.push(CardText(`状态：${status}`));
  if (openLink) {
    children.push(Actions([LinkButton(openLink)]));
  }

  return Card({
    title: content.title,
    children,
  });
}

function buildDraftPreview(
  content: string | null | undefined,
  { format }: { format: NotificationContentFormat },
) {
  if (!content?.trim()) return "暂无草稿预览。";

  const preview = stripQuotedContent(
    removeExcessiveWhitespace(richTextToSlackMrkdwn(he.decode(content))).trim(),
  );
  return truncate(
    format === "slack" ? preview : stripSlackFormatting(preview),
    DRAFT_PREVIEW_MAX_CHARS,
  );
}

function buildDraftAttachmentSummary(
  attachmentNames: string[] | null | undefined,
  { format }: { format: NotificationContentFormat },
) {
  const uniqueNames = [
    ...new Set(
      (attachmentNames ?? [])
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
  if (uniqueNames.length === 0) return null;

  const visibleNames = uniqueNames
    .slice(0, MAX_DRAFT_ATTACHMENT_NAMES)
    .map((name) => formatNotificationText(name, format));
  const hiddenCount = uniqueNames.length - visibleNames.length;
  const suffix = hiddenCount > 0 ? ` 以及其他 ${hiddenCount} 个` : "";

  return `${visibleNames.join(", ")}${suffix}`;
}

function buildNotificationCardBody(content: NotificationContent): CardChild[] {
  const children: CardChild[] = [CardText(content.summary)];

  for (const detail of content.details ?? []) {
    children.push(CardText(detail));
  }

  return children;
}

export function buildMessagingRuleNotificationText({
  actionType,
  content,
  provider,
}: {
  actionType: ActionType;
  content: NotificationContent;
  provider: typeof MessagingProvider.TEAMS | typeof MessagingProvider.TELEGRAM;
}) {
  const sections = [
    content.title,
    stripSlackFormatting(content.summary),
    ...(content.details?.map(stripSlackFormatting) ?? []),
  ].filter(Boolean);

  const limitation = getLinkedProviderLimitationText({
    actionType,
    provider,
  });
  if (limitation) {
    sections.push(limitation);
  }

  return sections.join("\n\n");
}

function buildEmailSummary(email: {
  headers: {
    from: string;
    subject: string;
  };
}) {
  return [
    `*发件人：* ${email.headers.from}`,
    `*主题：* ${email.headers.subject}`,
  ].join("\n");
}

function buildEmailPreview(
  email: {
    snippet: string;
    textPlain?: string;
    textHtml?: string;
  },
  { format }: { format: NotificationContentFormat },
) {
  const rawPreview = emailToContent(email, {
    maxLength: 0,
    extractReply: true,
    includeLinkUrls: true,
  });
  const preview = formatNotificationText(
    removeExcessiveWhitespace(he.decode(rawPreview)).trim(),
    format,
  );
  if (!preview) return null;

  return truncate(preview, SUMMARY_PREVIEW_MAX_CHARS);
}

function formatNotificationText(
  text: string,
  format: NotificationContentFormat,
) {
  return format === "slack" ? escapeSlackText(text) : text;
}

function buildNotificationDetailSection({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) return null;

  return `*${label}*\n${normalizedValue}`;
}

function createProviderForContext(
  context: NotificationContext,
  logger: Logger,
) {
  return createEmailProvider({
    emailAccountId: context.executedRule.emailAccount.id,
    provider: context.executedRule.emailAccount.account.provider,
    logger,
  });
}

function getInfoNotificationTitle(systemType: SystemType | null) {
  return systemType === SystemType.CALENDAR ? "日历邀请" : "邮件通知";
}

function getNotificationOpenLink(
  context: NotificationContext,
  externalUrl?: string,
): NotificationOpenLink | null {
  const provider = context.executedRule.emailAccount.account.provider;
  const label = getOpenInMailboxLabel(provider);
  if (!label) return null;

  const url = getEmailUrlForOptionalMessage({
    messageId: context.executedRule.messageId,
    threadId: context.executedRule.threadId,
    emailAddress: context.executedRule.emailAccount.email,
    provider,
    externalUrl,
  });
  if (!url) return null;

  return {
    label,
    url,
  };
}

async function findSlackRootMessageId({
  executedActionId,
  emailAccountId,
  messagingChannelId,
  threadId,
}: {
  executedActionId: string;
  emailAccountId: string;
  messagingChannelId: string;
  threadId: string;
}) {
  const previous = await prisma.executedAction.findFirst({
    where: {
      id: { not: executedActionId },
      messagingChannelId,
      messagingMessageId: { not: null },
      executedRule: {
        emailAccountId,
        threadId,
      },
    },
    select: {
      messagingMessageId: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return previous?.messagingMessageId ?? null;
}

async function postSlackCard({
  accessToken,
  card,
  route,
  destinationChannelId,
  rootMessageId,
}: {
  accessToken: string;
  card: CardElement;
  route: {
    targetId: string;
    targetType: MessagingRouteTargetType;
  } | null;
  destinationChannelId: string;
  rootMessageId: string | null;
}) {
  const client = createSlackClient(accessToken);

  const args = disableSlackLinkUnfurls({
    channel: destinationChannelId,
    text: cardToFallbackText(card),
    blocks: cardToBlockKit(card),
    ...(rootMessageId ? { thread_ts: rootMessageId } : {}),
  });

  try {
    const response = await client.chat.postMessage(args);
    return response.ts ?? null;
  } catch (error) {
    if (
      isSlackError(error) &&
      error.data?.error === "not_in_channel" &&
      route?.targetType === MessagingRouteTargetType.CHANNEL
    ) {
      await client.conversations.join({ channel: route.targetId });
      const response = await client.chat.postMessage({
        ...args,
        channel: route.targetId,
      });
      return response.ts ?? null;
    }

    throw error;
  }
}

async function replaceMessagingDraftNotificationWithTerminalState({
  executedActionId,
  logger,
  terminalStatus,
  terminalMessage,
}: {
  executedActionId: string;
  logger: Logger;
  terminalStatus: MessagingMessageStatus;
  terminalMessage: string;
}) {
  const updated = await prisma.executedAction.updateMany({
    where: {
      id: executedActionId,
      OR: [
        { messagingMessageStatus: null },
        {
          messagingMessageStatus: {
            in: [
              MessagingMessageStatus.SENT,
              MessagingMessageStatus.DRAFT_EDITED,
            ],
          },
        },
      ],
    },
    data: {
      messagingMessageStatus: terminalStatus,
    },
  });

  if (updated.count === 0) {
    return;
  }

  const context = await getNotificationContext(executedActionId);

  if (!context?.messagingMessageId) {
    return;
  }

  if (
    !context.messagingChannel ||
    !isMessagingChannelOperational(context.messagingChannel)
  ) {
    logger.warn("渠道已断开，跳过消息草稿通知清理", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
      provider: context.messagingChannel?.provider,
    });
    return;
  }

  const route = getMessagingRoute(
    context.messagingChannel.routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  if (!route) {
    logger.warn("缺少路由，跳过消息草稿通知清理", {
      executedActionId: context.id,
      messagingChannelId: context.messagingChannelId,
      provider: context.messagingChannel.provider,
    });
    return;
  }

  const card = buildTerminalCard({
    title: "回复草稿",
    message: terminalMessage,
  });

  try {
    switch (context.messagingChannel.provider) {
      case MessagingProvider.SLACK: {
        const destinationChannelId = await resolveSlackRouteDestination({
          accessToken: context.messagingChannel.accessToken,
          route,
        });

        if (!destinationChannelId) {
          logger.warn("缺少目标，跳过 Slack 草稿通知清理", {
            executedActionId: context.id,
            messagingChannelId: context.messagingChannelId,
          });
          return;
        }

        await updateSlackCard({
          accessToken: context.messagingChannel.accessToken,
          channel: destinationChannelId,
          ts: context.messagingMessageId,
          card,
        });
        break;
      }
      case MessagingProvider.TEAMS: {
        const providerUserId =
          route.targetType === MessagingRouteTargetType.DIRECT_MESSAGE
            ? route.targetId
            : context.messagingChannel.providerUserId;

        if (!providerUserId) {
          logger.warn("缺少目标用户，跳过 Teams 草稿通知清理", {
            executedActionId: context.id,
            messagingChannelId: context.messagingChannelId,
          });
          return;
        }

        const teamsAdapter = getMessagingAdapterRegistry().typedAdapters.teams;
        if (!teamsAdapter) {
          logger.warn("缺少适配器，跳过 Teams 草稿通知清理", {
            executedActionId: context.id,
            messagingChannelId: context.messagingChannelId,
          });
          return;
        }

        const threadId = await teamsAdapter.openDM(providerUserId);
        await teamsAdapter.editMessage(
          threadId,
          context.messagingMessageId,
          terminalMessage,
        );
        break;
      }
      case MessagingProvider.TELEGRAM: {
        const destination = route.targetId || context.messagingChannel.teamId;
        if (!destination) {
          logger.warn("缺少目标，跳过 Telegram 草稿通知清理", {
            executedActionId: context.id,
            messagingChannelId: context.messagingChannelId,
          });
          return;
        }

        const telegramAdapter =
          getMessagingAdapterRegistry().typedAdapters.telegram;
        if (!telegramAdapter) {
          logger.warn("缺少适配器，跳过 Telegram 草稿通知清理", {
            executedActionId: context.id,
            messagingChannelId: context.messagingChannelId,
          });
          return;
        }

        const threadId = await telegramAdapter.openDM(destination);
        await telegramAdapter.editMessage(
          threadId,
          context.messagingMessageId,
          terminalMessage,
        );
        break;
      }
      default:
        return;
    }
  } catch (error) {
    logger.warn("草稿通知进入终态后折叠失败", {
      executedActionId: context.id,
      provider: context.messagingChannel.provider,
      terminalStatus,
      error,
    });
  }
}

async function postNotificationFeedback({
  event,
  logger,
  text,
}: {
  event: ActionEvent;
  logger: Logger;
  text: string;
}) {
  const thread = event.thread;
  if (!thread) return;

  if (event.adapter.name === "slack") {
    try {
      await thread.postEphemeral(event.user, text, { fallbackToDM: false });
      return;
    } catch (error) {
      logger.warn("发送 Slack 通知反馈失败", {
        actionId: event.actionId,
        error,
      });
    }
  }

  try {
    await thread.post(text);
  } catch (error) {
    logger.warn("发送规则通知反馈失败", {
      actionId: event.actionId,
      error,
    });
  }
}

function serializeMailAttachments(attachments: MailAttachment[]) {
  return attachments
    .map((attachment) => {
      if (!attachment.filename || !attachment.content) return null;

      const content = Buffer.isBuffer(attachment.content)
        ? attachment.content.toString("base64")
        : Buffer.from(String(attachment.content)).toString("base64");

      return {
        filename: attachment.filename,
        content,
        contentType: attachment.contentType || "application/octet-stream",
      };
    })
    .filter(Boolean) as Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

function canSendDraft(status: MessagingMessageStatus | null) {
  return (
    status !== MessagingMessageStatus.DRAFT_SENT &&
    status !== MessagingMessageStatus.DISMISSED &&
    status !== MessagingMessageStatus.EXPIRED
  );
}

function canEditDraft(status: MessagingMessageStatus | null) {
  return canSendDraft(status);
}

function isSlackError(
  error: unknown,
): error is Error & { data?: { error?: string } } {
  return error instanceof Error && "data" in error;
}

function toCalendarPreviewMessage(
  email: NotificationEmailPreview,
): ParsedMessage {
  return {
    attachments: (email.attachments ?? []).map((attachment) => ({
      attachmentId: "",
      filename: attachment.filename,
      headers: {
        "content-description": "",
        "content-id": "",
        "content-transfer-encoding": "",
        "content-type": "",
      },
      mimeType: "",
      size: 0,
    })),
    bodyContentType: "text",
    date: "",
    headers: {
      date: "",
      from: email.headers.from,
      subject: email.headers.subject,
      to: "",
    },
    historyId: "",
    id: "",
    inline: [],
    snippet: email.snippet,
    subject: email.headers.subject,
    textHtml: email.textHtml,
    textPlain: email.textPlain,
    threadId: "",
  };
}

function stripSlackFormatting(text: string) {
  const slackText = text
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2: $1")
    .replace(/\*([^*]+)\*/g, "$1");

  return he.decode(slackText);
}

function getLinkedProviderLimitationText({
  actionType,
  provider,
}: {
  actionType: ActionType;
  provider: typeof MessagingProvider.TEAMS | typeof MessagingProvider.TELEGRAM;
}) {
  const providerName =
    provider === MessagingProvider.TEAMS ? "Teams" : "Telegram";

  if (isDraftReplyActionType(actionType)) {
    return provider === MessagingProvider.TEAMS
      ? "Teams 暂不支持一键编辑和发送草稿。请使用 Inbox Zero 审核或发送该草稿。"
      : "Telegram 暂不支持编辑草稿。你可以从 Telegram 发送该草稿，或先用 Inbox Zero 修改。";
  }

  return `归档、标记已读等快捷操作目前仅支持 Slack，因此这条 ${providerName} 消息仅供查看。`;
}

function getNotificationTitleForSystemType(
  systemType: SystemType | null,
): string {
  switch (systemType) {
    case SystemType.NEWSLETTER:
      return "📰 给你一封新的新闻邮件";
    case SystemType.MARKETING:
      return "📢 给你一封新的营销邮件";
    case SystemType.RECEIPT:
      return "🧾 给你一张新的收据";
    case SystemType.COLD_EMAIL:
      return "❄️ 已拦截冷邮件";
    case SystemType.FYI:
      return "👀 供你参考";
    case SystemType.NOTIFICATION:
      return "🔔 给你一条新通知";
    case SystemType.OTP:
      return "🔐 你的新登录验证码";
    default:
      return "📬 给你一封新邮件";
  }
}
