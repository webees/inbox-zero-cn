// 注意：这仅适用于英文。将来可能希望支持其他语言。
export function snippetRemoveReply(snippet?: string | null): string {
  if (!snippet) return "";
  try {
    const regex = /On (Mon|Tue|Wed|Thu|Fri|Sat|Sun),/;
    const match = snippet.split(regex)[0];
    return match.trim();
  } catch {
    return snippet;
  }
}
