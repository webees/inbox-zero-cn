import type { NormalizedTranscript } from "@/utils/meeting-recorder/bot-provider";
import type { RecallTranscriptDownload } from "@/utils/recall/types";

const UNKNOWN_SPEAKER = "Unknown speaker";

/**
 * 将 Recall 的逐词转录折叠为每位参与者每轮发言的一句话
 * 。同一说话者的连续发言会被合并，使转录
 * 读起来像语音而非词流。
 */
export function normalizeRecallTranscript(
  download: RecallTranscriptDownload,
): NormalizedTranscript {
  const utterances: NormalizedTranscript = [];
  // 两个人可能共用同一个显示名，因此仅按姓名合并会把
  // 一个人的话归到另一个人身上。参与者 id 是唯一能
  // 可靠区分他们的依据。
  let previousSpeakerKey: string | null = null;

  for (const turn of download) {
    const text = turn.words
      .map((word) => word.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) continue;

    const speakerName = turn.participant.name?.trim() || UNKNOWN_SPEAKER;
    const startTime = turn.words[0]?.start_timestamp?.relative ?? 0;
    const endTime = turn.words.at(-1)?.end_timestamp?.relative ?? startTime;

    const speakerKey = [
      turn.participant.id ?? "",
      turn.participant.email ?? "",
      speakerName,
    ].join("\0");

    const previous = utterances.at(-1);
    if (previous && previousSpeakerKey === speakerKey) {
      previous.text = `${previous.text} ${text}`;
      previous.endTime = endTime;
      continue;
    }
    previousSpeakerKey = speakerKey;

    utterances.push({
      speakerName,
      isHost: turn.participant.is_host ?? false,
      email: turn.participant.email ?? undefined,
      startTime,
      endTime,
      text,
    });
  }

  return utterances;
}
