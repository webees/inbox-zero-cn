import {
  convertToModelMessages,
  readUIMessageStream,
  type UIMessage,
} from "ai";
import { createHmac } from "node:crypto";
import { env } from "@/env";
import type { Prisma } from "@/generated/prisma/client";
import { MessagingProvider } from "@/generated/prisma/enums";
import { aiProcessAssistantChat } from "@/utils/ai/assistant/chat";
import { getRecentChatMemories } from "@/utils/ai/assistant/get-recent-chat-memories";
import { getInboxStatsForChatContext } from "@/utils/ai/assistant/get-inbox-stats-for-chat-context";
import {
  mergeSeenRulesRevision,
  saveLastSeenRulesRevision,
} from "@/utils/ai/assistant/chat-seen-rules-revision";
import type { Logger } from "@/utils/logger";
import { normalizeMessagingAssistantText } from "@/utils/messaging/chat-sdk/bot";
import { PROMPT_COMMANDS } from "@/utils/messaging/prompt-commands";
import { markdownToSlackMrkdwn } from "@/utils/messaging/providers/slack/format";
import { disableSlackLinkUnfurls } from "@/utils/messaging/providers/slack/send";
import prisma from "@/utils/prisma";
import { getEmailAccountWithAi } from "@/utils/user/get";

const MAX_CHAT_CONTEXT_MESSAGES = 12;

export async function processSlackSlashCommand({
  command,
  userId,
  teamId,
  responseUrl,
  logger,
}: {
  command: string;
  userId: string;
  teamId: string;
  responseUrl: string;
  logger: Logger;
}): Promise<void> {
  const commandName = command.replace(/^\//, "");
  const expandedText = PROMPT_COMMANDS[commandName];

  if (!expandedText) {
    await postToSlackResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: `未知命令：${command}`,
    });
    return;
  }

  const channel = await prisma.messagingChannel.findFirst({
    where: {
      provider: MessagingProvider.SLACK,
      teamId,
      providerUserId: userId,
      isConnected: true,
      accessToken: { not: null },
    },
    select: { emailAccountId: true },
    orderBy: { createdAt: "desc" },
  });

  if (!channel) {
    await postToSlackResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: "你的 Slack 账号尚未连接到 Inbox Zero。请在 Inbox Zero 的设置页面进行连接。",
    });
    return;
  }

  const emailAccountUser = await getEmailAccountWithAi({
    emailAccountId: channel.emailAccountId,
  });

  if (!emailAccountUser) {
    await postToSlackResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: "找不到你已关联的邮箱账号。请在设置中重新连接。",
    });
    return;
  }

  try {
    const responseText = await runSlackSlashCommandAi({
      emailAccountId: channel.emailAccountId,
      emailAccountUser,
      messageText: expandedText,
      userId,
      teamId,
      logger,
    });

    await postToSlackResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: markdownToSlackMrkdwn(responseText),
    });
  } catch (error) {
    logger.error("Slack 斜杠命令 AI 处理失败", {
      error,
      command,
    });

    try {
      await postToSlackResponseUrl(responseUrl, {
        response_type: "ephemeral",
        text: "处理你的请求时出现问题。请重试。",
      });
    } catch (postError) {
      logger.error("向 Slack response_url 发送错误消息失败", {
        error: postError,
      });
    }
  }
}

