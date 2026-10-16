import { DraftReplyConfidence } from "@/generated/prisma/enums";

export const DEFAULT_DRAFT_REPLY_CONFIDENCE = DraftReplyConfidence.ALL_EMAILS;

const DRAFT_REPLY_CONFIDENCE_RANK: Record<DraftReplyConfidence, number> = {
  [DraftReplyConfidence.ALL_EMAILS]: 0,
  [DraftReplyConfidence.STANDARD]: 1,
  [DraftReplyConfidence.HIGH_CONFIDENCE]: 2,
};

export const DRAFT_REPLY_CONFIDENCE_OPTIONS = [
  {
    value: DraftReplyConfidence.ALL_EMAILS,
    label: "所有邮件",
    description: "为每封邮件起草回复，即使不确定也照常起草",
  },
  {
    value: DraftReplyConfidence.STANDARD,
    label: "标准",
    description: "当 AI 明显不确定时跳过起草。大多数邮件仍会生成草稿",
  },
  {
    value: DraftReplyConfidence.HIGH_CONFIDENCE,
    label: "高置信度",
    description: "仅当 AI 非常确定合适的回复时才起草。许多邮件将不会生成草稿",
  },
] as const;

export function getDraftReplyConfidenceOption(
  confidence: DraftReplyConfidence | null | undefined,
) {
  return (
    DRAFT_REPLY_CONFIDENCE_OPTIONS.find(
      (option) => option.value === confidence,
    ) ?? DRAFT_REPLY_CONFIDENCE_OPTIONS[0]
  );
}

export function normalizeDraftReplyConfidence(
  confidence: unknown,
): DraftReplyConfidence {
  return (
    (typeof confidence === "string" &&
    Object.values(DraftReplyConfidence).includes(
      confidence as DraftReplyConfidence,
    )
      ? (confidence as DraftReplyConfidence)
      : null) ?? DraftReplyConfidence.ALL_EMAILS
  );
}

export function meetsDraftReplyConfidenceRequirement({
  draftConfidence,
  minimumConfidence,
}: {
  draftConfidence: DraftReplyConfidence | null | undefined;
  minimumConfidence: DraftReplyConfidence | null | undefined;
}) {
  if (!minimumConfidence) return true;
  if (!draftConfidence) {
    return minimumConfidence === DraftReplyConfidence.ALL_EMAILS;
  }

  return (
    DRAFT_REPLY_CONFIDENCE_RANK[draftConfidence] >=
    DRAFT_REPLY_CONFIDENCE_RANK[minimumConfidence]
  );
}
