export function requireSentMessageId(messageId?: string | null) {
  if (!messageId) throw new Error("服务商未返回已发送邮件的 ID");
  return messageId;
}
