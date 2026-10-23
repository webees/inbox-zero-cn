"use server";

import prisma from "@/utils/prisma";
import { actionClient } from "@/utils/actions/safe-action";
import { SafeError } from "@/utils/error";
import {
  buildMailSplitFromPromptBody,
  createMailSplitBody,
  deleteMailSplitBody,
  reorderMailSplitsBody,
  updateMailPreferencesBody,
  updateMailSplitBody,
} from "@/utils/actions/mail-split.validation";
import { aiPromptToSplitFilters } from "@/utils/ai/split/prompt-to-split";
import { getEmailAccountWithAi } from "@/utils/user/get";
import {
  createMailSplitOrThrow,
  updateMailSplit,
  deleteMailSplit,
  reorderMailSplits,
} from "@/utils/split-inbox/splits.server";

export const createMailSplitAction = actionClient
  .metadata({ name: "createMailSplit" })
  .inputSchema(createMailSplitBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { name, filters, matchAll },
    }) => {
      const split = await createMailSplitOrThrow({
        emailAccountId,
        name,
        matchAll,
        filters,
      });
      return { split };
    },
  );

export const updateMailSplitAction = actionClient
  .metadata({ name: "updateMailSplit" })
  .inputSchema(updateMailSplitBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { id, name, filters, matchAll },
    }) => {
      await updateMailSplit({ emailAccountId, id, name, filters, matchAll });
    },
  );

/**
 * 把一段描述转换为条件，供用户在构建器中复核——
 * 它绝不会直接创建分类，因此即便猜错也只损失一次点击，而不是一个标签页。
 */
export const buildMailSplitFromPromptAction = actionClient
  .metadata({ name: "buildMailSplitFromPrompt" })
  .inputSchema(buildMailSplitFromPromptBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { prompt, options, senders },
    }) => {
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });
      if (!emailAccount) throw new SafeError("未找到邮箱账号");

      const result = await aiPromptToSplitFilters({
        emailAccount,
        prompt,
        options,
        senders,
      });

      if (!result.filters.length) {
        throw new SafeError(
          "我没能从中找到筛选条件——请指明发件人、标签或分类。",
        );
      }

      return {
        filters: result.filters,
        name: result.name?.trim().slice(0, 60) || null,
        matchAll: result.matchAll,
      };
    },
  );

export const deleteMailSplitAction = actionClient
  .metadata({ name: "deleteMailSplit" })
  .inputSchema(deleteMailSplitBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { id } }) => {
    await deleteMailSplit({ emailAccountId, id });
  });

export const reorderMailSplitsAction = actionClient
  .metadata({ name: "reorderMailSplits" })
  .inputSchema(reorderMailSplitsBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { ids } }) => {
    await reorderMailSplits({ emailAccountId, ids });
  });

export const updateMailPreferencesAction = actionClient
  .metadata({ name: "updateMailPreferences" })
  .inputSchema(updateMailPreferencesBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { layout, expandedPreview },
    }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          ...(layout === undefined ? {} : { mailLayout: layout }),
          ...(expandedPreview === undefined
            ? {}
            : { mailExpandedPreview: expandedPreview }),
        },
      });
    },
  );
