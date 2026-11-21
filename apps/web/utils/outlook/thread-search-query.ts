import {
  parseBooleanSearchValue,
  tokenizeSearchQuery,
  unquoteSearchValue,
} from "@/utils/tokenize-search-query";
import { escapeSearchValue } from "@/utils/outlook/search-escape";
import type { WELL_KNOWN_FOLDERS } from "@/utils/outlook/constants";

export type OutlookWellKnownFolder = keyof typeof WELL_KNOWN_FOLDERS;

export type CompiledOutlookSearch = {
  /** Quoted Graph `$search` value, or empty when the query is filter-only. */
  search: string;
  folderKey?: OutlookWellKnownFolder;
  folderName?: string;
  flagged: boolean;
  category?: string;
};

type OutlookSearchToken = {
  excluded: boolean;
  field: string | null;
  comparator: ":" | ">" | ">=" | "<" | "<=" | null;
  value: string;
};

type OutlookSearchScope = {
  folderKey?: OutlookWellKnownFolder;
  folderName?: string;
  flagged: boolean;
  category?: string;
};

const FOLDER_KEY_BY_IN_VALUE: Record<string, OutlookWellKnownFolder> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  junk: "junkemail",
  spam: "junkemail",
  deleted: "deleteditems",
  trash: "deleteditems",
};

const KQL_TEXT_FIELDS = new Set(["from", "to", "subject"]);

/**
 * 将 Outlook 搜索框查询编译为 Graph `$search` KQL，以及
 * Graph 无法混入 `$search` 的文件夹/标志/类别范围。
 */
export function compileOutlookThreadSearch(
  query: string,
): CompiledOutlookSearch {
  const included: string[] = [];
  const excluded: string[] = [];
  const scope: OutlookSearchScope = { flagged: false };

  const tokens = tokenizeSearchQuery(query);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    if (/^not$/i.test(token)) {
      const next = tokens[index + 1];
      if (!next) continue;
      const term = toKqlTerm(parseOutlookSearchToken(next));
      if (term) excluded.push(`NOT ${term}`);
      index += 1;
      continue;
    }

    const parsed = parseOutlookSearchToken(token);
    if (applyOutlookSearchScope(parsed, scope)) continue;

    const term = toKqlTerm(parsed);
    if (!term) continue;
    if (parsed.excluded) excluded.push(`NOT ${term}`);
    else included.push(term);
  }

  const { folderKey, folderName, flagged, category } = scope;

  if (!included.length && !excluded.length) {
    return { search: "", folderKey, folderName, flagged, category };
  }
  // KQL 拒绝纯否定查询，因此将它们锚定到每封邮件。
  if (!included.length) included.push("size>=0");

  return {
    search: `"${[...included, ...excluded].join(" ")}"`,
    folderKey,
    folderName,
    flagged,
    category,
  };
}

export function isEmptyOutlookSearch(compiled: CompiledOutlookSearch): boolean {
  return (
    !compiled.search &&
    !compiled.folderKey &&
    !compiled.folderName &&
    !compiled.flagged &&
    !compiled.category
  );
}

export function parseOutlookSearchToken(token: string): OutlookSearchToken {
  const excluded = token.startsWith("-") && token.length > 1;
  const raw = excluded ? token.slice(1) : token;
  if (raw.startsWith('"')) {
    return {
      excluded,
      field: null,
      comparator: null,
      value: unquoteSearchValue(raw),
    };
  }

  const match = raw.match(/^([a-z]+)(>=|<=|>|<|:)(.*)$/i);
  if (!match || /^(https?|ftp|mailto|file)$/i.test(match[1])) {
    return {
      excluded,
      field: null,
      comparator: null,
      value: unquoteSearchValue(raw),
    };
  }

  return {
    excluded,
    field: match[1].toLowerCase(),
    comparator: match[2] as OutlookSearchToken["comparator"],
    value: unquoteSearchValue(match[3]),
  };
}

function applyOutlookSearchScope(
  parsed: OutlookSearchToken,
  scope: OutlookSearchScope,
): boolean {
  if (parsed.field === "in") {
    if (!parsed.excluded) {
      const key = FOLDER_KEY_BY_IN_VALUE[parsed.value.toLowerCase()];
      if (key && !scope.folderKey && !scope.folderName) scope.folderKey = key;
    }
    return true;
  }
  if (parsed.field === "folder") {
    if (
      !parsed.excluded &&
      parsed.value &&
      !scope.folderKey &&
      !scope.folderName
    ) {
      scope.folderName = parsed.value;
    }
    return true;
  }
  if (parsed.field === "is" && parsed.value.toLowerCase() === "flagged") {
    if (!parsed.excluded) scope.flagged = true;
    return true;
  }
  if (parsed.field === "category") {
    if (!parsed.excluded && parsed.value && !scope.category) {
      scope.category = parsed.value;
    }
    return true;
  }
  return false;
}

function toKqlTerm(parsed: OutlookSearchToken): string | null {
  const { field, comparator, value } = parsed;

  if (!field) return toKqlValue(value);

  if (KQL_TEXT_FIELDS.has(field)) {
    const kqlValue = toKqlValue(value);
    return kqlValue ? `${field}:${kqlValue}` : null;
  }

  if (field === "hasattachments" && parseBooleanSearchValue(value) === true) {
    return "hasattachments:true";
  }

  if (field === "size" && comparator && comparator !== ":") {
    const bytes = parseSizeBytes(value);
    if (bytes === null) return null;
    return `size${comparator}${bytes}`;
  }

  if (field === "received" && comparator && comparator !== ":") {
    const date = parseOutlookDate(value);
    if (!date) return null;
    return `received${comparator}${date}`;
  }

  // 未知的 Outlook/KQL 限制会原样透传，使诸如
  // importance:high 的类型化查询仍能到达 Graph。
  if (comparator === ":") {
    const kqlValue = toKqlValue(value);
    return kqlValue ? `${field}:${kqlValue}` : null;
  }

  return toKqlValue(value);
}

function toKqlValue(value: string): string | null {
  const cleaned = value
    .replace(/[?"\u201c\u201d\u2018\u2019]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const escaped = escapeSearchValue(cleaned);
  // 未加引号的冒号会将字面文本变成属性限制。
  return /[\s:]/.test(cleaned) ? `\\"${escaped}\\"` : escaped;
}

function parseSizeBytes(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)(mb|kb|m|k)?$/i);
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  let bytes = Number(match[1]);
  if (unit === "k" || unit === "kb") bytes *= 1024;
  if (unit === "m" || unit === "mb") bytes *= 1024 ** 2;
  if (!Number.isFinite(bytes)) return null;
  return Math.round(bytes);
}

function parseOutlookDate(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== Number(year)) return null;
  if (date.getUTCMonth() + 1 !== Number(month)) return null;
  if (date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}
