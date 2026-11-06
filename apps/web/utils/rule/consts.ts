import {
  DEFAULT_COLD_EMAIL_PROMPT,
  LEGACY_DEFAULT_COLD_EMAIL_PROMPT,
} from "@/utils/cold-email/prompt";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import { env } from "@/env";

export const STANDARD_CATEGORY_SYSTEM_TYPES = [
  SystemType.TO_REPLY,
  SystemType.NEWSLETTER,
  SystemType.MARKETING,
  SystemType.CALENDAR,
  SystemType.RECEIPT,
  SystemType.NOTIFICATION,
  SystemType.COLD_EMAIL,
] as const;

/** Inbox tabs for enabled label-only rules. Includes opt-in types that onboarding does not create. */
export const DEFAULT_MAIL_SPLIT_SYSTEM_TYPES = [
  ...STANDARD_CATEGORY_SYSTEM_TYPES,
  SystemType.OTP,
] as const;

/** Owned prompts we do not seed, placeholder, or leave as disabled Rules rows. */
export const OPT_IN_SYSTEM_TYPES = [SystemType.OTP] as const;

const ruleConfig: Record<
  SystemType,
  {
    name: string;
    instructions: string;
    label: string;
    draftReply?: boolean;
    runOnThreads: boolean;
    categoryAction: "label" | "label_archive" | "move_folder";
    categoryActionMicrosoft?: "move_folder";
    tooltipText: string;
    shouldLearn: boolean;
    /**
     * Earlier default `instructions` for this rule. Rules store their
     * instructions at creation, so a row holding one of these is still on the
     * default, not customised.
     */
    previousInstructions?: readonly string[];
  }
> = {
  [SystemType.TO_REPLY]: {
    name: "待回复",
    instructions:
      "我需要回复的邮件：有人问我问题或向我提出请求，或者我承诺要发送某些东西但还没有发。",
    previousInstructions: [
      "Emails I need to respond to: someone asked me a question or requested something from me, or I promised to send something and haven't yet",
      "Emails I need to respond to",
    ],
    label: "待回复",
    draftReply: true,
    runOnThreads: true,
    categoryAction: "label",
    tooltipText:
      "你需要回复的邮件，以及你在等待对方回复的邮件。随着对话推进，标签会自动更新",
    shouldLearn: false,
  },
  [SystemType.AWAITING_REPLY]: {
    name: "等待回复",
    instructions:
      "我在等待对方回复的邮件：我询问或请求了某些事情，但对方还没有答复或交付。",
    previousInstructions: [
      "Emails where I'm waiting for someone to get back to me: I asked for or requested something and the other person hasn't answered or delivered it yet",
      "Emails where I'm waiting for someone to get back to me",
    ],
    label: "等待回复",
    runOnThreads: true,
    categoryAction: "label",
    tooltipText: "",
    shouldLearn: false,
  },
  [SystemType.FYI]: {
    name: "知悉",
    instructions:
      "我应该知道但不需要回复的重要邮件：发给我的信息、更新或公告，整个会话里没有任何提问或请求。",
    previousInstructions: [
      "Important emails I should know about, but don't need to reply to: information, updates or announcements sent to me, with no question or request anywhere in the thread",
      "Important emails I should know about, but don't need to reply to",
    ],
    label: "知悉",
    runOnThreads: true,
    categoryAction: "label",
    tooltipText: "",
    shouldLearn: false,
  },
  [SystemType.ACTIONED]: {
    name: "已处理",
    instructions:
      "已经结束、无事可做的会话：所有问题都已答复，所有请求都已满足或处理，没有任何人在等对方。",
    previousInstructions: [
      "Conversations that are done, nothing left to do: every question has been answered, every request fulfilled or taken care of, and nobody is waiting on anyone",
      "Conversations that are done, nothing left to do",
    ],
    label: "已处理",
    runOnThreads: true,
    categoryAction: "label",
    tooltipText: "",
    shouldLearn: false,
  },
  [SystemType.NEWSLETTER]: {
    name: "订阅简报",
    instructions: "订阅简报：我订阅的出版物、博客或服务定期发送的内容。",
    previousInstructions: [
      "Newsletters: Regular content from publications, blogs, or services I've subscribed to",
    ],
    label: "订阅简报",
    runOnThreads: false,
    categoryAction: "label",
    categoryActionMicrosoft: "move_folder",
    tooltipText: "简报、博客与订阅内容",
    shouldLearn: true,
  },
  [SystemType.MARKETING]: {
    name: "营销推广",
    instructions:
      "营销推广：可以安全归档的促销、打折和优惠邮件。排除主要目的是账号访问、交易或服务更新的邮件，即使它们含有推广内容。",
    previousInstructions: [
      "Marketing: Promotions, sales, and offers that can be safely archived. Exclude emails whose main purpose is account access, a transaction, or a service update, even if they include promotional content.",
    ],
    label: "营销推广",
    runOnThreads: false,
    categoryAction: "label_archive",
    categoryActionMicrosoft: "move_folder",
    tooltipText: "促销、优惠与营销邮件",
    shouldLearn: true,
  },
  [SystemType.CALENDAR]: {
    name: "日历",
    instructions: "日历：与日程安排、会议邀请或日历通知有关的任何邮件。",
    previousInstructions: [
      "Calendar: Any email related to scheduling, meeting invites, or calendar notifications",
    ],
    label: "日历",
    runOnThreads: false,
    categoryAction: "label",
    tooltipText: "活动、日程与提醒",
    shouldLearn: true,
  },
  [SystemType.RECEIPT]: {
    name: "收据",
    instructions: "收据：购买确认、付款收据、交易记录或发票。",
    previousInstructions: [
      "Receipts: Purchase confirmations, payment receipts, transaction records or invoices",
    ],
    label: "收据",
    runOnThreads: false,
    categoryAction: "label",
    categoryActionMicrosoft: "move_folder",
    tooltipText: "发票、收据与付款",
    shouldLearn: true,
  },
  [SystemType.NOTIFICATION]: {
    name: "通知",
    instructions: "通知：提醒、状态更新或系统消息。",
    previousInstructions: [
      "Notifications: Alerts, status updates, or system messages",
    ],
    label: "通知",
    runOnThreads: false,
    categoryAction: "label",
    categoryActionMicrosoft: "move_folder",
    tooltipText: "提醒、状态更新与系统消息",
    shouldLearn: true,
  },
  [SystemType.OTP]: {
    name: "验证码",
    instructions:
      "验证码：一次性密码、两步验证/多因素验证码、邮箱验证码，以及免密登录或重置密码链接。",
    previousInstructions: [
      "OTP: One-time passwords, 2FA/MFA codes, email verification codes, and magic sign-in or password-reset links.",
    ],
    label: "验证码",
    runOnThreads: false,
    categoryAction: "label",
    tooltipText: "一次性密码、两步验证码与登录链接",
    shouldLearn: true,
  },
  [SystemType.COLD_EMAIL]: {
    name: "冷邮件",
    instructions: DEFAULT_COLD_EMAIL_PROMPT,
    previousInstructions: [LEGACY_DEFAULT_COLD_EMAIL_PROMPT],
    label: "冷邮件",
    runOnThreads: false,
    categoryAction: "label_archive",
    categoryActionMicrosoft: "move_folder",
    tooltipText: "未经请求的推销与冷邮件。我们绝不会屏蔽曾给你发过邮件的人",
    shouldLearn: true,
  },
};

