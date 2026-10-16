"use server";

import prisma from "@/utils/prisma";
import {
  createKnowledgeBody,
  updateKnowledgeBody,
  deleteKnowledgeBody,
} from "@/utils/actions/knowledge.validation";
import { actionClient } from "@/utils/actions/safe-action";
import { SafeError } from "@/utils/error";
import {
  KNOWLEDGE_BASIC_MAX_ITEMS,
  KNOWLEDGE_BASIC_MAX_CHARS,
} from "@/utils/config";
import { PremiumTier } from "@/generated/prisma/enums";
import { checkHasAccess } from "@/utils/premium/server";

export const createKnowledgeAction = actionClient
  .metadata({ name: "createKnowledge" })
  .inputSchema(createKnowledgeBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { title, content },
    }) => {
      const knowledgeCount = await prisma.knowledge.count({
        where: { emailAccountId },
      });

      // 高级版检查
      if (
        knowledgeCount >= KNOWLEDGE_BASIC_MAX_ITEMS ||
        content.length > KNOWLEDGE_BASIC_MAX_CHARS
      ) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: PremiumTier.PLUS_MONTHLY,
        });

        if (!hasAccess) {
          throw new SafeError(
            `你最多可以向知识库保存 ${KNOWLEDGE_BASIC_MAX_CHARS} 个字符和 ${KNOWLEDGE_BASIC_MAX_ITEMS} 个条目。升级到更高档位即可保存无限内容。`,
          );
        }
      }

      await prisma.knowledge.create({
        data: {
          title,
          content,
          emailAccountId,
        },
      });
    },
  );

export const updateKnowledgeAction = actionClient
  .metadata({ name: "updateKnowledge" })
  .inputSchema(updateKnowledgeBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { id, title, content },
    }) => {
      if (content.length > KNOWLEDGE_BASIC_MAX_CHARS) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: PremiumTier.PLUS_MONTHLY,
        });

        if (!hasAccess) {
          throw new SafeError(
            `你最多可以向知识库保存 ${KNOWLEDGE_BASIC_MAX_CHARS} 个字符。升级到更高档位即可保存无限内容。`,
          );
        }
      }

      await prisma.knowledge.update({
        where: { id, emailAccountId },
        data: { title, content },
      });
    },
  );

export const deleteKnowledgeAction = actionClient
  .metadata({ name: "deleteKnowledge" })
  .inputSchema(deleteKnowledgeBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { id } }) => {
    await prisma.knowledge.delete({
      where: { id, emailAccountId },
    });
  });
