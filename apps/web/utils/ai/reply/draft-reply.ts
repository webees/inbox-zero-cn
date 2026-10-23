import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { createScopedLogger } from "@/utils/logger";
import { createGenerateObject } from "@/utils/llms/index";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { EmailForLLM } from "@/utils/types";
import {
  getEmailListPrompt,
  getTodayForLLM,
  getUserAboutPrompt,
  getWritingStylePrompt,
} from "@/utils/ai/helpers";
import { getModelForUseCase, LlmUseCase } from "@/utils/llms/use-cases";
import { appendOllamaOnlySystemGuidance } from "@/utils/llms/ollama-guidance";
import type { ReplyContextCollectorResult } from "@/utils/ai/reply/reply-context-collector";
import type { CalendarAvailabilityContext } from "@/utils/ai/calendar/availability";
import { DraftReplyConfidence } from "@/generated/prisma/enums";
import { env } from "@/env";
import { normalizeDraftReplyConfidence } from "@/utils/ai/reply/draft-confidence";
import {
  createDraftAttributionTracker,
  type DraftAttribution,
} from "@/utils/ai/reply/draft-attribution";

const logger = createScopedLogger("DraftReply");
const DRAFT_OUTPUT_INSTRUCTION =
  "只返回纯文本，不要使用 HTML 标签。如果需要可点击的链接，请使用格式为 [标签](https://example.com/path) 或 [标签](mailto:name@example.com) 的 Markdown 链接。";

const systemPrompt = `你以用户的身份、用用户的语气撰写邮件回复。每封草稿在发送前都会由用户审阅和编辑。

利用之前的邮件和提供的知识库中的上下文，使回复切题且准确。
当前会话中的事实优先于参考性上下文。不要询问那里已经包含的细节。
重要：不要简单重复或复述上一封邮件所说的话。把对方刚说过的话再说一遍对对话没有任何帮助。
不要提及你是 AI。
不要在回复中包含主题。只回复邮件正文。
${DRAFT_OUTPUT_INSTRUCTION}
重要：使用 Unix 换行符格式化段落：段落之间使用 "\n\n"，单个换行使用 "\n"。
使用会话中最新一封邮件的语言撰写回复。

A gap in your context is not a gap in the user's knowledge. When the reply depends on something the user could answer without asking anyone, such as their decision, status, plans, product, or whether they want to meet, state their most likely answer plainly and put your uncertainty in the confidence field. Don't hedge their own facts, say they can't confirm or don't want to guess, mention your context, leave placeholders, or promise to check later instead of answering.
When the thread or context shows the answer is genuinely unsettled for the user, such as it depends on someone else or they said they would check, say so instead of deciding it for them. A reported problem can get a promise to investigate.
Don't invent facts about the other party; ground them in the thread or provided context. If the sender wrongly assumes something about the user, such as who they are or what they sell, correct it plainly, as fact rather than a guess or possibility.
Don't pass the request to anyone else, including people in To or Cc, unless the context says they handle it. Don't claim the user copied someone in or did anything the thread or context doesn't show.
Address each distinct question or requested action; do not trade away completeness for brevity.
When the sender asks several separate questions, answer each one on its own, in their order, so they can match every answer to its question. If they numbered or bulleted them, reply with the same numbering or bullets. Keep each answer brief.
Never use placeholders for the user's name. You do not need to sign off with the user's name. Do not add a signature.
Inline image markers such as [image] or [image: ...] mean the sender included a real image in the email, but only the marker and label are available in this prompt. Do not say the image is missing, unreadable, unavailable, or needs to be resent; respond from the available text and image label.
Treat email dates as message metadata, not calendar context.
Do not use em dashes unless the provided writing style explicitly calls for them.
Don't suggest meeting times or mention availability unless specific calendar information is provided.
When the sender provides a scheduling link or scheduling process, use that path instead of adding the user's booking link.

撰写一封跟进之前对话的邮件。
你的回复应旨在继续对话，或基于上下文或知识库提供新信息。如果没有实质内容可补充，请保持回复简短。
默认情况下，回复应简洁、直接、友好、平实，并且不过长。优先使用简短的陈述句，而不是精雕细琢或过于复杂的措辞。
用户的写作风格可以覆盖这些默认要求。

Example of answering as the user when the thread does not state the answer:
Sender: "Can you confirm the workshop fee is $500 and we're booked for Friday?"
Good: "Yes, $500 and Friday are both right. See you then."
Bad: "I'll confirm the fee and date and get back to you."
Bad: "I'm not certain about the fee, so I don't want to give you the wrong number."
`;

