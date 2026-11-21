import { NextResponse } from "next/server";
import { withEmailAccount, withError } from "@/utils/middleware";
import { captureException, SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { createUnsubscribeToken } from "@/utils/unsubscribe";
import {
  getDigestScheduleProgression,
  isDigestScheduleDue,
} from "@/utils/digest/schedule";
import { sendDigest } from "@/utils/digest/send-digest";
import type { ParsedMessage } from "@/utils/types";
import {
  sendDigestEmailBody,
  storedDigestContentSchema,
  type Digest,
} from "./validation";
import { DigestStatus, SystemType } from "@/generated/prisma/enums";
import { extractNameFromEmail } from "../../../../utils/email";
import { getRuleName } from "@/utils/rule/consts";
import camelCase from "lodash/camelCase";
import { createEmailProvider } from "@/utils/email/provider";
import { sleep } from "@/utils/sleep";
import { withQstashOrInternal } from "@/utils/qstash";
import {
  claimPendingDigests,
  getDigestClaimWhere,
  renewDigestClaim,
} from "@/utils/digest/claim-pending-digests";

export const maxDuration = 60;

type SendEmailResult = {
  success: boolean;
  message: string;
};

export const GET = withEmailAccount("resend/digest", async (request) => {
  // send to self
  const emailAccountId = request.auth.emailAccountId;

  const logger = request.logger.with({
    force: true,
  });

  logger.info("Sending digest email to user GET");

  const result = await sendEmail({ emailAccountId, force: true, logger });

  return NextResponse.json(result);
});

export const POST = withError(
  "resend/digest",
  withQstashOrInternal(async (request) => {
    const json = await request.json();
    const { success, data, error } = sendDigestEmailBody.safeParse(json);

    if (!success) {
      request.logger.error("Invalid request body", { error });
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const { emailAccountId } = data;

    const logger = request.logger.with({ emailAccountId });

    logger.info("Sending digest email to user POST");

    try {
      const result = await sendEmail({ emailAccountId, logger });
      return NextResponse.json(result);
    } catch (error) {
      logger.error("Error sending digest email", { error });
      captureException(error, { emailAccountId });
      // Return 200 to prevent queue retries — failed digests are already marked
      // FAILED in the DB, and retrying won't help (expired tokens, timeouts, etc.)
      return NextResponse.json({
        success: false,
        error: "Error sending digest email",
      });
    }
  }),
);

async function getDigestSchedule({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  return prisma.schedule.findUnique({
    where: { emailAccountId },
    select: {
      id: true,
      intervalDays: true,
      occurrences: true,
      daysOfWeek: true,
      timeOfDay: true,
      lastOccurrenceAt: true,
      nextOccurrenceAt: true,
    },
  });
}

async function sendEmail({
  emailAccountId,
  force,
  logger,
}: {
  emailAccountId: string;
  force?: boolean;
  logger: Logger;
}): Promise<SendEmailResult> {
  logger.info("正在发送邮件摘要");
  const now = new Date();

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      email: true,
      account: { select: { provider: true, refresh_token: true } },
    },
  });

  if (!emailAccount) {
    throw new Error("找不到邮箱账号");
  }

  if (!emailAccount.account.refresh_token) {
    logger.warn("跳过邮件摘要：账号没有刷新令牌");
    return { success: false, message: "账号没有刷新令牌" };
  }

  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider: emailAccount.account.provider,
    logger,
  });

  const digestScheduleData = await getDigestSchedule({ emailAccountId });
  const digestScheduleProgression = digestScheduleData
    ? getDigestScheduleProgression(digestScheduleData, now)
    : null;

  if (!force) {
    if (!digestScheduleData) {
      logger.info("跳过邮件摘要发送，因为未配置计划");
      return { success: true, message: "未配置邮件摘要计划" };
    }

    if (!isDigestScheduleDue(digestScheduleData, now)) {
      logger.info("跳过邮件摘要发送，因为计划尚未到期", {
        nextOccurrenceAt: digestScheduleData.nextOccurrenceAt,
      });
      return { success: true, message: "邮件摘要计划尚未到期" };
    }
  }

  let digestClaim = await claimPendingDigests({ emailAccountId });

  try {
    const pendingDigests = await prisma.digest.findMany({
      where: {
        emailAccountId,
        id: {
          in: digestClaim.digestIds,
        },
      },
      select: {
        id: true,
        items: {
          select: {
            messageId: true,
            content: true,
            action: {
              select: {
                executedRule: {
                  select: {
                    rule: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // 如果没有找到邮件摘要就提前返回，除非 force 为 true
    if (pendingDigests.length === 0) {
      if (!force) {
        if (digestScheduleData && digestScheduleProgression) {
          await prisma.schedule.update({
            where: {
              id: digestScheduleData.id,
              emailAccountId,
            },
            data: digestScheduleProgression,
          });
        }

        return { success: true, message: "没有需要处理的邮件摘要" };
      }
      // 当 force 为 true 时，发送一封空摘要以表明系统正常运作
      logger.info("强制发送空邮件摘要", { emailAccountId });
    }

    // Store the digest IDs for the final update
    const processedDigestIds = pendingDigests.map((d) => d.id);

    const messageIds = pendingDigests.flatMap((digest) =>
      digest.items.map((item) => item.messageId),
    );

    logger.info("Fetching batch of messages");

    const messages: ParsedMessage[] = [];
    if (messageIds.length > 0) {
      const batchSize = 100;

      // Can't fetch more then 100 messages at a time, so fetch in batches
      // and wait 2 seconds to avoid rate limiting
      // TODO: Refactor into the provider if used elsewhere
      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize);
        const batchResults = await emailProvider.getMessagesBatch(batch);
        messages.push(...batchResults);

        if (i + batchSize < messageIds.length) {
          await sleep(2000);
        }
      }
    }

    logger.info("Fetched batch of messages");

    // Create a message lookup map for O(1) access
    const messageMap = new Map(messages.map((m) => [m.id, m]));

    // Map of rules camelCase -> ruleName
    const ruleNameMap = new Map<string, string>();

    // Transform and group in a single pass
    const executedRulesByRule = pendingDigests.reduce((acc, digest) => {
      digest.items.forEach((item) => {
        const message = messageMap.get(item.messageId);
        if (!message) {
          logger.warn("Message not found, skipping digest item", {
            messageId: item.messageId,
          });
          return;
        }

        const ruleName =
          item.action?.executedRule?.rule?.name ||
          getRuleName(SystemType.COLD_EMAIL);

        const ruleNameKey = camelCase(ruleName);
        if (!ruleNameMap.has(ruleNameKey)) {
          ruleNameMap.set(ruleNameKey, ruleName);
        }

        if (!acc[ruleNameKey]) {
          acc[ruleNameKey] = [];
        }

        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(item.content);
        } catch (error) {
          logger.warn("解析邮件摘要条目内容失败，跳过该条目", {
            messageId: item.messageId,
            digestId: digest.id,
            error: error instanceof Error ? error.message : "未知错误",
          });
          return; // 跳过该条目并继续处理下一个
        }

        const contentResult =
          storedDigestContentSchema.safeParse(parsedContent);

        if (contentResult.success) {
          acc[ruleNameKey].push({
            content: contentResult.data.content,
            from: extractNameFromEmail(message?.headers?.from || ""),
            subject: message?.headers?.subject || "",
          });
        } else {
          logger.warn("校验邮件摘要内容结构失败", {
            messageId: item.messageId,
            digestId: digest.id,
            error: contentResult.error,
          });
        }
      });
      return acc;
    }, {} as Digest);

    if (Object.keys(executedRulesByRule).length === 0) {
      logger.info("未找到已执行的规则，跳过邮件摘要");
      await prisma.digest.updateMany({
        where: getDigestClaimWhere(digestClaim),
        data: {
          status: DigestStatus.FAILED,
        },
      });
      return {
        success: true,
        message: "未找到已执行的规则，跳过邮件摘要",
      };
    }

    const token = await createUnsubscribeToken({ emailAccountId });

    const renewedClaim = await renewDigestClaim(digestClaim);
    if (!renewedClaim) {
      logger.warn("跳过邮件摘要发送，因为处理声明已丢失");
      return {
        success: true,
        message: "邮件摘要处理声明已丢失",
      };
    }
    digestClaim = renewedClaim;

    logger.info("正在发送邮件摘要");

    await sendDigest({
      emailAccountId,
      userEmail: emailAccount.email,
      unsubscribeToken: token,
      date: new Date(),
      ruleNames: Object.fromEntries(ruleNameMap),
      itemsByRule: executedRulesByRule,
      logger,
    });

    logger.info("邮件摘要已发送");

    const sentAt = new Date();

    // 仅在邮件发送成功后才更新数据库
    // 使用事务保证原子性——要么全部更新成功，要么都不应用
    await prisma.$transaction([
      ...(!force && digestScheduleData && digestScheduleProgression
        ? [
            prisma.schedule.update({
              where: {
                id: digestScheduleData.id,
                emailAccountId,
              },
              data: digestScheduleProgression,
            }),
          ]
        : []),
      // 仅将已处理的邮件摘要标记为已发送
      prisma.digest.updateMany({
        where: getDigestClaimWhere(digestClaim),
        data: {
          status: DigestStatus.SENT,
          sentAt,
        },
      }),
      // 遮盖已处理邮件摘要的所有 DigestItem
      prisma.digestItem.updateMany({
        data: { content: "[REDACTED]" },
        where: {
          digestId: {
            in: processedDigestIds,
          },
          digest: {
            status: DigestStatus.SENT,
            sentAt,
          },
        },
      }),
    ]);
  } catch (error) {
    await prisma.digest.updateMany({
      where: getDigestClaimWhere(digestClaim),
      data: {
        status: DigestStatus.FAILED,
      },
    });
    logger.error("发送邮件摘要时出错", { error });
    captureException(error);
    throw new SafeError("发送邮件摘要时出错", 500);
  }

  return { success: true, message: "邮件摘要已成功发送" };
}
