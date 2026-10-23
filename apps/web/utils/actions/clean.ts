"use server";

import { after } from "next/server";
import {
  cleanInboxSchema,
  undoCleanInboxSchema,
  changeKeepToDoneSchema,
} from "@/utils/actions/clean.validation";
import { bulkPublishToQstash } from "@/utils/upstash";
import {
  getLabel,
  getOrCreateInboxZeroLabel,
  GmailLabel,
  labelThread,
} from "@/utils/gmail/label";
import type { CleanThreadBody } from "@/app/api/clean/controller";
import { isDefined } from "@/utils/types";
import { inboxZeroLabels } from "@/utils/label";
import prisma from "@/utils/prisma";
import { CleanAction } from "@/generated/prisma/enums";
import { updateThread } from "@/utils/redis/clean";
import { getUnhandledCount } from "@/utils/assess";
import { getGmailClientForEmail } from "@/utils/email-account-client";
import { actionClient } from "@/utils/actions/safe-action";
import { SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { getUserPremium } from "@/utils/user/get";
import { isActivePremium } from "@/utils/premium";
import { ONE_DAY_MS } from "@/utils/date";

export const cleanInboxAction = actionClient
  .metadata({ name: "cleanInbox" })
  .inputSchema(cleanInboxSchema)
  .action(
    async ({
      ctx: { emailAccountId, provider, userId, logger },
      parsedInput: { action, instructions, daysOld, skips, maxEmails },
    }) => {
      if (!isGoogleProvider(provider)) {
        throw new SafeError("清理收件箱仅支持 Google 账号");
      }

      const premium = await getUserPremium({ userId });
      if (!premium) throw new SafeError("用户不是高级版");
      if (!isActivePremium(premium)) {
        throw new SafeError("深度清理需要有效的付费订阅。免费试用期间不可用。");
      }

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const [markedDoneLabel, processedLabel] = await Promise.all([
        emailProvider.getOrCreateInboxZeroLabel(
          action === CleanAction.ARCHIVE ? "archived" : "marked_read",
        ),
        emailProvider.getOrCreateInboxZeroLabel("processed"),
      ]);

      const markedDoneLabelId = markedDoneLabel?.id;
      if (!markedDoneLabelId) throw new SafeError("创建已归档标签失败");

      const processedLabelId = processedLabel?.id;
      if (!processedLabelId) throw new SafeError("创建已处理标签失败");

      // 创建清理任务
      const job = await prisma.cleanupJob.create({
        data: {
          emailAccountId,
          action,
          instructions,
          daysOld,
          skipReply: skips.reply,
          skipStarred: skips.starred,
          skipCalendar: skips.calendar,
          skipReceipt: skips.receipt,
          skipAttachment: skips.attachment,
          skipConversation: skips.conversation,
        },
      });

      const process = async () => {
        const { type } = await getUnhandledCount(emailProvider);

        let nextPageToken: string | undefined | null;

        let totalEmailsProcessed = 0;

        do {
          // 获取用户收件箱中的所有邮件
          const { threads, nextPageToken: pageToken } =
            await emailProvider.getThreadsWithQuery({
              query: {
                ...(daysOld > 0 && {
                  before: new Date(Date.now() - daysOld * ONE_DAY_MS),
                }),
                labelIds:
                  type === "inbox"
                    ? [GmailLabel.INBOX]
                    : [GmailLabel.INBOX, GmailLabel.UNREAD],
                excludeLabelNames: [inboxZeroLabels.processed.name],
              },
              maxResults: Math.min(maxEmails || 100, 100),
            });

          logger.info("已获取会话", {
            threadCount: threads.length,
            nextPageToken,
          });

          nextPageToken = pageToken;

          if (threads.length === 0) break;

          logger.info("正在推送到 Qstash", {
            threadCount: threads.length,
            nextPageToken,
          });

          const items = threads
            .map((thread) => {
              if (!thread.id) return;
              return {
                path: "/api/clean",
                body: {
                  emailAccountId,
                  threadId: thread.id,
                  markedDoneLabelId,
                  processedLabelId,
                  jobId: job.id,
                  action,
                  instructions,
                  skips,
                } satisfies CleanThreadBody,
                // 为每个用户分配独立的 AI 处理队列。如果并行用户过多，我们可能需要更多
                // API 密钥，或使用全局队列
                // 全局队列的问题是，如果出现积压，用户必须等待其他人先完成
                flowControl: {
                  key: `ai-clean-${emailAccountId}`,
                  parallelism: 3,
                },
              };
            })
            .filter(isDefined);

          await bulkPublishToQstash({ items });

          totalEmailsProcessed += items.length;
        } while (
          nextPageToken &&
          !isMaxEmailsReached(totalEmailsProcessed, maxEmails)
        );
      };

      after(() => process());

      return { jobId: job.id };
    },
  );

function isMaxEmailsReached(totalEmailsProcessed: number, maxEmails?: number) {
  if (!maxEmails) return false;
  return totalEmailsProcessed >= maxEmails;
}

export const undoCleanInboxAction = actionClient
  .metadata({ name: "undoCleanInbox" })
  .inputSchema(undoCleanInboxSchema)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { threadId, markedDone, action },
    }) => {
      const gmail = await getGmailClientForEmail({ emailAccountId, logger });

      // 如果未标记为已完成，则目前无需处理
      if (!markedDone) return { success: true };

      // 获取要移除的标签
      const markedDoneLabel = await getLabel({
        name:
          action === CleanAction.ARCHIVE
            ? inboxZeroLabels.archived.name
            : inboxZeroLabels.marked_read.name,
        gmail,
      });

      await labelThread({
        gmail,
        threadId,
        // 撤销核心操作
        addLabelIds:
          action === CleanAction.ARCHIVE
            ? [GmailLabel.INBOX]
            : [GmailLabel.UNREAD],
        // 撤销我们自己的标记
        removeLabelIds: markedDoneLabel?.id ? [markedDoneLabel.id] : undefined,
      });

      // 更新 Redis 以将该会话标记为未完成
      try {
        // 我们需要先获取会话才能拿到 jobId
        const thread = await prisma.cleanupThread.findFirst({
          where: { emailAccountId, threadId },
          orderBy: { createdAt: "desc" },
        });

        if (thread) {
          await updateThread({
            emailAccountId,
            jobId: thread.jobId,
            threadId,
            update: {
              undone: true,
              archive: false, // 由于已撤销，重置归档状态
            },
          });
        }
      } catch (error) {
        logger.error("为未完成的会话更新 Redis 失败", {
          error,
          threadId,
        });
        // 即使 Redis 更新失败也继续
      }

      return { success: true };
    },
  );

