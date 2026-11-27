import prisma from "@/utils/prisma";
import { GroupItemSource, GroupItemType } from "@/generated/prisma/enums";
import type { Logger } from "@/utils/logger";
import type { ParsedMessage } from "@/utils/types";
import { canonicalizeEmailAddress, extractEmailAddresses } from "@/utils/email";
import { getColdEmailRule } from "@/utils/cold-email/cold-email-rule";
import { saveLearnedPattern } from "@/utils/rule/learned-patterns";
import type { EmailProvider } from "@/utils/email/types";
import { isRuleGeneratedMessage } from "@/utils/ai/rule-generated-message";

/**
 * 主动给某人写信意味着对方不是冷邮件发送者，因此丢弃那条
 * 与之相反的已学习冷邮件模式。
 *
 * 已学习的模式会在 AI 运行之前短路规则匹配（参见
 * `isColdEmail`），因此被固定的发件人将再也无法获得回复草稿，
 * 无论你们通信多频繁。
 *
 * 这只会清除该模式。用户回复过的会话会保留阻止器
 * 已赋予它的标签或文件夹；"不是冷邮件"按钮
 * 仍是撤销该操作的方式。
 */
export async function excludeRepliedSendersFromColdEmail({
  emailAccountId,
  message,
  provider,
  logger,
}: {
  emailAccountId: string;
  message: Pick<ParsedMessage, "id" | "threadId" | "headers">;
  provider: Pick<EmailProvider, "getMessageByRfc822MessageId">;
  logger: Logger;
}) {
  if (
    await isRuleGeneratedMessage({
      emailAccountId,
      threadId: message.threadId,
      messageId: message.id,
    })
  ) {
    logger.info("为规则生成的消息保留冷邮件模式");
    return;
  }

  const recipients = [
    ...new Set(
      [message.headers.to, message.headers.cc ?? "", message.headers.bcc ?? ""]
        .flatMap((header) => extractEmailAddresses(header))
        .map((email) => email.toLowerCase()),
    ),
  ];
  const inReplyTo = message.headers["in-reply-to"]?.trim() ?? "";

  if (!recipients.length && !inReplyTo) return;

  const coldEmailRule = await getColdEmailRule(emailAccountId);
  const groupId = coldEmailRule?.groupId;
  if (!groupId) return;

  const sourceAddress = inReplyTo
    ? canonicalizeEmailAddress(
        (await provider.getMessageByRfc822MessageId(inReplyTo))?.headers.from ??
          "",
      )
    : "";
  const senderAddresses = [
    ...new Set([...recipients, sourceAddress].filter(Boolean)),
  ];

  if (!senderAddresses.length) return;

  // 以不区分大小写的方式匹配，因为发件人是按最先到达的
  // 那封邮件的 From 头大小写被固定的。
  const candidates = await prisma.groupItem.findMany({
    where: {
      groupId,
      type: GroupItemType.FROM,
      exclude: false,
      OR: senderAddresses.map((value) => ({
        value: { equals: value, mode: "insensitive" as const },
      })),
    },
    select: { value: true },
  });

  if (!candidates.length) return;

  for (const { value } of candidates) {
    // 通过 saveLearnedPattern 写入，使排除项只有一个归属，并按
    // 存储值建立键，从而认领已有行而不是新增一行。
    await saveLearnedPattern({
      emailAccountId,
      from: value,
      ruleId: coldEmailRule.id,
      exclude: true,
      source: GroupItemSource.USER,
      reason: "已自动排除：你回复过该发件人",
      logger,
    });
  }

  logger.info("已将回复过的发件人从冷邮件拦截中排除", {
    count: candidates.length,
  });
}
