"use server";

import { z } from "zod";
import prisma from "@/utils/prisma";
import { removeLabelFromMailSplits } from "@/utils/split-inbox/splits.server";
import { sendEmailBody } from "@/utils/types/mail";
import { actionClient } from "@/utils/actions/safe-action";
import { DraftNotFoundError, SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import { sendHtmlEmailWithOpenTracking } from "@/utils/email/sent-message-open/sent-message-open.server";
import {
  deleteMailboxItemBody,
  unarchiveThreadBody,
  untrashThreadBody,
  updateMailboxItemBody,
  updateDraftBody,
  saveComposeDraftBody,
  composeDraftParams,
} from "@/utils/actions/mail.validation";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { isGmailLabelColor } from "@/utils/gmail/label-colors";
import { getOutlookCategoryPreset } from "@/utils/outlook/category-colors";
import { markTrackedDraftDeleted } from "@/utils/ai/draft-cleanup";

import {
  saveComposeDraft,
  discardComposeDraft,
} from "@/utils/email/compose-draft";

const isStatusOk = (status: number) => status >= 200 && status < 300;

export const archiveThreadAction = actionClient
  .metadata({ name: "archiveThread" })
  .inputSchema(
    z.object({ threadId: z.string(), labelId: z.string().optional() }),
  )
  .action(
    async ({
      ctx: { emailAccountId, emailAccount, provider, logger },
      parsedInput: { threadId, labelId },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        await emailProvider.archiveThreadWithLabel(
          threadId,
          emailAccount.email,
          labelId,
        );
      } catch (error) {
        logger.error("归档会话失败", { error });
        throw new SafeError("归档邮件失败。请重试。");
      }
    },
  );

export const unarchiveThreadAction = actionClient
  .metadata({ name: "unarchiveThread" })
  .inputSchema(unarchiveThreadBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { threadId },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        await emailProvider.unarchiveThread(threadId);
      } catch (error) {
        logger.error("取消归档会话失败", { error });
        throw new SafeError("取消归档邮件失败。请重试。");
      }
    },
  );

export const trashThreadAction = actionClient
  .metadata({ name: "trashThread" })
  .inputSchema(z.object({ threadId: z.string() }))
  .action(
    async ({
      ctx: { emailAccountId, emailAccount, provider, logger },
      parsedInput: { threadId },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        await emailProvider.trashThread(threadId, emailAccount.email, "user");
      } catch (error) {
        logger.error("将会话移入回收站失败", { error });
        throw new SafeError("删除邮件失败。请重试。");
      }
    },
  );

export const untrashThreadAction = actionClient
  .metadata({ name: "untrashThread" })
  .inputSchema(untrashThreadBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { threadId },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        await emailProvider.untrashThread(threadId);
      } catch (error) {
        logger.error("从回收站恢复会话失败", { error });
        throw new SafeError("恢复邮件失败。请重试。");
      }
    },
  );

export const markReadThreadAction = actionClient
  .metadata({ name: "markReadThread" })
  .inputSchema(z.object({ threadId: z.string(), read: z.boolean() }))
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { threadId, read },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        await emailProvider.markReadThread(threadId, read);
      } catch (error) {
        logger.error("标记会话已读状态失败", { error });
        throw new SafeError(
          `将邮件标记为${read ? "已读" : "未读"}失败。请重试。`,
        );
      }
    },
  );

export const createAutoArchiveFilterAction = actionClient
  .metadata({ name: "createAutoArchiveFilter" })
  .inputSchema(
    z.object({
      from: z.string(),
      gmailLabelId: z.string().optional(),
      labelName: z.string().optional(),
    }),
  )
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { from, gmailLabelId, labelName },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      await emailProvider.createAutoArchiveFilter({
        from,
        gmailLabelId,
        labelName,
      });
    },
  );

export const createFilterAction = actionClient
  .metadata({ name: "createFilter" })
  .inputSchema(z.object({ from: z.string(), gmailLabelId: z.string() }))
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { from, gmailLabelId },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const res = await emailProvider.createFilter({
        from,
        addLabelIds: [gmailLabelId],
      });

      if (!isStatusOk(res.status)) {
        logger.error("创建过滤器失败", {
          from,
          gmailLabelId,
          status: res.status,
        });
        throw new SafeError("创建过滤器失败");
      }
    },
  );