const defaultWritingStyle = `保持简洁、直接、友好。
保持回复简短。除非需要简要回答多个问题，否则最多两句话。
不要咄咄逼人。
使用平实、专业的语气。
优先使用简短的陈述句，而不是精雕细琢或过于复杂的措辞。`;

/**
 * 每当用户自己的风格替换上面的默认风格时都会附加此内容，因为否则提示词中
 * 唯一的长度指引就会消失——几乎所有使用产品足够久、已经有了写作风格的用户
 * 都会如此。
 *
 * 这里刻意强调比例而非句子数量。要求详尽回复的用户风格并不与此矛盾：
 * 对复杂问题的长回答仍然是恰当的。它只排除填充内容、复述和未经请求的补充，
 * 这些都不是任何风格所要求的。
 */
const LENGTH_DISCIPLINE =
  "根据实际被询问的内容控制回复长度。不要复述收到的邮件、添加填充内容，或加入没有人要求的提议、后续步骤或空闲时间。";

type DraftEmailAccount = EmailAccountWithAI & {
  bookingLinks?: { slug: string }[];
};

export type DraftReplyInput = {
  messages: (EmailForLLM & { to: string })[];
  emailAccount: DraftEmailAccount;
  knowledgeBaseContent: string | null;
  replyMemoryContent?: string | null;
  emailHistorySummary: string | null;
  emailHistoryContext: ReplyContextCollectorResult | null;
  senderReplyExamples?: string | null;
  calendarAvailability: CalendarAvailabilityContext | null;
  writingStyle: string | null;
  learnedWritingStyle?: string | null;
  mcpContext: string | null;
  meetingContext: string | null;
  recordedMeetingContext?: string | null;
  attachmentContext?: string | null;
  hasConfiguredSignature?: boolean;
  currentDate?: Date;
};

type DraftReplyModelContextInput = {
  emailAccount: Pick<
    DraftEmailAccount,
    "about" | "timezone" | "calendarBookingLink" | "bookingLinks"
  >;
  knowledgeBaseContent: string | null;
  replyMemoryContent: string | null;
  emailHistorySummary: string | null;
  emailHistoryContext: ReplyContextCollectorResult | null;
  senderReplyExamples: string | null;
  calendarAvailability: CalendarAvailabilityContext | null;
  writingStyle: string | null;
  learnedWritingStyle: string | null;
  mcpContext: string | null;
  meetingContext: string | null;
  recordedMeetingContext: string | null;
  attachmentContext: string | null;
  hasConfiguredSignature: boolean;
};

export type DraftReplyModelEvidence = {
  thread: string;
  context: string;
  temporalAndIdentityContext: string;
};

const getUserPrompt = (input: DraftReplyInput) => {
  const { thread, context, temporalAndIdentityContext } =
    buildDraftReplyModelEvidence(input);

  return `${context}

以下是邮件会话的上下文（从最早到最新）：
${thread}

请撰写一封回复此邮件的邮件。
以用户身份直接回复发件人。如果答案取决于只有用户知道的事情，请写出他们最可能的答案；如果答案有误，他们会自行修改。
${temporalAndIdentityContext}`;
};

export function buildDraftReplyModelEvidence({
  messages,
  emailAccount,
  currentDate = new Date(),
  replyMemoryContent = null,
  senderReplyExamples = null,
  learnedWritingStyle = null,
  attachmentContext = null,
  hasConfiguredSignature = false,
  recordedMeetingContext = null,
  ...modelContextInput
}: DraftReplyInput): DraftReplyModelEvidence {
  const modelContext = buildDraftReplyModelContext({
    ...modelContextInput,
    emailAccount,
    replyMemoryContent,
    senderReplyExamples,
    learnedWritingStyle,
    attachmentContext,
    hasConfiguredSignature,
    recordedMeetingContext,
  });
  const thread = getEmailListPrompt({ messages, messageMaxLength: 3000 });
  const temporalAndIdentityContext = `${getTodayForLLM(currentDate)}
重要：你正在以 ${emailAccount.email} 的身份撰写邮件。请从他们的角度撰写回复。`;

  return {
    thread,
    context: modelContext,
    temporalAndIdentityContext,
  };
}

