import type { gmail_v1 } from "@googleapis/gmail";
import type { Prisma } from "@/generated/prisma/client";
import type {
  Recipient,
  NullableOption,
} from "@microsoft/microsoft-graph-types";

// https://stackoverflow.com/a/53276873/2602771
export type PartialRecord<K extends PropertyKey, T> = Partial<Record<K, T>>;

// 用于已移除 undefined 和 null 值的过滤器的类型守卫
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

export type RuleWithActions = Prisma.RuleGetPayload<{
  include: { actions: true };
}>;

export type BatchError = {
  error: {
    code: number;
    message: string;
    errors: Array<{
      message?: string;
      reason?: string;
    }>;
    status: string;
  };
};

export function isBatchError<T>(item: T | BatchError): item is BatchError {
  return (item as BatchError).error !== undefined;
}

export type MessageWithPayload = {
  historyId?: string | null;
  id?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  raw?: string | null;
  sizeEstimate?: number | null;
  snippet?: string | null;
  threadId?: string | null;
  payload: gmail_v1.Schema$MessagePart;
};

export type ThreadWithPayloadMessages = gmail_v1.Schema$Thread & {
  messages: MessageWithPayload[];
};

export interface ParsedMessage {
  attachments?: Attachment[];
  bodyContentType?: "text" | "html"; // 对于 Outlook：表示正文原本采用的格式
  calendarContent?: string;
  // 对于 Outlook：邮箱为该邀请在用户日历上创建的事件
  calendarEventId?: string;
  conversationIndex?: string | null;
  date: string;
  externalUrl?: string;
  hasAttachment?: boolean;
  headers: ParsedMessageHeaders;
  historyId: string;
  id: string;
  inboxSection?: "focused" | "other" | null;
  inline: Attachment[];
  internalDate?: string | null;
  isMeetingInvitation?: boolean;
  labelIds?: string[];
  parentFolderId?: string;
  // 对于 Outlook：存储原始收件人数据以避免重复转换
  rawRecipients?: {
    from?: NullableOption<Recipient>;
    toRecipients?: NullableOption<Recipient[]>;
    ccRecipients?: NullableOption<Recipient[]>;
  };
  snippet: string;
  subject: string;
  textHtml?: string;
  textPlain?: string;
  threadId: string;
}

export interface Attachment {
  attachmentId: string;
  filename: string;
  headers: Headers;
  mimeType: string;
  size: number;
}

interface Headers {
  "content-description": string;
  "content-disposition"?: string;
  "content-id": string;
  "content-transfer-encoding": string;
  "content-type": string;
}

export interface ParsedMessageHeaders {
  bcc?: string;
  cc?: string;
  date: string; // 邮件提供的日期。内部我们依赖 gmail api 提供的 message.internalDate
  from: string;
  "in-reply-to"?: string;
  "list-unsubscribe"?: string;
  "list-unsubscribe-post"?: string;
  "message-id"?: string;
  references?: string;
  "reply-to"?: string;
  subject: string;
  to: string;
}

// 注意：使用 `getEmailForLLM(message)` 将 `ParsedMessage` 转换为 `EmailForLLM`
export type EmailForLLM = {
  id: string;
  from: string;
  to: string;
  replyTo?: string;
  cc?: string;
  subject: string;
  content: string;
  date?: Date;
  listUnsubscribe?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }>;
};
