export function isIgnoredSender(sender: string) {
  // Superhuman 会发送提醒邮件，这些邮件在 Superhuman 内部会被自动过滤掉
  return sender === "Reminder <reminder@superhuman.com>";
}