/**
 * 展示给草稿生成模型的完整非会话上下文。评估判定器使用相同的已解析表示，
 * 确保生成与评分之间的产品优先级和格式规则不会发生偏差。
 */
export function buildDraftReplyModelContext({
  emailAccount,
  knowledgeBaseContent,
  replyMemoryContent,
  emailHistorySummary,
  emailHistoryContext,
  senderReplyExamples,
  calendarAvailability,
  writingStyle,
  learnedWritingStyle,
  mcpContext,
  meetingContext,
  recordedMeetingContext,
  attachmentContext,
  hasConfiguredSignature,
}: DraftReplyModelContextInput): string {
  const normalizedWritingStyle = writingStyle?.trim() || null;
  const normalizedLearnedWritingStyle = learnedWritingStyle?.trim() || null;
  const customWritingStyle =
    normalizedWritingStyle || normalizedLearnedWritingStyle;
  const effectiveWritingStyle = customWritingStyle
    ? `${customWritingStyle}\n\n${LENGTH_DISCIPLINE}`
    : defaultWritingStyle;
  const advisoryLearnedWritingStyle = normalizedWritingStyle
    ? normalizedLearnedWritingStyle
    : null;
  const userAbout = getUserAboutPrompt(emailAccount.about);

  const relevantKnowledge = knowledgeBaseContent
    ? `相关知识库内容：

<knowledge_base>
${knowledgeBaseContent}
</knowledge_base>
`
    : "";

  const learnedReplyMemories = replyMemoryContent
    ? `从以往草稿编辑中学到的回复记忆。这些是参考性内容，并非强制要求。仅在它们明显有助于当前邮件时使用，并忽略任何不适用的记忆。明确的用户指令和知识库内容优先。

<reply_memories>
${replyMemoryContent}
</reply_memories>
`
    : "";

  const historicalContext = emailHistorySummary
    ? `与该发件人的历史邮件上下文：

<sender_history>
${emailHistorySummary}
</sender_history>
`
    : "";

  const precedentHistoryContext = emailHistoryContext?.relevantEmails.length
    ? `来自相似邮件会话的参考性上下文，可能有助于撰写回复。

<email_history>
${emailHistoryContext.relevantEmails
  .map(
    (item) => `<item>
${item}
</item>`,
  )
  .join("\n")}
</email_history>

<email_history_notes>
${emailHistoryContext.notes || "无备注"}
</email_history_notes>
`
    : "";

  const senderReplyExamplesContext = senderReplyExamples
    ? `以往对该发件人的回复。可用于把握关系、语气、简洁度和直接程度；当前会话/上下文中的事实仍然优先。

<sender_reply_examples>
${senderReplyExamples}
</sender_reply_examples>
`
    : "";

  const writingStylePrompt = getWritingStylePrompt(effectiveWritingStyle);

  const learnedWritingStylePrompt = advisoryLearnedWritingStyle
    ? `从以往草稿编辑中学到的写作风格。这是参考性内容，优先级低于用户明确提供的任何写作风格。

<learned_writing_style>
${advisoryLearnedWritingStyle}
</learned_writing_style>
`
    : "";

  const schedulingContext = getSchedulingContext({
    calendarBookingLink: getCalendarBookingLinkForDraft(emailAccount),
    calendarAvailability,
    userTimezone: calendarAvailability?.timezone || emailAccount.timezone,
  });

  const mcpToolsContext = mcpContext
    ? `从外部工具（如 CRM 系统、任务管理工具或其他集成）获取的额外上下文，可能有助于撰写回复：

<external_tools_context>
${mcpContext}
</external_tools_context>
`
    : "";

  const missingExternalContext =
    !knowledgeBaseContent &&
    !emailHistorySummary &&
    !emailHistoryContext?.relevantEmails.length &&
    !mcpContext &&
    !meetingContext &&
    !recordedMeetingContext &&
    !attachmentContext
      ? `除邮件会话外，未提供其他事实性上下文。
`
      : "";

  const upcomingMeetingsContext = meetingContext || "";
  const selectedAttachments = attachmentContext
    ? `将随此草稿附上的已选 PDF 附件：

<selected_attachments>
${attachmentContext}
</selected_attachments>

仅在有用且存在此部分时才提及附件文档。
`
    : "";
  const signatureContext = hasConfiguredSignature
    ? `用户的邮箱账号已配置签名，该签名会附加在此草稿之后。不要撰写任何结尾、署名、姓名、头衔、联系方式或签名块。
`
    : "";

  return `${userAbout}
${relevantKnowledge}
${learnedReplyMemories}
${historicalContext}
${precedentHistoryContext}
${senderReplyExamplesContext}
${writingStylePrompt}
${learnedWritingStylePrompt}
${signatureContext}
${schedulingContext}
${mcpToolsContext}
${missingExternalContext}
${upcomingMeetingsContext}
${recordedMeetingContext || ""}
${selectedAttachments}`;
}

const llmDraftConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const draftSchema = z.object({
  reply: z.string().describe("包含知识库信息的完整邮件回复草稿"),
  confidence: llmDraftConfidenceSchema.describe(
    "仅在草稿完整、有依据，且不依赖缺失事实、待检查事项或后续跟进、不可用的日历/业务状态、假设或用户可填写的细节时使用 HIGH。对于依赖合理假设、缺失事实或用户可填写细节的有用草稿，使用 MEDIUM。当草稿高度不确定、可能需要更全面地审查会话/上下文，或主要是询问/检查/跟进时，使用 LOW。",
  ),
});

export type DraftReplyResult = {
  reply: string;
  confidence: DraftReplyConfidence;
  attribution: DraftAttribution | null;
};

export async function aiDraftReplyWithConfidence(
  input: DraftReplyInput,
): Promise<DraftReplyResult> {
  const {
    messages,
    emailAccount,
    knowledgeBaseContent,
    emailHistorySummary,
    calendarAvailability,
  } = input;
  logger.info("Drafting email reply", {
    messageCount: messages.length,
    hasKnowledge: !!knowledgeBaseContent,
    hasHistory: !!emailHistorySummary,
    calendarAvailability: calendarAvailability
      ? {
          noAvailability: calendarAvailability.noAvailability,
          suggestedTimesCount: calendarAvailability.suggestedTimes?.length || 0,
        }
      : null,
  });

  const prompt = getUserPrompt(input);

  const modelOptions = getModelForUseCase(
    emailAccount.user,
    LlmUseCase.DraftReply,
  );
  const attributionTracker = createDraftAttributionTracker();

  const generateObject = createGenerateObject({
    emailAccount,
    label: "撰写回复",
    modelOptions,
    promptHardening: { trust: "untrusted", level: "full" },
    onModelUsed: attributionTracker.onModelUsed,
  });

  const generate = () =>
    generateObject({
      ...modelOptions,
      instructions: appendOllamaOnlySystemGuidance(
        { instructions: systemPrompt },
        modelOptions,
        OLLAMA_DRAFT_RESPONSE_GUIDANCE,
      ).instructions,
      prompt,
      schema: draftSchema,
    });

  let result = await generate();

  if (REPETITIVE_TEXT_PATTERN.test(result.object.reply)) {
    logger.warn("回复草稿被拒绝：检测到重复输出，正在重试");
    result = await generate();

    if (REPETITIVE_TEXT_PATTERN.test(result.object.reply)) {
      logger.warn("回复草稿被拒绝：重试时仍出现重复输出");
      throw new Error("回复草稿生成产生了无效输出");
    }
  }

  return {
    reply: normalizeDraftReplyFormatting(result.object.reply),
    confidence: mapLlmDraftConfidence(result.object.confidence),
    attribution: attributionTracker.attribution,
  };
}

export async function aiDraftReply(input: DraftReplyInput) {
  const result = await aiDraftReplyWithConfidence(input);

  return result.reply;
}

