import { z } from "zod";
import { createGenerateObject } from "@/utils/llms/index";
import { strictOptional } from "@/utils/llms/strict-optional";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModelForUseCase, LlmUseCase } from "@/utils/llms/use-cases";
import { createScopedLogger } from "@/utils/logger";
import type { MeetingAttendee } from "@/utils/meeting-recorder/attendees";
import type { NormalizedTranscript } from "@/utils/meeting-recorder/bot-provider";
import { transcriptToPromptText } from "@/utils/meeting-recorder/transcript-prompt";

const logger = createScopedLogger("SummarizeMeeting");

const systemPrompt = `You are an expert notetaker summarizing a meeting from its transcript.

The transcript is automatically generated. Speaker labels can be wrong, words can be misheard, and people interrupt each other. Read it as imperfect evidence of what was said, not as a verbatim record.

Rules:
- Only report things that were actually said. Never invent a decision, a commitment, an owner or a date.
- Attribute an action item to someone only when the transcript shows that person taking it on. If the owner is unclear, leave the owner out rather than guessing.
- When the meeting reverses an earlier decision, report the final position, not the one that was superseded.
- If a speaker label looks wrong or two speakers have similar names, prefer describing what was decided over who said it.
- Leave a section empty when the meeting genuinely had nothing for it. An empty list is better than a filler entry.
- Write in the language the meeting was held in.
- Write for someone who attended and wants a reminder, not for someone who needs the meeting re-narrated.

Return your response in JSON format.`;

// Strict structured-output providers require every declared property to be
// required, so optional fields are required-but-nullable via strictOptional.
// Its `value ?? null` preprocess also keeps previously stored summaries
// parseable: fields absent in old rows come back as null.
const summarySchema = z.object({
  overview: z
    .string()
    .describe("A short paragraph covering what the meeting was about"),
  keyDecisions: z
    .array(z.string())
    .describe("Decisions the group actually settled on"),
  actionItems: z
    .array(
      z.object({
        description: z.string(),
        owner: strictOptional(z.string()).describe(
          "Only set when the transcript shows who took this on",
        ),
      }),
    )
    .describe("Concrete follow-up work agreed in the meeting"),
  openQuestions: strictOptional(z.array(z.string())).describe(
    "Questions raised but left unresolved",
  ),
  nextSteps: strictOptional(z.array(z.string())).describe(
    "What happens next, including any agreed timing",
  ),
});

export type MeetingSummary = z.infer<typeof summarySchema>;

export type MeetingSummaryInput = {
  emailAccount: EmailAccountWithAI;
  eventTitle: string;
  attendees: MeetingAttendee[];
  transcript: NormalizedTranscript;
};

/**
 * 读回我们以 JSON 存储的摘要。使用解析而非类型断言，这样在 schema 变更前写入的行
 * 会被重新生成摘要，而不是用 UI 已不再期望的字段渲染。
 */
export function parseMeetingSummary(value: unknown): MeetingSummary | null {
  const parsed = summarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function aiSummarizeMeeting({
  emailAccount,
  eventTitle,
  attendees,
  transcript,
}: MeetingSummaryInput): Promise<MeetingSummary> {
  logger.info("正在总结会议", { utterances: transcript.length });

  const modelOptions = getModelForUseCase(
    emailAccount.user,
    LlmUseCase.MeetingSummary,
  );

  // 转录内容是第三方发言，因此其中任何看起来像指令的内容都是数据，而不是命令
  const generateObject = createGenerateObject({
    emailAccount,
    label: "总结会议",
    modelOptions,
    promptHardening: { trust: "untrusted", level: "full" },
  });

  const result = await generateObject({
    ...modelOptions,
    instructions: systemPrompt,
    prompt: buildMeetingSummaryModelInput({
      eventTitle,
      attendees,
      transcript,
    }),
    schema: summarySchema,
  });

  return result.object;
}

export function buildMeetingSummaryModelInput({
  eventTitle,
  attendees,
  transcript,
}: Omit<MeetingSummaryInput, "emailAccount">): string {
  const attendeeList = attendees
    .map((attendee) =>
      attendee.name ? `${attendee.name} (${attendee.email})` : attendee.email,
    )
    .join("\n");

  return `Meeting title: ${eventTitle}

Invited attendees:
${attendeeList || "Not recorded"}

Transcript:
${transcriptToPromptText(transcript)}

Summarize this meeting.`;
}