export function getRuleConfig(systemType: SystemType) {
  if (!ruleConfig[systemType])
    throw new Error(`Invalid system type: ${systemType}`);
  return ruleConfig[systemType];
}

/**
 * Whether a rule's stored instructions are still a default, current or
 * previous. Empty instructions count as default.
 */
export function isDefaultRuleInstructions(
  systemType: SystemType,
  instructions: string | null | undefined,
) {
  if (!instructions) return true;
  const config = getRuleConfig(systemType);
  return (
    instructions === config.instructions ||
    (config.previousInstructions?.includes(instructions) ?? false)
  );
}

export function getRuleName(systemType: SystemType) {
  return getRuleConfig(systemType).name;
}

export function getRuleLabel(systemType: SystemType) {
  return getRuleConfig(systemType).label;
}

export function shouldLearnFromLabelRemoval(systemType: SystemType): boolean {
  return getRuleConfig(systemType).shouldLearn;
}

export function isEligibleForClassificationFeedback(
  systemType: SystemType | null | undefined,
): boolean {
  if (!systemType) return true;
  return getRuleConfig(systemType).shouldLearn;
}

export function getCategoryAction(systemType: SystemType, provider: string) {
  const config = getRuleConfig(systemType);

  if (isMicrosoftProvider(provider)) {
    return config.categoryActionMicrosoft || config.categoryAction;
  }

  return config.categoryAction;
}

