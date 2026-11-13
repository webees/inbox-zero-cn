"use server";

import chunk from "lodash/chunk";
import prisma from "@/utils/prisma";
import { GroupItemSource } from "@/generated/prisma/enums";
import { isColdEmail } from "@/utils/cold-email/is-cold-email";
import {
  coldEmailBlockerBody,
  markNotColdEmailBody,
} from "@/utils/actions/cold-email.validation";
import { actionClient } from "@/utils/actions/safe-action";
import { SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { getColdEmailRule } from "@/utils/cold-email/cold-email-rule";
import { internalDateToDate } from "@/utils/date";
import { saveLearnedPattern } from "@/utils/rule/learned-patterns";
import { emailToContentForAI } from "@/utils/ai/content-sanitizer";

export const markNotColdEmailAction = actionClient
  .metadata({ name: "markNotColdEmail" })
  .inputSchema(markNotColdEmailBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { sender },
    }) => {
      const [emailProvider, coldEmailRule] = await Promise.all([
        createEmailProvider({
          emailAccountId,
          provider,
          logger,
        }),
        getColdEmailRule(emailAccountId),
      ]);

      if (!coldEmailRule) {
        throw new SafeError("未找到冷邮件规则");
      }

      await Promise.all([
        // 标记为排除，这样 AI 不会再次匹配它
        saveLearnedPattern({
          emailAccountId,
          from: sender,
          ruleId: coldEmailRule.id,
          exclude: true,
          logger,
          source: GroupItemSource.USER,
        }),
        removeColdEmailLabelFromSender({
          emailProvider,
          sender,
          coldEmailRule,
          logger,
        }),
      ]);
    },
  );

// 每个会话都需要一次获取加一次标签更新，因此对发件人数量设置上限，
// 以保持操作响应迅速。
const MAX_THREADS_TO_UNLABEL = 500;
const THREAD_PAGE_SIZE = 100;
const UNLABEL_CONCURRENCY = 10;

async function removeColdEmailLabelFromSender({
  emailProvider,
  sender,
  coldEmailRule,
  logger,
}: {
  emailProvider: EmailProvider;
  sender: string;
  coldEmailRule: { actions: { labelId: string | null }[] };
  logger: Logger;
}) {
  const ruleLabelIds = [
    ...new Set(
      coldEmailRule.actions
        .map((action) => action.labelId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // 已从邮箱中删除的标签无法用于过滤，而某些服务商会回退为返回该发件人的
  // 所有会话，而不是返回空。
  const labels = await Promise.all(
    ruleLabelIds.map((labelId) => emailProvider.getLabelById(labelId)),
  );
  const labelIds = ruleLabelIds.filter((_, index) => labels[index]);
  const skippedLabelIds = ruleLabelIds.filter((_, index) => !labels[index]);
  if (skippedLabelIds.length > 0) {
    logger.warn("跳过未找到的冷邮件标签", {
      skippedLabelIds,
    });
  }

  if (labelIds.length === 0) return;

  // 在修改前先收集 id，这样移除标签不会导致后续页面偏移。
  // 按标签过滤会覆盖已归档的邮件，而不仅仅是收件箱。
  const threadIds = new Set<string>();
  for (const labelId of labelIds) {
    let pageToken: string | undefined;
    do {
      const page = await emailProvider.getThreadsWithQuery({
        query: { fromEmail: sender, labelId },
        maxResults: THREAD_PAGE_SIZE,
        pageToken,
        messageFormat: "metadata",
      });
      for (const thread of page.threads) {
        if (threadIds.size >= MAX_THREADS_TO_UNLABEL) break;
        threadIds.add(thread.id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken && threadIds.size < MAX_THREADS_TO_UNLABEL);
  }

  // 单个会话失败不应导致该发件人的其余邮件仍保留标签。
  const failures: unknown[] = [];
  for (const batch of chunk([...threadIds], UNLABEL_CONCURRENCY)) {
    const results = await Promise.allSettled(
      batch.map((threadId) =>
        emailProvider.removeThreadLabels(threadId, labelIds),
      ),
    );
    for (const result of results) {
      if (result.status === "rejected") failures.push(result.reason);
    }
  }

  if (failures.length > 0) {
    logger.warn("从部分会话移除冷邮件标签失败", {
      failedCount: failures.length,
      threadCount: threadIds.size,
      error: failures[0],
    });
  }
}

export const testColdEmailAction = actionClient
  .metadata({ name: "testColdEmail" })
  .inputSchema(coldEmailBlockerBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: {
        from,
        subject,
        textHtml,
        textPlain,
        snippet,
        threadId,
        messageId,
        date,
      },
    }) => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        include: {
          user: { select: { aiProvider: true, aiModel: true, aiApiKey: true } },
          account: { select: { provider: true } },
        },
      });

      if (!emailAccount) throw new SafeError("未找到邮箱账号");

      const coldEmailRule = await getColdEmailRule(emailAccountId);

      if (!coldEmailRule) throw new SafeError("未找到冷邮件规则");

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const content = emailToContentForAI({
        textHtml: textHtml || undefined,
        textPlain: textPlain || undefined,
        snippet: snippet || "",
      });

      const response = await isColdEmail({
        email: {
          from,
          to: "",
          subject,
          content,
          date: date ? internalDateToDate(String(date)) : undefined,
          threadId: threadId || undefined,
          id: messageId || "",
        },
        emailAccount,
        provider: emailProvider,
        modelType: "chat",
        coldEmailRule,
        logger,
      });

      return response;
    },
  );
