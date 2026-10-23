import { z } from "zod";
import { createGenerateObject } from "@/utils/llms";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModelForUseCase, LlmUseCase } from "@/utils/llms/use-cases";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("translate-email");

const MAX_TEXT_LENGTH = 30_000;

export async function aiTranslateEmails({
  texts,
  targetLanguage,
  emailAccount,
}: {
  texts: string[];
  targetLanguage: string;
  emailAccount: EmailAccountWithAI;
}): Promise<EmailTranslation[]> {
  if (texts.length === 0) return [];

  if (texts.every((text) => !text.trim())) {
    return texts.map(() => ({ text: "", sourceLanguage: null }));
  }

  // 直接截断且不加省略号，避免截断标记被当作内容。
  const truncatedTexts = texts.map((text) => text.slice(0, MAX_TEXT_LENGTH));

  const system = `You are a precise email translator.
Translate each provided text into the target language identified by the BCP 47 language tag.
Return only translations — no commentary, preface, or explanation.
Preserve the original formatting as much as possible (markdown, line breaks, bullet points, links, and whitespace structure).
Keep proper nouns, email addresses, URLs, and code-like tokens unchanged when translating would break them.
If a text is empty or only whitespace, return an empty string for that entry.
For each entry, also report the BCP 47 tag of the language the original text is written in.
The translations array must have the same length and order as the input texts.`;

  const prompt = `Target language (BCP 47): ${targetLanguage}

Translate each text below into the target language.

${formatTextsForPrompt(truncatedTexts)}`;

  const modelOptions = getModelForUseCase(
    emailAccount.user,
    LlmUseCase.TranslateEmail,
  );

  const generateObject = createGenerateObject({
    emailAccount,
    label: "翻译邮件",
    modelOptions,
    promptHardening: { trust: "untrusted", level: "compact" },
  });

  const result = await generateObject({
    ...modelOptions,
    instructions: system,
    prompt,
    schema: translationSchema(texts.length),
  });

  const translations = result.object.translations;

  if (translations.length !== texts.length) {
    logger.error("翻译数量不匹配", {
      expected: texts.length,
      actual: translations.length,
      targetLanguage,
    });
    throw new Error(
      `期望收到 ${texts.length} 条翻译，但实际收到 ${translations.length} 条`,
    );
  }

  // 空白输入没有语言；模型提供的标签（例如 "und"）
  // 会让客户端用空翻译替换原文
  return translations.map((translation, index) =>
    texts[index].trim() ? translation : { text: "", sourceLanguage: null },
  );
}

type EmailTranslation = { text: string; sourceLanguage: string | null };

function translationSchema(textCount: number) {
  return z.object({
    translations: z
      .array(
        z.object({
          text: z.string().describe("The translated text"),
          sourceLanguage: z
            .string()
            .describe(
              "BCP 47 tag of the original text's language (e.g. de, fr)",
            ),
        }),
      )
      .length(textCount)
      .describe(
        "Translated texts in the same order and length as the input texts",
      ),
  });
}

function formatTextsForPrompt(texts: string[]) {
  return texts
    .map(
      (text, index) => `<text index="${index}">
${text}
</text>`,
    )
    .join("\n\n");
}