export const changeKeepToDoneAction = actionClient
  .metadata({ name: "changeKeepToDone" })
  .inputSchema(changeKeepToDoneSchema)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { threadId, action },
    }) => {
      const gmail = await getGmailClientForEmail({ emailAccountId, logger });

      // 获取要添加的标签（archived 或 marked_read）
      const actionLabel = await getOrCreateInboxZeroLabel({
        key: action === CleanAction.ARCHIVE ? "archived" : "marked_read",
        gmail,
      });

      await labelThread({
        gmail,
        threadId,
        // 应用操作（归档或标记为已读）
        removeLabelIds: [
          ...(action === CleanAction.ARCHIVE ? [GmailLabel.INBOX] : []),
          ...(action === CleanAction.MARK_READ ? [GmailLabel.UNREAD] : []),
        ],
        addLabelIds: [...(actionLabel?.id ? [actionLabel.id] : [])],
      });

      // 更新 Redis 以将该会话标记为新状态
      try {
        // 我们需要先获取会话才能拿到 jobId
        const thread = await prisma.cleanupThread.findFirst({
          where: { emailAccountId, threadId },
          orderBy: { createdAt: "desc" },
        });

        if (thread) {
          await updateThread({
            emailAccountId,
            jobId: thread.jobId,
            threadId,
            update: {
              archive: action === CleanAction.ARCHIVE,
              status: "completed",
              undone: true,
            },
          });
        }
      } catch (error) {
        logger.error("为已更改的会话更新 Redis 失败：", {
          error,
          threadId,
        });
        // 即使 Redis 更新失败也继续
      }

      return { success: true };
    },
  );
