import type { VoiceCatalogEntry, VoiceProviderId } from "@/utils/voice/types";

export const VOICE_CATALOG: VoiceCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "听写、语音回复，以及 GPT-Live 全双工对话。",
    capabilities: { transcribe: true, synthesize: true, live: true },
  },
  {
    id: "groq",
    name: "Groq",
    description: "快速的 Whisper 级听写。不支持语音播报或实时通话。",
    capabilities: { transcribe: true, synthesize: false, live: false },
  },
];

export function voiceCatalogEntry(
  id: string | null | undefined,
): VoiceCatalogEntry | undefined {
  return VOICE_CATALOG.find((entry) => entry.id === id);
}

export function isVoiceProviderId(value: string): value is VoiceProviderId {
  return VOICE_CATALOG.some((entry) => entry.id === value);
}
