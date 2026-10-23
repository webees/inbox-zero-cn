/**
 * 构建符合 RFC 5322 的邮件会话头。
 * References = 父级的 References + 父级的 Message-ID
 * https://datatracker.ietf.org/doc/html/rfc5322#appendix-A.2
 */
export function buildThreadingHeaders(options: {
  headerMessageId: string;
  references?: string;
}): { inReplyTo: string; references: string } {
  if (!options.headerMessageId) {
    return { inReplyTo: "", references: "" };
  }

  return {
    inReplyTo: options.headerMessageId,
    references: options.references
      ? `${options.references} ${options.headerMessageId}`.trim()
      : options.headerMessageId,
  };
}
