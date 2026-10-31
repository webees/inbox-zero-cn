import type { NormalizedTranscript } from "@/utils/meeting-recorder/bot-provider";

const DEFAULT_MAX_CHARS = 120_000;
const TRUNCATION_NOTICE =
  "\n[Transcript truncated: the middle of this meeting was omitted to fit the context limit.]\n";

/**
 * 将转录渲染为带说话人标签和时间戳的行。长达一小时的通话
 * 很容易超出模型的上下文，因此当转录过长时我们保留
 * 开头和结尾——达成一致和后续步骤通常出现在那里——
 * 并丢弃中间部分。
 */
export function transcriptToPromptText(
  transcript: NormalizedTranscript,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  const lines = transcript.map(
    (utterance) =>
      `[${formatTranscriptTimestamp(utterance.startTime)}] ${
        utterance.speakerName
      }: ${utterance.text}`,
  );

  const full = lines.join("\n");
  if (full.length <= maxChars) return full;

  // 太小，既无法说明有用内容又无法解释截断，因此
  // 保持在限制内，而不是用提示撑爆限制。
  if (maxChars <= TRUNCATION_NOTICE.length) return full.slice(0, maxChars);

  const budget = maxChars - TRUNCATION_NOTICE.length;
  const headBudget = Math.floor(budget * 0.6);
  const tailBudget = budget - headBudget;

  return (
    takeLinesWithinBudget(lines, headBudget, "head") +
    TRUNCATION_NOTICE +
    takeLinesWithinBudget(lines, tailBudget, "tail")
  );
}

function takeLinesWithinBudget(
  lines: string[],
  budget: number,
  from: "head" | "tail",
): string {
  const ordered = from === "head" ? lines : [...lines].reverse();
  const taken: string[] = [];
  let used = 0;

  for (const line of ordered) {
    const cost = line.length + 1;
    if (used + cost > budget) {
      const remaining = budget - used;
      if (taken.length === 0 && remaining > 0) {
        taken.push(
          from === "head" ? line.slice(0, remaining) : line.slice(-remaining),
        );
      }
      break;
    }
    taken.push(line);
    used += cost;
  }

  return (from === "head" ? taken : taken.reverse()).join("\n");
}

/** Seconds from the start of the recording, as `mm:ss`. */
export function formatTranscriptTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