export function normalizeDraftReplyFormatting(reply: string): string {
  const withNormalizedLineEndings = reply.replace(/\r\n?|\u2028|\u2029/g, "\n");

  const withDecodedEscapedNewlines = /\\r\\n|\\n|\\r/.test(
    withNormalizedLineEndings,
  )
    ? withNormalizedLineEndings
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
    : withNormalizedLineEndings;

  const cleaned = withDecodedEscapedNewlines
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const withRepairedCollapsedParagraphs =
    repairCollapsedParagraphBoundaries(cleaned);

  const nonEmptyLines = withRepairedCollapsedParagraphs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (shouldConvertSingleLineBreaksToParagraphs(nonEmptyLines)) {
    return nonEmptyLines.join("\n\n");
  }

  return withRepairedCollapsedParagraphs;
}

function repairCollapsedParagraphBoundaries(reply: string): string {
  if (reply.includes("\n")) return reply;

  const gluedSentenceBoundaryPattern = /([a-z0-9][.!?])(?=[A-Z])/g;
  const boundaryMatches = reply.match(gluedSentenceBoundaryPattern);

  if (!boundaryMatches || boundaryMatches.length < 2) return reply;

  return reply.replace(gluedSentenceBoundaryPattern, "$1\n\n");
}

function shouldConvertSingleLineBreaksToParagraphs(lines: string[]): boolean {
  if (lines.length < 2) return false;

  if (lines.some((line) => isLikelyListItem(line))) return false;

  const punctuatedLines = lines.filter((line) => /[.!?]$/.test(line)).length;
  const punctuationRatio = punctuatedLines / lines.length;

  return punctuationRatio >= 0.6;
}

function isLikelyListItem(line: string): boolean {
  return /^(\s*[-*]\s+|\s*\d+[.)]\s+|\s*[a-zA-Z][.)]\s+|>\s+)/.test(line);
}

/**
 * 导出是为了让评估工具反转此映射，而不是重复声明它。评估工具报告面向模型的标签，
 * 否则这里的静默重映射会让它继续报告旧语义，而没有任何测试失败。
 */
export const DRAFT_CONFIDENCE_BY_LLM_LABEL = {
  LOW: DraftReplyConfidence.ALL_EMAILS,
  MEDIUM: DraftReplyConfidence.STANDARD,
  HIGH: DraftReplyConfidence.HIGH_CONFIDENCE,
} as const;

function mapLlmDraftConfidence(confidence: unknown): DraftReplyConfidence {
  const llmConfidence = llmDraftConfidenceSchema.safeParse(confidence);
  if (!llmConfidence.success) {
    return normalizeDraftReplyConfidence(confidence);
  }

  return DRAFT_CONFIDENCE_BY_LLM_LABEL[llmConfidence.data];
}

