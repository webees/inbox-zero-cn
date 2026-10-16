import he from "he";
import { isHost } from "@/utils/meeting-recorder/normalize-meeting-url";

// 使这些主机与 normalizeMeetingUrl 保持同步：此处提取的链接
// 在构建录音去重键时会成为它的输入。
const KNOWN_MEETING_HOST =
  /meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com/i;

const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

export function findVideoConferenceLink(
  ...eventDetails: Array<string | null | undefined>
): string | undefined {
  for (const detail of eventDetails) {
    if (!detail) continue;

    // 过滤前先解码：HTML 正文可以对任何字符进行实体编码，
    // 包括主机名中的点（例如 meet&#46;google&#46;com）。
    const decoded = he.decode(detail);
    if (!KNOWN_MEETING_HOST.test(decoded)) continue;

    const urls = decoded.match(/https?:\/\/[^\s<>"']+/gi);

    for (const url of urls ?? []) {
      if (!KNOWN_MEETING_HOST.test(url)) continue;
      const candidate = url.replace(TRAILING_PUNCTUATION, "");
      // 上面每个主机都只提供 HTTPS，因此 http:// 链接会在重定向前
      // 以明文泄露会议 id 和密码。
      if (isVideoConferenceLink(candidate))
        return candidate.replace(/^http:\/\//i, "https://");
    }
  }
}

function isVideoConferenceLink(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    const host = url.hostname;

    if (isHost(host, "meet.google.com")) {
      return url.pathname !== "/";
    }

    if (isHost(host, "zoom.us") || isHost(host, "zoom.com")) {
      return /^\/(?:j|s|w|wc\/join|my)\//i.test(url.pathname);
    }

    if (isHost(host, "teams.microsoft.com")) {
      return /^\/(?:l\/meetup-join|meet)\//i.test(url.pathname);
    }

    return isHost(host, "teams.live.com") && /^\/meet\//i.test(url.pathname);
  } catch {
    return false;
  }
}
