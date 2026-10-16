"use server";

import { actionClient } from "@/utils/actions/safe-action";
import { translateThreadBody } from "@/utils/actions/translate.validation";
import { aiTranslateEmails } from "@/utils/ai/translate-email";
import { createEmailProvider } from "@/utils/email/provider";
import { SafeError } from "@/utils/error";
import { getLatestNonDraftMessage } from "@/utils/email/latest-message";
import { getMessageTimestamp } from "@/utils/email/message-timestamp";
import { emailToContent } from "@/utils/mail";
import { assertHasAiAccess } from "@/utils/premium/limits";
import { getEmailAccountWithAi } from "@/utils/user/get";

export const translateThreadAction = actionClient
  .metadata({ name: "translateThread" })
  .inputSchema(translateThreadBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { messageIds, targetLanguage },
    }) => {
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });
      if (!emailAccount) throw new SafeError("未找到邮箱账号");

      await assertHasAiAccess({
        userId: emailAccount.userId,
        hasUserApiKey: !!emailAccount.user.aiApiKey,
      });

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });
      const messages = await emailProvider.getMessagesBatch(messageIds);
      if (!messages.length) throw new SafeError("未找到邮件");

      const subject =
        getLatestNonDraftMessage({
          messages,
          getTimestamp: getMessageTimestamp,
        })?.headers.subject ?? "";
      const [subjectTranslation, ...messageTranslations] =
        await aiTranslateEmails({
          texts: [
            subject,
            // 引用历史会重复较早的消息，而这些消息有自己的翻译，
            // 因此只发送每条消息的新增文本。
            ...messages.map((message) =>
              emailToContent(message, { maxLength: 0, extractReply: true }),
            ),
          ],
          targetLanguage,
          emailAccount,
        });

      const translationsById = new Map(
        messages.map((message, index) => [
          message.id,
          messageTranslations[index],
        ]),
      );

      return {
        subject: subjectTranslation.text,
        // 服务商未返回的消息会以未翻译状态返回，
        // 因此客户端将它们记录为已处理，而不是永远重复请求。
        messages: messageIds.map((id) => ({
          id,
          ...(translationsById.get(id) ?? { text: "", sourceLanguage: null }),
        })),
      };
    },
  );