export const deleteFilterAction = actionClient
  .metadata({ name: "deleteFilter" })
  .inputSchema(z.object({ id: z.string() }))
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { id },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const res = await emailProvider.deleteFilter(id);

      if (!isStatusOk(res.status)) {
        logger.error("删除过滤器失败", {
          filterId: id,
          status: res.status,
        });
        throw new SafeError("删除过滤器失败");
      }
    },
  );

export const createLabelAction = actionClient
  .metadata({ name: "createLabel" })
  .inputSchema(
    z.object({ name: z.string(), description: z.string().optional() }),
  )
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { name, description },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });
      const label = await emailProvider.createLabel(name, description);
      return label;
    },
  );

export const updateMailboxItemAction = actionClient
  .metadata({ name: "updateMailboxItem" })
  .inputSchema(updateMailboxItemBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: {
        kind,
        id,
        name,
        color,
        labelListVisibility,
        messageListVisibility,
      },
    }) => {
      assertMailboxItemMutationSupported({ kind, provider });
      if (kind === "label" && isMicrosoftProvider(provider) && name) {
        throw new SafeError("Outlook 分类名称无法更改。请改为编辑其颜色。");
      }
      if (
        (labelListVisibility || messageListVisibility) &&
        !isGoogleProvider(provider)
      ) {
        throw new SafeError("可见性设置仅适用于 Gmail。");
      }
      if (color && isGoogleProvider(provider) && !isGmailLabelColor(color)) {
        throw new SafeError("请选择受支持的 Gmail 标签颜色。");
      }
      if (
        color &&
        isMicrosoftProvider(provider) &&
        !getOutlookCategoryPreset(color.backgroundColor)
      ) {
        throw new SafeError("请选择受支持的 Outlook 分类颜色。");
      }
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        if (kind === "folder") await emailProvider.renameFolder(id, name!);
        else
          await emailProvider.updateLabel(id, {
            name,
            color,
            labelListVisibility,
            messageListVisibility,
          });
      } catch (error) {
        logger.error("更新邮箱项目失败", { error, kind });
        throw new SafeError(`Failed to update ${kind}. Please try again.`);
      }
    },
  );

export const deleteMailboxItemAction = actionClient
  .metadata({ name: "deleteMailboxItem" })
  .inputSchema(deleteMailboxItemBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { kind, id },
    }) => {
      assertMailboxItemMutationSupported({ kind, provider });
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      try {
        if (kind === "folder") {
          await emailProvider.deleteFolder(id);
        } else {
          await emailProvider.deleteLabel(id);
          await removeLabelFromMailSplits({ emailAccountId, labelId: id });
        }
      } catch (error) {
        logger.error("删除邮箱项目失败", { error, kind });
        throw new SafeError(`Failed to delete ${kind}. Please try again.`);
      }
    },
  );

export const updateLabelsAction = actionClient
  .metadata({ name: "updateLabels" })
  .inputSchema(
    z.object({
      labels: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          enabled: z.boolean(),
          gmailLabelId: z.string(),
        }),
      ),
    }),
  )
  .action(async ({ ctx: { emailAccountId }, parsedInput: { labels } }) => {
    const enabledLabels = labels.filter((label) => label.enabled);
    const disabledLabels = labels.filter((label) => !label.enabled);

    await prisma.$transaction([
      ...enabledLabels.map((label) => {
        const { name, description, enabled, gmailLabelId } = label;

        return prisma.label.upsert({
          where: { name_emailAccountId: { name, emailAccountId } },
          create: {
            gmailLabelId,
            name,
            description,
            enabled,
            emailAccountId,
          },
          update: {
            name,
            description,
            enabled,
          },
        });
      }),
      prisma.label.deleteMany({
        where: {
          emailAccountId,
          name: { in: disabledLabels.map((label) => label.name) },
        },
      }),
    ]);
  });

