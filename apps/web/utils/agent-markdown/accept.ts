const PRODUCES = ["text/html", "text/markdown"] as const;

export type ProducedMediaType = (typeof PRODUCES)[number];

type AcceptEntry = {
  position: number;
  q: number;
  type: string;
};

/**
 * 将 Accept 请求头解析为带 q 值的媒体范围条目。
 * 面向规范的子集，足以支持 HTML 与 Markdown 之间的内容协商。
 */
export function parseAcceptHeader(header: string | null): AcceptEntry[] {
  if (!header?.trim()) return [];

  return header.split(",").flatMap((part, position) => {
    const segments = part
      .trim()
      .split(";")
      .map((segment) => segment.trim());
    const type = segments[0]?.toLowerCase();
    if (!type) return [];

    let q = 1;
    for (const param of segments.slice(1)) {
      const [rawName, rawValue] = param.split("=").map((s) => s.trim());
      if (rawName?.toLowerCase() === "q" && rawValue != null) {
        const parsed = Number(rawValue);
        if (!Number.isNaN(parsed)) {
          q = Math.min(1, Math.max(0, parsed));
        }
      }
    }

    return [{ type, q, position }];
  });
}

/**
 * 在 text/html 与 text/markdown 之间选择首选的表示形式。
 * 当客户端显式拒绝所有可生成的类型时返回 null。
 */
export function preferredType(
  acceptHeader: string | null,
): ProducedMediaType | null {
  const entries = parseAcceptHeader(acceptHeader);
  if (entries.length === 0) return "text/html";

  let bestType: ProducedMediaType | null = null;
  let bestQ = -1;
  let bestPosition = Number.POSITIVE_INFINITY;

  for (const candidate of PRODUCES) {
    let matched: AcceptEntry | null = null;

    for (const entry of entries) {
      if (!matches(entry.type, candidate)) continue;
      if (
        !matched ||
        specificity(entry.type) > specificity(matched.type) ||
        (specificity(entry.type) === specificity(matched.type) &&
          entry.position < matched.position)
      ) {
        matched = entry;
      }
    }

    if (!matched || matched.q <= 0) continue;

    if (
      matched.q > bestQ ||
      (matched.q === bestQ && matched.position < bestPosition)
    ) {
      bestQ = matched.q;
      bestPosition = matched.position;
      bestType = candidate;
    }
  }

  return bestType;
}

export function prefersMarkdown(acceptHeader: string | null): boolean {
  return preferredType(acceptHeader) === "text/markdown";
}

/** 将 Accept 追加到 Vary，同时不丢弃已有的 token（例如 RSC 的 vary）。 */
export function appendVaryAccept(headers: Headers): void {
  const existing = headers.get("vary");
  if (existing === "*") return;

  if (!existing) {
    headers.set("Vary", "Accept");
    return;
  }

  const tokens = existing.split(",").map((token) => token.trim().toLowerCase());
  if (!tokens.includes("accept")) {
    headers.set("Vary", `${existing}, Accept`);
  }
}

function specificity(type: string): number {
  if (type === "*/*") return 0;
  if (type.endsWith("/*")) return 1;
  return 2;
}

function matches(entryType: string, candidate: string): boolean {
  if (entryType === "*/*") return true;
  if (entryType.endsWith("/*")) {
    return candidate.startsWith(entryType.slice(0, -1));
  }
  return entryType === candidate;
}
