export function tokenizeSearchQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of query.trim()) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function parseSearchToken(token: string): {
  excluded: boolean;
  operator: string | null;
  value: string;
} {
  const excluded = token.startsWith("-") && token.length > 1;
  const raw = excluded ? token.slice(1) : token;
  const colon = raw.indexOf(":");
  if (colon <= 0 || raw.startsWith('"')) {
    return { excluded, operator: null, value: unquoteSearchValue(raw) };
  }
  return {
    excluded,
    operator: raw.slice(0, colon).toLowerCase(),
    value: unquoteSearchValue(raw.slice(colon + 1)),
  };
}

export function unquoteSearchValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * 像 hasattachments: 这样的布尔运算符在我们的搜索表单中写作 true/false，
 * 但手动输入的查询也会使用 yes/no。当值两者都不是时返回 undefined，
 * 以便调用方将 token 留给其他处理逻辑。
 */
export function parseBooleanSearchValue(value: string): boolean | undefined {
  if (/^(true|yes)$/i.test(value)) return true;
  if (/^(false|no)$/i.test(value)) return false;
  return;
}
