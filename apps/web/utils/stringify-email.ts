import {
  escapeHtml,
  removeExcessiveWhitespace,
  truncate,
} from "@/utils/string";
import type { EmailForLLM } from "@/utils/types";

// 邮件字段受攻击者控制。在插入 XML 风格分隔符之前对其进行转义，
// 这样构造的内容（例如 "</body></email>..."）就无法逃出自己的标签
// 并被模型当作带外指令读取。
export function stringifyEmail(email: EmailForLLM, maxLength: number) {
  // 不确定这里是否需要做 truncate/removeExcessiveWhitespace，因为 `emailToContent` 会处理。但需要确保它总会被调用
  const emailParts = [
    `<from>${escapeHtml(email.from)}</from>`,
    email.replyTo && `<replyTo>${escapeHtml(email.replyTo)}</replyTo>`,
    email.to && `<to>${escapeHtml(email.to)}</to>`,
    email.cc && `<cc>${escapeHtml(email.cc)}</cc>`,
    email.date && `<date>${email.date.toISOString()}</date>`,
    `<subject>${escapeHtml(email.subject)}</subject>`,
    // 在截断之后再转义，这样实体永远不会在序列中途被截断。
    `<body>${escapeHtml(truncate(removeExcessiveWhitespace(email.content), maxLength))}</body>`,
  ];

  if (email.attachments && email.attachments.length > 0) {
    const attachmentsXml = email.attachments
      .map(
        (att) =>
          `<attachment filename="${escapeHtml(att.filename)}" type="${escapeHtml(att.mimeType)}" size="${att.size}" />`,
      )
      .join("\n");
    emailParts.push(`<attachments>\n${attachmentsXml}\n</attachments>`);
  }

  return emailParts.filter(Boolean).join("\n");
}

export function stringifyEmailSimple(email: EmailForLLM) {
  const emailParts = [
    `<from>${escapeHtml(email.from)}</from>`,
    `<subject>${escapeHtml(email.subject)}</subject>`,
    `<body>${escapeHtml(email.content)}</body>`,
  ];

  return emailParts.filter(Boolean).join("\n");
}

export function stringifyEmailFromBody(email: EmailForLLM) {
  const emailParts = [
    `<from>${escapeHtml(email.from)}</from>`,
    `<body>${escapeHtml(email.content)}</body>`,
  ];

  return emailParts.filter(Boolean).join("\n");
}