async function runSlackSlashCommandAi({
  emailAccountId,
  emailAccountUser,
  messageText,
  userId,
  teamId,
  logger,
}: {
  emailAccountId: string;
  emailAccountUser: NonNullable<
    Awaited<ReturnType<typeof getEmailAccountWithAi>>
  >;
  messageText: string;
  userId: string;
  teamId: string;
  logger: Logger;
}): Promise<string> {
  const chatId = getSlackSlashCommandChatId({ userId, teamId, emailAccountId });

  const chat = await prisma.chat.upsert({
    where: { id: chatId },
    create: { id: chatId, emailAccountId },
    update: {},
    select: {
      id: true,
      emailAccountId: true,
      lastSeenRulesRevision: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: MAX_CHAT_CONTEXT_MESSAGES,
      },
      compactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (chat.emailAccountId !== emailAccountId) {
    logger.error("Slack 斜杠命令会话归属不匹配", {
      chatId: chat.id,
      expectedEmailAccountId: emailAccountId,
      actualEmailAccountId: chat.emailAccountId,
    });
    throw new Error("Slack 斜杠命令会话归属不匹配");
  }

  const existingMessages: UIMessage[] = [...chat.messages]
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role as UIMessage["role"],
      parts: m.parts as UIMessage["parts"],
    }));

  const userMessageId = `slack-cmd-${crypto.randomUUID()}`;
  const newUserMessage: UIMessage = {
    id: userMessageId,
    role: "user",
    parts: [{ type: "text", text: messageText }],
  };

  await prisma.chatMessage.create({
    data: {
      id: userMessageId,
      chat: { connect: { id: chat.id } },
      role: "user",
      parts: newUserMessage.parts as Prisma.InputJsonValue,
    },
  });

  const assistantMessageId = `${userMessageId}-assistant`;
  let seenRulesRevision: number | null = null;

  const [inboxStats, memories] = await Promise.all([
    getInboxStatsForChatContext({
      emailAccountId,
      provider: emailAccountUser.account.provider,
      logger,
    }),
    getRecentChatMemories({
      emailAccountId,
      logger,
      logContext: "Slack chat",
    }),
  ]);

  const result = await aiProcessAssistantChat({
    messages: await convertToModelMessages([
      ...existingMessages,
      newUserMessage,
    ]),
    emailAccountId,
    user: emailAccountUser,
    chatId: chat.id,
    chatLastSeenRulesRevision: chat.lastSeenRulesRevision,
    chatHasHistory: existingMessages.length > 0 || chat.compactions.length > 0,
    memories,
    inboxStats,
    responseSurface: "messaging",
    messagingPlatform: "slack",
    onRulesStateExposed: (rulesRevision) => {
      seenRulesRevision = mergeSeenRulesRevision(
        seenRulesRevision,
        rulesRevision,
      );
    },
    logger,
  });

  const stream = result.toUIMessageStream<UIMessage>({
    originalMessages: [...existingMessages, newUserMessage],
    generateMessageId: () => assistantMessageId,
  });

  let assistantMessage: UIMessage | null = null;
  for await (const message of readUIMessageStream<UIMessage>({ stream })) {
    if (message.role === "assistant") assistantMessage = message;
  }

  if (!assistantMessage) {
    throw new Error("斜杠命令响应中缺少助手消息");
  }

  const fullText = (assistantMessage.parts || [])
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n")
    .trim();

  await prisma.chatMessage.create({
    data: {
      id: assistantMessageId,
      chat: { connect: { id: chat.id } },
      role: "assistant",
      parts: (assistantMessage.parts || []) as Prisma.InputJsonValue,
    },
  });

  if (seenRulesRevision != null) {
    await saveLastSeenRulesRevision({
      chatId: chat.id,
      rulesRevision: seenRulesRevision,
      logger,
    });
  }

  return normalizeMessagingAssistantText({ text: fullText || "已完成。" });
}

function getSlackSlashCommandChatId({
  userId,
  teamId,
  emailAccountId,
}: {
  userId: string;
  teamId: string;
  emailAccountId: string;
}): string {
  const digest = createHmac("sha256", env.EMAIL_ENCRYPT_SALT)
    .update(`${userId}:${teamId}:${emailAccountId}`)
    .digest("hex")
    .slice(0, 32);

  return `slack-cmd-${digest}`;
}

async function postToSlackResponseUrl(
  responseUrl: string,
  body: { response_type: "in_channel" | "ephemeral"; text: string },
): Promise<void> {
  const url = new URL(responseUrl);
  if (url.hostname !== "hooks.slack.com") {
    throw new Error(`意外的 Slack response_url 域名：${url.hostname}`);
  }

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(disableSlackLinkUnfurls(body)),
  });

  if (!response.ok) {
    throw new Error(
      `向 Slack response_url 发送失败（状态码 ${response.status}）`,
    );
  }
}
