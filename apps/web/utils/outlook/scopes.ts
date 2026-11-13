// https://learn.microsoft.com/en-us/graph/permissions-reference

import { env } from "@/env";

export const REQUIRED_SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
  "offline_access", // Required for refresh tokens
  "Mail.ReadWrite", // Read and write access to mailbox
  ...(env.NEXT_PUBLIC_EMAIL_SEND_ENABLED ? ["Mail.Send"] : []), // Send emails
  "MailboxSettings.ReadWrite", // Read and write mailbox settings
] as const;

export const SCOPES = [
  ...REQUIRED_SCOPES,
  // Contacts.Read 读取已保存联系人文件夹；People.Read 还会加入
  // 目录和近期通信人。两者都是可选的，且在请求其中任何一个之前
  // 已授权的账号可继续使用其持有的权限。
  ...(env.NEXT_PUBLIC_CONTACTS_ENABLED ? ["Contacts.Read", "People.Read"] : []),
] as const;

export const CALENDAR_SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
  "offline_access", // Required for refresh tokens
  "Calendars.Read", // Read user calendars
  "Calendars.ReadWrite", // Read and write user calendars
] as const;
