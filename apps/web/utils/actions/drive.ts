"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  disconnectDriveBody,
  updateFilingPromptBody,
  updateFilingEnabledBody,
  updateFilingConfirmationEmailBody,
  addFilingFolderBody,
  removeFilingFolderBody,
  cleanupStaleFilingFoldersBody,
  submitPreviewFeedbackBody,
  moveFilingBody,
  createDriveFolderBody,
  fileAttachmentBody,
} from "@/utils/actions/drive.validation";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { createDriveProviderWithRefresh } from "@/utils/drive/provider";
import { createEmailProvider } from "@/utils/email/provider";
import {
  getFilableAttachments,
  processAttachment,
} from "@/utils/drive/filing-engine";
import type { DriveProviderType } from "@/utils/drive/types";

export const disconnectDriveAction = actionClient
  .metadata({ name: "disconnectDrive" })
  .inputSchema(disconnectDriveBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { connectionId } }) => {
      const connection = await prisma.driveConnection.findUnique({
        where: {
          id: connectionId,
          emailAccountId,
        },
      });

      if (!connection) {
        throw new SafeError("未找到 Drive 连接");
      }

      await prisma.driveConnection.delete({
        where: { id: connectionId, emailAccountId },
      });
    },
  );

export const updateFilingPromptAction = actionClient
  .metadata({ name: "updateFilingPrompt" })
  .inputSchema(updateFilingPromptBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { filingPrompt } }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          filingPrompt: filingPrompt || null,
        },
      });
    },
  );

export const updateFilingEnabledAction = actionClient
  .metadata({ name: "updateFilingEnabled" })
  .inputSchema(updateFilingEnabledBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { filingEnabled } }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { filingEnabled },
      });
    },
  );

export const updateFilingConfirmationEmailAction = actionClient
  .metadata({ name: "updateFilingConfirmationEmail" })
  .inputSchema(updateFilingConfirmationEmailBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { sendEmail } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { filingConfirmationSendEmail: sendEmail },
    });
  });

export const addFilingFolderAction = actionClient
  .metadata({ name: "addFilingFolder" })
  .inputSchema(addFilingFolderBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { folderId, folderName, folderPath, driveConnectionId },
    }) => {
      const connection = await prisma.driveConnection.findUnique({
        where: {
          id: driveConnectionId,
          emailAccountId,
        },
      });

      if (!connection) {
        throw new SafeError("未找到 Drive 连接");
      }

      const data = {
        folderName,
        folderPath,
        driveConnectionId,
      };

      const folder = await prisma.filingFolder.upsert({
        where: {
          emailAccountId_folderId: {
            emailAccountId,
            folderId,
          },
        },
        create: {
          ...data,
          folderId,
          emailAccountId,
        },
        update: data,
      });

      return folder;
    },
  );

export const removeFilingFolderAction = actionClient
  .metadata({ name: "removeFilingFolder" })
  .inputSchema(removeFilingFolderBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { folderId } }) => {
    await prisma.filingFolder.deleteMany({
      where: { emailAccountId, folderId },
    });
  });

export const cleanupStaleFilingFoldersAction = actionClient
  .metadata({ name: "cleanupStaleFilingFolders" })
  .inputSchema(cleanupStaleFilingFoldersBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { filingFolderIds },
    }) => {
      const result = await prisma.filingFolder.deleteMany({
        where: { emailAccountId, id: { in: filingFolderIds } },
      });

      logger.info("已清理过期的归档文件夹", {
        count: result.count,
      });

      return { count: result.count };
    },
  );

export const submitPreviewFeedbackAction = actionClient
  .metadata({ name: "submitPreviewFeedback" })
  .inputSchema(submitPreviewFeedbackBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { filingId, feedbackPositive },
    }) => {
      await prisma.documentFiling.update({
        where: { id: filingId, emailAccountId },
        data: {
          feedbackPositive,
          feedbackAt: new Date(),
        },
      });
    },
  );