export function getDefaultActions(
  systemType: SystemType,
  provider: string,
): Array<{
  id: string;
  type: ActionType;
  label: string | null;
  labelId: string | null;
  to: string | null;
  subject: string | null;
  content: string | null;
  ruleId: string;
  folderId: string | null;
  folderName: string | null;
  url: string | null;
  cc: string | null;
  bcc: string | null;
  messagingChannelId: string | null;
  delayInMinutes: number | null;
  staticAttachments: null;
  integrationName: string | null;
  integrationToolName: string | null;
  integrationArgs: null;
  createdAt: Date;
  updatedAt: Date;
}> {
  const config = getRuleConfig(systemType);
  const categoryAction = getCategoryAction(systemType, provider);
  const now = new Date();
  const actions: Array<{
    id: string;
    type: ActionType;
    label: string | null;
    labelId: string | null;
    to: string | null;
    subject: string | null;
    content: string | null;
    ruleId: string;
    folderId: string | null;
    folderName: string | null;
    url: string | null;
    cc: string | null;
    bcc: string | null;
    messagingChannelId: string | null;
    delayInMinutes: number | null;
    staticAttachments: null;
    integrationName: string | null;
    integrationToolName: string | null;
    integrationArgs: null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  if (categoryAction === "move_folder") {
    actions.push({
      id: `placeholder-action-folder-${systemType}`,
      type: ActionType.MOVE_FOLDER,
      folderName: config.label,
      label: null,
      labelId: null,
      to: null,
      subject: null,
      content: null,
      ruleId: `placeholder-${systemType}`,
      folderId: null,
      url: null,
      cc: null,
      bcc: null,
      messagingChannelId: null,
      delayInMinutes: null,
      staticAttachments: null,
      integrationName: null,
      integrationToolName: null,
      integrationArgs: null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    actions.push({
      id: `placeholder-action-label-${systemType}`,
      type: ActionType.LABEL,
      label: config.label,
      labelId: null,
      to: null,
      subject: null,
      content: null,
      ruleId: `placeholder-${systemType}`,
      folderId: null,
      folderName: null,
      url: null,
      cc: null,
      bcc: null,
      messagingChannelId: null,
      delayInMinutes: null,
      staticAttachments: null,
      integrationName: null,
      integrationToolName: null,
      integrationArgs: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (categoryAction === "label_archive") {
    actions.push({
      id: `placeholder-action-archive-${systemType}`,
      type: ActionType.ARCHIVE,
      label: null,
      labelId: null,
      to: null,
      subject: null,
      content: null,
      ruleId: `placeholder-${systemType}`,
      folderId: null,
      folderName: null,
      url: null,
      cc: null,
      bcc: null,
      messagingChannelId: null,
      delayInMinutes: null,
      staticAttachments: null,
      integrationName: null,
      integrationToolName: null,
      integrationArgs: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (config.draftReply && !env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED) {
    actions.push({
      id: `placeholder-action-draft-${systemType}`,
      type: ActionType.DRAFT_EMAIL,
      label: null,
      labelId: null,
      to: null,
      subject: null,
      content: null,
      ruleId: `placeholder-${systemType}`,
      folderId: null,
      folderName: null,
      url: null,
      cc: null,
      bcc: null,
      messagingChannelId: null,
      delayInMinutes: null,
      staticAttachments: null,
      integrationName: null,
      integrationToolName: null,
      integrationArgs: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return actions;
}

type ActionTypeConfig = {
  type: ActionType;
  includeLabel?: boolean;
  includeFolder?: boolean;
};

export function getActionTypesForCategoryAction({
  categoryAction,
  systemType,
  draftReply = false,
  hasDigest = false,
}: {
  categoryAction: "label" | "label_archive" | "move_folder";
  systemType?: SystemType;
  draftReply?: boolean;
  hasDigest?: boolean;
}): ActionTypeConfig[] {
  const actionTypes: ActionTypeConfig[] = [];

  if (categoryAction === "move_folder") {
    actionTypes.push({ type: ActionType.MOVE_FOLDER, includeFolder: true });
  } else {
    actionTypes.push({ type: ActionType.LABEL, includeLabel: true });
  }

  if (categoryAction === "label_archive") {
    actionTypes.push({ type: ActionType.ARCHIVE });

    if (
      systemType === SystemType.COLD_EMAIL &&
      env.NEXT_PUBLIC_IS_RESEND_CONFIGURED
    ) {
      actionTypes.push({ type: ActionType.NOTIFY_SENDER });
    }
  }

  if (draftReply && !env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED) {
    actionTypes.push({ type: ActionType.DRAFT_EMAIL });
  }

  if (hasDigest) {
    actionTypes.push({ type: ActionType.DIGEST });
  }

  return actionTypes;
}

export function getSystemRuleActionTypes(
  systemType: SystemType,
  provider: string,
): ActionTypeConfig[] {
  const config = getRuleConfig(systemType);
  const categoryAction = getCategoryAction(systemType, provider);

  return getActionTypesForCategoryAction({
    categoryAction,
    systemType,
    draftReply: config.draftReply,
  });
}

export function isOptInSystemType(
  systemType: string | null | undefined,
): boolean {
  return (
    !!systemType &&
    (OPT_IN_SYSTEM_TYPES as readonly string[]).includes(systemType)
  );
}
