/**
 * 为回复邮件格式化主题行。
 * 如果尚不存在则添加 "Re:" 前缀（不区分大小写）。
 * 根据 RFC 5322，回复应使用单个 "Re:" 前缀，而不是叠加。
 */
export function formatReplySubject(subject: string): string {
  const trimmed = (subject ?? "").trim();
  // 避免只有 "Re: " 而没有主题
  if (!trimmed) {
    return "Re: (no subject)";
  }
  // 避免重复的 "Re:" 前缀（不区分大小写检查）
  if (/^re:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}