export const moveFilingAction = actionClient
  .metadata({ name: "moveFiling" })
  .inputSchema(moveFilingBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { filingId, targetFolderId, targetFolderPath },
    }) => {
      const filing = await prisma.documentFiling.findUnique({
        where: { id: filingId, emailAccountId },
        select: { fileId: true, folderPath: true, driveConnection: true },
      });

      if (!filing) {
        throw new SafeError("未找到归档记录");
      }

      if (!filing.fileId) {
        throw new SafeError("归档记录没有关联文件");
      }

      const driveProvider = await createDriveProviderWithRefresh(
        filing.driveConnection,
        logger,
      );

      await driveProvider.moveFile(filing.fileId, targetFolderId);

      await prisma.documentFiling.update({
        where: { id: filingId },
        data: {
          folderId: targetFolderId,
          folderPath: targetFolderPath,
          originalPath: filing.folderPath,
          wasCorrected: true,
          feedbackPositive: false,
          feedbackAt: new Date(),
        },
      });
    },
  );

export const createDriveFolderAction = actionClient
  .metadata({ name: "createDriveFolder" })
  .inputSchema(createDriveFolderBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { folderName, driveConnectionId },
    }) => {
      const connection = await prisma.driveConnection.findUnique({
        where: {
          id: driveConnectionId,
          emailAccountId,
        },
      });

      if (!connection) {
        logger.error("未找到 Drive 连接", { driveConnectionId });
        throw new SafeError("未找到 Drive 连接");
      }

      const driveProvider = await createDriveProviderWithRefresh(
        connection,
        logger,
      );

      const folder = await driveProvider.createFolder(folderName);

      return folder;
    },
  );

export type FileAttachmentFiled = {
  filingId: string;
  filename: string;
  folderPath: string;
  fileId: string | null;
  filedAt: string;
  provider: DriveProviderType;
  skipped?: false;
};

export type FileAttachmentSkipped = {
  skipped: true;
  skipReason: string;
  filingId: string;
};

export type FileAttachmentResult = FileAttachmentFiled | FileAttachmentSkipped;

export const fileAttachmentAction = actionClient
  .metadata({ name: "fileAttachment" })
  .inputSchema(fileAttachmentBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { messageId, filename },
    }): Promise<FileAttachmentResult> => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          id: true,
          userId: true,
          email: true,
          about: true,
          multiRuleSelectionEnabled: true,
          sensitiveDataPolicy: true,
          timezone: true,
          calendarBookingLink: true,
          filingEnabled: true,
          filingPrompt: true,
          filingConfirmationSendEmail: true,
          user: {
            select: {
              aiProvider: true,
              aiModel: true,
              aiApiKey: true,
            },
          },
          account: {
            select: {
              provider: true,
            },
          },
        },
      });

      if (!emailAccount) {
        throw new SafeError("未找到邮箱账号");
      }

      if (!emailAccount.filingPrompt) {
        throw new SafeError("未配置归档提示词");
      }

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      logger.info("正在获取用于归档的邮件", { messageId });
      const message = await emailProvider.getMessage(messageId);

      if (!message) {
        throw new SafeError("未找到邮件");
      }

      const filableAttachments = getFilableAttachments(message);
      const attachment = filableAttachments.find(
        (a) => a.filename === filename,
      );

      if (!attachment) {
        throw new SafeError("未找到附件");
      }

      logger.info("正在处理附件", { filename: attachment.filename });
      const result = await processAttachment({
        emailAccount: {
          ...emailAccount,
          filingEnabled: true,
          filingPrompt: emailAccount.filingPrompt,
        },
        message,
        attachment,
        emailProvider,
        logger,
        sendNotification: false,
      });

      if (result.skipped) {
        if (!result.filingId) {
          throw new SafeError("跳过归档：缺少 ID");
        }
        return {
          skipped: true,
          skipReason: result.skipReason || "文档不符合归档偏好",
          filingId: result.filingId,
        };
      }

      if (!result.success || !result.filing) {
        throw new SafeError(result.error || "归档附件失败");
      }

      return {
        filingId: result.filing.id,
        filename: result.filing.filename,
        folderPath: result.filing.folderPath,
        fileId: result.filing.fileId,
        filedAt: new Date().toISOString(),
        provider: result.filing.provider as DriveProviderType,
      };
    },
  );
