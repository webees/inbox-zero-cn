import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import {
  getFilebotFrom,
  getFilebotReplyTo,
} from "@/utils/filebot/is-filebot-email";
import { escapeHtml } from "@/utils/string";

// ============================================================================
// Types
// ============================================================================

interface SourceMessageInfo {
  headerMessageId: string;
  // 平台特定的消息 ID（例如 Microsoft Graph ID）——必需，以便
  // Outlook 的 createReply 能将通知归入来源
  // 会话，而不是开启新会话。
  messageId?: string;
  references?: string;
  threadId: string;
}

interface FilingNotificationParams {
  emailProvider: EmailProvider;
  filingId: string;
  logger: Logger;
  sourceMessage: SourceMessageInfo;
  userEmail: string;
}

interface FilingNotificationsParams
  extends Omit<FilingNotificationParams, "filingId"> {
  filingIds: string[];
}

type FilingNotification = {
  driveConnection: { provider: string };
  filename: string;
  folderPath: string;
  reasoning: string | null;
  wasAsked: boolean;
};

// ============================================================================
// Main Functions
// ============================================================================

/**
 * 为成功的归档发送通知邮件。
 * "✓ 已归档 Receipt.pdf 到 Receipts/2024/December"
 * 作为对来源邮件会话的回复发送。
 */
export async function sendFiledNotification({
  emailProvider,
  userEmail,
  filingId,
  sourceMessage,
  logger,
}: FilingNotificationParams): Promise<void> {
  const log = logger.with({ action: "sendFiledNotification", filingId });

  const filing = await prisma.documentFiling.findUnique({
    where: { id: filingId },
    include: {
      driveConnection: { select: { provider: true } },
    },
  });

  if (!filing) {
    log.error("未找到归档记录");
    return;
  }

  const replyToAddress = getFilebotReplyTo({ userEmail });
  const fromAddress = getFilebotFrom({ userEmail });

  const subject = `✓ 已归档 ${filing.filename}`;
  const messageHtml = buildFiledEmailHtml({
    filename: filing.filename,
    folderPath: filing.folderPath,
    driveProvider: filing.driveConnection.provider,
  });

  await sendNotificationEmail({
    emailProvider,
    filingIds: [filingId],
    fromAddress,
    logger: log,
    messageHtml,
    replyToAddress,
    sourceMessage,
    subject,
    userEmail,
  });
}

/**
 * 发送通知邮件询问文档应归档到哪里。
 * "📄 应该把 Contract.pdf 归档到哪里？"
 * 作为对来源邮件会话的回复发送。
 */
export async function sendAskNotification({
  emailProvider,
  userEmail,
  filingId,
  sourceMessage,
  logger,
}: FilingNotificationParams): Promise<void> {
  const log = logger.with({ action: "sendAskNotification", filingId });

  const filing = await prisma.documentFiling.findUnique({
    where: { id: filingId },
  });

  if (!filing) {
    log.error("未找到归档记录");
    return;
  }

  const replyToAddress = getFilebotReplyTo({ userEmail });
  const fromAddress = getFilebotFrom({ userEmail });

  const subject = `📄 应该把 ${filing.filename} 归档到哪里？`;
  const messageHtml = buildAskEmailHtml({
    filename: filing.filename,
    reasoning: filing.reasoning,
  });

  await sendNotificationEmail({
    emailProvider,
    filingIds: [filingId],
    fromAddress,
    logger: log,
    messageHtml,
    replyToAddress,
    sourceMessage,
    subject,
    userEmail,
  });
}

/**
 * 为来源邮件中所有新处理的附件发送一条通知。
 */
