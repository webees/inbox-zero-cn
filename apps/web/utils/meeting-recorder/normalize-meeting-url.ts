// 将视频会议链接规范化为一个稳定的键，用于判断两个日历事件
//（可能属于不同账号）是否为同一场实体会议。结果仅是去重键：
// 它会剥离密码和每位受邀者独有的上下文，
// 因此绝不能发送给机器人服务商。

// 使用锚定，以免无关路径中某个形似服务商的片段
// 被误认为会议 id。
const ZOOM_MEETING_ID = /^\/(?:j|s|w|wc\/join)\/(\d{9,13})(?:\/|$)/;
const TEAMS_THREAD_ID = /^\/l\/meetup-join\/(19:[^/]*@thread\.v2)(?:\/|$)/;
const TEAMS_LIVE_MEET_ID = /^\/meet\/(\d+)(?:\/|$)/;

/**
 * 当 `host` 就是该域名本身或其子域名时返回 true。
 *
 * 简单的 `endsWith` 会接受 `evilzoom.us`，而由于结果正是
 * 决定哪些账号共享同一段录制的键，这会让
 * 攻击者控制的链接与真实会议发生碰撞。
 */
export function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function normalizeMeetingUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }

  const host = url.hostname.toLowerCase();

  if (isHost(host, "meet.google.com")) {
    return `meet.google.com${stripTrailingSlash(url.pathname.toLowerCase())}`;
  }

  if (isHost(host, "zoom.us") || isHost(host, "zoom.com")) {
    return normalizeZoom(url, host);
  }

  if (isHost(host, "teams.microsoft.com") || isHost(host, "teams.live.com")) {
    return normalizeTeams(url, host);
  }

  return `${host}${stripTrailingSlash(url.pathname.toLowerCase())}`;
}

function normalizeZoom(url: URL, host: string): string {
  const meetingId = ZOOM_MEETING_ID.exec(url.pathname)?.[1];
  // 去掉自定义子域名：acme.zoom.us/j/123 和 zoom.us/j/123 是
  // 同一场会议，而密码位于查询字符串中。
  if (meetingId) return `zoom.us/j/${meetingId}`;

  return `${host}${stripTrailingSlash(url.pathname.toLowerCase())}`;
}

function normalizeTeams(url: URL, host: string): string {
  // Teams 将会话 id 编码在路径中，并附加一个每位受邀者
  // 都不同的 `context` 查询参数。
  const decodedPath = safeDecode(url.pathname);

  const threadId = TEAMS_THREAD_ID.exec(decodedPath)?.[1];
  if (threadId) return `teams.microsoft.com/l/meetup-join/${threadId}`;

  const liveMeetId = TEAMS_LIVE_MEET_ID.exec(decodedPath)?.[1];
  if (liveMeetId) return `teams.live.com/meet/${liveMeetId}`;

  return `${host}${stripTrailingSlash(decodedPath.toLowerCase())}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}