// 匹配任意连续重复 50 次以上的非分隔符、非空白字符
const REPETITIVE_TEXT_PATTERN = /([^\s\-=_*.#~])\1{49,}/u;

function getSchedulingContext({
  calendarBookingLink,
  calendarAvailability,
  userTimezone,
}: {
  calendarBookingLink: string | null;
  calendarAvailability: CalendarAvailabilityContext | null;
  userTimezone: string | null | undefined;
}): string {
  const parts: string[] = [];
  const timezone = userTimezone || "UTC";

  if (calendarBookingLink) {
    parts.push(`<booking_link>
${calendarBookingLink}
</booking_link>

当明确需要与用户安排日程时，优先分享此预约链接，而不是列出具体空闲时间。不要将其用作非日程邮件的默认行动号召。`);
  }

  if (calendarAvailability?.noAvailability) {
    const timezoneLabel = getTimezoneLabel(timezone);

    parts.push(`用户在 ${timezoneLabel} 所请求的时间范围内没有可用的时间段。
不要建议具体时间。确认收到请求并提出替代方案（例如 "I'm fully booked tomorrow, but let's find another day that works"${calendarBookingLink ? " 或分享预约链接" : ""}）。`);
  } else if (calendarAvailability?.suggestedTimes.length) {
    const times = calendarAvailability.suggestedTimes
      .map((slot) =>
        formatAvailableSlotForPrompt(
          slot,
          timezone,
          getTimezoneLabel(timezone, slot.start),
        ),
      )
      .join("\n");
    const timezoneLabels = getTimezoneLabelsForSlots(
      timezone,
      calendarAvailability.suggestedTimes,
    );

    parts.push(`可用时间段位于 ${timezoneLabels}。
如果发件人要求或使用其他时区，请在换算用户的可用时间段后，用该时区表示建议的时间。
如果列出具体时间，请包含每个时间段显示给用户的时区标签，而不是原始时区标识符。

可用时间段：
${times}

${calendarBookingLink ? "由于用户有预约链接，请分享该链接而不是列出具体时间，除非发件人明确要求用户提供时间、询问某个具体的建议时间/日期，或预约链接无法满足日程安排请求。" : "当发件人要求安排日程时，使用这些时间段具体回复。将今天或之后提供的可用时间段视为有效；只有当所有提供的时间段都早于今天时，才询问更新的空闲时间。"} 除非发件人要求多个选项，否则只建议一个具体时间。如果发件人要求特定数量的选项，且有足够的时间段，请提供相应数量。如果发件人已经拒绝了一个提议，请提供另一个不同的具体时间。`);
  }

  if (parts.length === 0) return "";

  return `日程安排上下文：

<scheduling>
${parts.join("\n\n")}
</scheduling>
`;
}

export function getCalendarBookingLinkForDraft(
  emailAccount: Pick<DraftEmailAccount, "bookingLinks" | "calendarBookingLink">,
) {
  const inboxZeroBookingLink = emailAccount.bookingLinks?.[0];

  if (inboxZeroBookingLink) {
    return `${env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/book/${inboxZeroBookingLink.slug}`;
  }

  return emailAccount.calendarBookingLink;
}

function formatAvailableSlotForPrompt(
  slot: { start: string; end: string },
  timezone: string,
  timezoneLabel: string,
): string {
  const utcStart = formatLocalSlotTimeAsUtc(slot.start, timezone);
  const utcEnd = formatLocalSlotTimeAsUtc(slot.end, timezone);

  if (!utcStart || !utcEnd) {
    return `- ${slot.start} 至 ${slot.end}`;
  }

  return `- ${slot.start} 至 ${slot.end}（${timezoneLabel}；UTC ${utcStart} 至 ${utcEnd}）`;
}

function formatLocalSlotTimeAsUtc(
  localTime: string,
  timezone: string,
): string | null {
  const match = localTime.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);

  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
    timezone,
  );

  const utcDate = new Date(date.getTime());
  if (Number.isNaN(utcDate.getTime())) return null;

  return utcDate.toISOString().slice(0, 16).replace("T", " ");
}

function getTimezoneLabel(timezone: string, localTime?: string): string {
  if (timezone === "UTC") return "UTC";

  const date = localTime
    ? createDateFromLocalTime(localTime, timezone)
    : new Date();

  for (const style of [
    "short",
    "shortOffset",
    "shortGeneric",
    "longOffset",
  ] as const) {
    const label = getIntlTimezoneName(timezone, date, style);
    if (label && !looksLikeIanaTimezoneIdentifier(label)) return label;
  }

  return "UTC";
}

function looksLikeIanaTimezoneIdentifier(label: string): boolean {
  return label.includes("/");
}

function getTimezoneLabelsForSlots(
  timezone: string,
  slots: { start: string }[],
): string {
  const labels = [
    ...new Set(slots.map((slot) => getTimezoneLabel(timezone, slot.start))),
  ];

  return labels.join("/");
}

function createDateFromLocalTime(localTime: string, timezone: string): Date {
  const match = localTime.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);

  if (!match) return new Date();

  const [, year, month, day, hour, minute] = match;

  return new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
    timezone,
  );
}

function getIntlTimezoneName(
  timezone: string,
  date: Date,
  timeZoneName: "short" | "shortOffset" | "shortGeneric" | "longOffset",
): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName,
    }).formatToParts(date);

    return (
      parts.find((part) => part.type === "timeZoneName")?.value.trim() || null
    );
  } catch {
    return null;
  }
}

const OLLAMA_DRAFT_RESPONSE_GUIDANCE = [
  '返回一个恰好包含两个顶级字段的 JSON 对象："reply" 和 "confidence"。',
  '"reply" 必须是一个完整的邮件回复纯文本字符串，而不是备选方案的数组。',
  '"confidence" 必须是 "LOW"、"MEDIUM" 或 "HIGH" 之一。',
  '有效输出示例：{"reply":"Thanks for reaching out. I will take a look and follow up shortly.","confidence":"MEDIUM"}',
] as const;