export async function sendFilingNotifications({
  emailProvider,
  userEmail,
  filingIds,
  sourceMessage,
  logger,
}: FilingNotificationsParams): Promise<void> {
  const log = logger.with({
    action: "sendFilingNotifications",
    filingCount: filingIds.length,
  });

  const filings = await prisma.documentFiling.findMany({
    where: {
      id: { in: filingIds },
      notificationBatchId: null,
      notificationSentAt: null,
    },
    include: {
      driveConnection: { select: { provider: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (filings.length === 0) {
    log.info("没有需要发送的归档通知");
    return;
  }

  const replyToAddress = getFilebotReplyTo({ userEmail });
  const fromAddress = getFilebotFrom({ userEmail });
  const askedFilings = filings.filter((filing) => filing.wasAsked);
  const subject = getFilingNotificationSubject({
    filingCount: filings.length,
    askedCount: askedFilings.length,
    firstFilename: filings[0].filename,
  });
  const messageHtml = getFilingNotificationHtml(filings);

  await sendNotificationEmail({
    emailProvider,
    filingIds: filings.map((filing) => filing.id),
    fromAddress,
    logger: log,
    messageHtml,
    replyToAddress,
    sourceMessage,
    subject,
    userEmail,
  });
}

/**
 * 在更正后发送确认邮件。
 * "完成！已移动到 Business/Expenses"
 * 作为对来源邮件会话的回复发送。
 */
export async function sendCorrectionConfirmation({
  emailProvider,
  userEmail,
  filingId,
  sourceMessage,
  newFolderPath,
  logger,
}: FilingNotificationParams & { newFolderPath: string }): Promise<void> {
  const log = logger.with({ action: "sendCorrectionConfirmation", filingId });

  const filing = await prisma.documentFiling.findUnique({
    where: { id: filingId },
  });

  if (!filing) {
    log.error("未找到归档记录");
    return;
  }

  const replyToAddress = getFilebotReplyTo({ userEmail });
  const fromAddress = getFilebotFrom({ userEmail });

  const subject = `Re: ✓ 已归档 ${filing.filename}`;
  const messageHtml = buildCorrectionConfirmationHtml({
    filename: filing.filename,
    newFolderPath,
  });

  try {
    await emailProvider.sendEmailWithHtml(
      {
        replyToEmail: sourceMessage,
        to: userEmail,
        from: fromAddress,
        replyTo: replyToAddress,
        subject,
        messageHtml,
      },
      { preserveThreadSubject: true },
    );

    log.info("已发送更正确认");
  } catch (error) {
    log.error("发送更正确认失败", { error });
    throw error;
  }
}

// ============================================================================
// Email Templates
// ============================================================================

function buildFiledEmailHtml({
  filename,
  folderPath,
  driveProvider,
}: {
  filename: string;
  folderPath: string;
  driveProvider: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px;">
      <p>已归档你的文档：</p>
      ${buildFiledItemHtml({ filename, folderPath, driveName: getDriveName(driveProvider) })}
      
      <p style="color: #666; font-size: 14px;">
        文件夹不对？直接回复应该放到的位置即可。
      </p>
    </div>
  `;
}

function buildAskEmailHtml({
  filename,
  reasoning,
}: {
  filename: string;
  reasoning: string | null;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px;">
      <p>有一份我不太确定的文档：</p>
      ${buildAskItemHtml({ filename, reasoning })}
      
      <p><strong>应该把它放到哪里？</strong></p>
      
      <p style="color: #666; font-size: 14px;">
        回复一个文件夹路径，例如：<br>
        • "Receipts/2024"<br>
        • "Projects/Acme Corp/Contracts"<br>
        • "Skip" 以忽略这一个
      </p>
    </div>
  `;
}

function buildFilingSummaryEmailHtml(filings: FilingNotification[]): string {
  const filedItems = filings.filter((filing) => !filing.wasAsked);
  const askedItems = filings.filter((filing) => filing.wasAsked);

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px;">
      ${
        filedItems.length > 0
          ? `<p>已归档你的文档：</p>
             ${filedItems
               .map((filing) =>
                 buildFiledItemHtml({
                   filename: filing.filename,
                   folderPath: filing.folderPath,
                   driveName: getDriveName(filing.driveConnection.provider),
                 }),
               )
               .join("")}`
          : ""
      }
      ${
        askedItems.length > 0
          ? `<p>有一些我不太确定的文档：</p>
             ${askedItems.map(buildAskItemHtml).join("")}`
          : ""
      }

      <p style="color: #666; font-size: 14px;">
        ${
          askedItems.length > 0
            ? "对于任何需要你确认的内容，请回复文档名称和文件夹路径。"
            : "文件夹不对？请回复文档名称以及它应该放到的位置。"
        }
      </p>
    </div>
  `;
}

function getFilingNotificationHtml(filings: FilingNotification[]): string {
  if (filings.length > 1) return buildFilingSummaryEmailHtml(filings);

  const filing = filings[0];
  if (filing.wasAsked) {
    return buildAskEmailHtml({
      filename: filing.filename,
      reasoning: filing.reasoning,
    });
  }

  return buildFiledEmailHtml({
    filename: filing.filename,
    folderPath: filing.folderPath,
    driveProvider: filing.driveConnection.provider,
  });
}

function buildFiledItemHtml({
  filename,
  folderPath,
  driveName,
}: {
  filename: string;
  folderPath: string;
  driveName: string;
}): string {
  return `
    <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 12px 0;">
      <p style="margin: 0 0 8px 0;"><strong>📄 ${escapeHtml(filename)}</strong></p>
      <p style="margin: 0; color: #666;">📁 → ${escapeHtml(folderPath)}</p>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #888;">${driveName}</p>
    </div>
  `;
}

function buildAskItemHtml({
  filename,
  reasoning,
}: {
  filename: string;
  reasoning: string | null;
}): string {
  return `
    <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 12px 0;">
      <p style="margin: 0;"><strong>📄 ${escapeHtml(filename)}</strong></p>
      ${reasoning ? `<p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">${escapeHtml(reasoning)}</p>` : ""}
    </div>
  `;
}

function getFilingNotificationSubject({
  filingCount,
  askedCount,
  firstFilename,
}: {
  filingCount: number;
  askedCount: number;
  firstFilename: string;
}): string {
  if (filingCount === 1) {
    return askedCount === 1
      ? `📄 应该把 ${firstFilename} 归档到哪里？`
      : `✓ 已归档 ${firstFilename}`;
  }

  if (askedCount === 0) return `✓ 已归档 ${filingCount} 个文档`;
  if (askedCount === filingCount) {
    return `📄 应该把 ${filingCount} 个文档归档到哪里？`;
  }
  return `📄 归档更新：${filingCount} 个文档`;
}

function getDriveName(provider: string): string {
  return provider === "google" ? "Google Drive" : "OneDrive";
}

async function sendNotificationEmail({
  emailProvider,
  filingIds,
  fromAddress,
  logger,
  messageHtml,
  replyToAddress,
  sourceMessage,
  subject,
  userEmail,
}: {
  emailProvider: EmailProvider;
  filingIds: string[];
  fromAddress: string;
  logger: Logger;
  messageHtml: string;
  replyToAddress: string;
  sourceMessage: SourceMessageInfo;
  subject: string;
  userEmail: string;
}): Promise<void> {
  const notificationBatchId = randomUUID();
  const claim = await prisma.documentFiling.updateMany({
    where: {
      id: { in: filingIds },
      notificationBatchId: null,
      notificationSentAt: null,
    },
    data: { notificationBatchId },
  });

  if (claim.count !== filingIds.length) {
    await releaseNotificationBatch({
      filingIds,
      logger,
      notificationBatchId,
    });
    logger.info("归档通知已被认领", {
      filingCount: filingIds.length,
    });
    return;
  }

  let result: Awaited<ReturnType<EmailProvider["sendEmailWithHtml"]>>;

  try {
    result = await emailProvider.sendEmailWithHtml(
      {
        replyToEmail: sourceMessage,
        to: userEmail,
        from: fromAddress,
        replyTo: replyToAddress,
        subject,
        messageHtml,
      },
      { preserveThreadSubject: true },
    );
  } catch (error) {
    await releaseNotificationBatch({
      filingIds,
      logger,
      notificationBatchId,
    });

    logger.error("发送归档通知失败", { error });
    throw error;
  }

  const batchCompleted = await completeNotificationBatch({
    filingIds,
    logger,
    notificationBatchId,
  });
  if (!batchCompleted) return;

  if (result.messageId) {
    try {
      await prisma.documentFiling.update({
        where: { id: filingIds[0] },
        data: { notificationMessageId: result.messageId },
      });
    } catch (error) {
      logger.error("保存归档通知消息 ID 失败", { error });
    }
  }

  logger.info("已发送归档通知", {
    messageId: result.messageId,
    filingCount: filingIds.length,
  });
}

async function completeNotificationBatch({
  filingIds,
  logger,
  notificationBatchId,
}: {
  filingIds: string[];
  logger: Logger;
  notificationBatchId: string;
}): Promise<boolean> {
  const notificationSentAt = new Date();
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.documentFiling.updateMany({
        where: {
          id: { in: filingIds },
          notificationBatchId,
        },
        data: {
          notificationSentAt,
        },
      });

      if (result.count === filingIds.length) return true;

      logger.error("未能完成全部归档通知认领", {
        completedCount: result.count,
        filingCount: filingIds.length,
      });
      return false;
    } catch (error) {
      lastError = error;
    }
  }

  logger.error("完成归档通知认领失败", {
    error: lastError,
  });
  return false;
}

async function releaseNotificationBatch({
  filingIds,
  logger,
  notificationBatchId,
}: {
  filingIds: string[];
  logger: Logger;
  notificationBatchId: string;
}): Promise<void> {
  try {
    await prisma.documentFiling.updateMany({
      where: {
        id: { in: filingIds },
        notificationBatchId,
      },
      data: { notificationBatchId: null },
    });
  } catch (error) {
    logger.error("释放归档通知认领失败", { error });
  }
}

function buildCorrectionConfirmationHtml({
  filename,
  newFolderPath,
}: {
  filename: string;
  newFolderPath: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px;">
      <p>✓ 完成！已将 <strong>${escapeHtml(filename)}</strong> 移动到：</p>
      
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0;">
          📁 ${escapeHtml(newFolderPath)}
        </p>
      </div>
    </div>
  `;
}