export const sendEmailAction = actionClient
  .metadata({ name: "sendEmail" })
  .inputSchema(sendEmailBody)
  .action(
    async ({ ctx: { emailAccountId, provider, logger }, parsedInput }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const result = await sendHtmlEmailWithOpenTracking({
        emailAccountId,
        email: parsedInput,
        emailProvider,
        logger,
      });

      return {
        success: true,
        messageId: result.messageId,
        threadId: result.threadId,
      };
    },
  );

export const updateDraftAction = actionClient
  .metadata({ name: "updateDraft" })
  .inputSchema(updateDraftBody)
  .action(
    async ({
      ctx: { emailAccountId, provider: providerName, logger },
      parsedInput,
    }) => {
      const provider = await createEmailProvider({
        emailAccountId,
        provider: providerName,
        logger,
      });
      const draftId =
        parsedInput.draftId ??
        (await provider.getDraftReferenceForMessage(parsedInput.draftMessageId))
          ?.id;
      // 在别处已发送、删除或替换的草稿永远无法保存，因此
      // 会通知编辑器停止同步，而不是重试。
      if (!draftId) return { status: "missing" as const };
      const {
        draftMessageId: _messageId,
        draftId: _draftId,
        ...content
      } = parsedInput;
      try {
        await provider.updateDraft(draftId, content);
      } catch (error) {
        if (error instanceof DraftNotFoundError)
          return { status: "missing" as const };
        throw error;
      }
      // Gmail 可能已将草稿移动到新的邮件；编辑器需要它，
      // 因此读取失败会导致保存失败，自动保存随后会重试。
      const message = await provider.getDraft(draftId);
      return {
        status: "saved" as const,
        draftId,
        messageId: message?.id ?? null,
      };
    },
  );

export const deleteDraftAction = actionClient
  .metadata({ name: "deleteDraft" })
  .inputSchema(
    z.object({ draftMessageId: z.string(), draftId: z.string().optional() }),
  )
  .action(
    async ({
      ctx: { emailAccountId, provider: providerName, logger },
      parsedInput: { draftMessageId, draftId },
    }) => {
      const provider = await createEmailProvider({
        emailAccountId,
        provider: providerName,
        logger,
      });
      const draft = draftId
        ? await provider
            .getDraft(draftId)
            .then((message) =>
              message ? provider.getDraftReferenceForMessage(message.id) : null,
            )
        : await provider.getDraftReferenceForMessage(draftMessageId);
      // 在别处已发送、删除或替换：没有可丢弃的内容。
      if (!draft) return;

      const wasDeleted = await provider.deleteDraft(draft.id, draft.version);
      if (!wasDeleted) return;

      try {
        await markTrackedDraftDeleted({
          draftId: draft.id,
          emailAccountId,
          logger,
        });
      } catch (error) {
        logger.error("删除草稿后更新追踪失败", {
          error,
        });
      }
    },
  );

function assertMailboxItemMutationSupported({
  kind,
  provider,
}: {
  kind: "label" | "folder";
  provider: string;
}) {
  if (kind === "folder" && !isMicrosoftProvider(provider)) {
    throw new SafeError("文件夹操作仅适用于 Outlook 账号。");
  }
}

export const saveComposeDraftAction = actionClient
  .metadata({ name: "saveComposeDraft" })
  .inputSchema(saveComposeDraftBody)
  .action(
    async ({
      ctx: { emailAccountId, provider: providerName, logger },
      parsedInput,
    }) => {
      const provider = await createEmailProvider({
        emailAccountId,
        provider: providerName,
        logger,
      });
      const saved = await saveComposeDraft({
        provider,
        ...parsedInput,
      });
      return saved;
    },
  );

export const discardComposeDraftAction = actionClient
  .metadata({ name: "discardComposeDraft" })
  .inputSchema(composeDraftParams)
  .action(
    async ({
      ctx: { emailAccountId, provider: providerName, logger },
      parsedInput,
    }) => {
      const provider = await createEmailProvider({
        emailAccountId,
        provider: providerName,
        logger,
      });
      await discardComposeDraft({ provider, ...parsedInput });
      return { success: true };
    },
  );
