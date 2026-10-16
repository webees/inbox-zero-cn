import "server-only";

import { randomUUID } from "node:crypto";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isDefined } from "@/utils/types";
import {
  extractDomainFromEmail,
  extractEmailAddress,
  extractNameFromEmail,
} from "@/utils/email";
import type { EmailProvider } from "@/utils/email/types";
import { internalDateToDate } from "@/utils/date";
import { findUnsubscribeLink } from "@/utils/parse/parseHtml.server";
import {
  cleanUnsubscribeLink,
  parseListUnsubscribeHeader,
} from "@/utils/parse/unsubscribe";

const PAGE_SIZE = 20; // 不要设置得过高，否则会触发速率限制
const MAX_PAGES = 50;

export async function loadEmails(
  {
    emailAccountId,
    emailProvider,
    logger,
  }: {
    emailAccountId: string;
    emailProvider: EmailProvider;
    logger: Logger;
  },
  {
    loadBefore,
    maxPages = MAX_PAGES,
  }: { loadBefore: boolean; maxPages?: number },
) {
  let pages = 0;
  let loadedAfterMessages = 0;
  let loadedBeforeMessages = 0;
  let hasMoreAfter = false;
  let hasMoreBefore = false;

  const newestEmailSaved = await prisma.emailMessage.findFirst({
    where: { emailAccountId },
    orderBy: { date: "desc" },
  });

  const after = newestEmailSaved?.date;
  logger.info("正在加载较新邮件", { after });

  let nextPageToken: string | undefined;
  while (pages < maxPages) {
    logger.info("较新邮件分页", { pages, nextPageToken });
    const res = await saveBatch({
      emailAccountId,
      emailProvider,
      logger,
      nextPageToken,
      after,
      before: undefined,
    });

    nextPageToken = res.data.nextPageToken ?? undefined;
    loadedAfterMessages += res.data.messages?.length || 0;

    if (!res.data.messages || res.data.messages.length < PAGE_SIZE) {
      hasMoreAfter = false;
      break;
    }

    pages++;

    if (!nextPageToken) {
      hasMoreAfter = false;
      break;
    }

    hasMoreAfter = true;
  }

  logger.info("较新邮件加载完成", { after, pages });

  if (!loadBefore || !newestEmailSaved) {
    return {
      pages,
      loadedAfterMessages,
      loadedBeforeMessages,
      hasMoreAfter,
      hasMoreBefore,
    };
  }

  const oldestEmailSaved = await prisma.emailMessage.findFirst({
    where: { emailAccountId },
    orderBy: { date: "asc" },
  });

  const before = oldestEmailSaved?.date;
  logger.info("正在加载较旧邮件", { before });

  if (!before) {
    return {
      pages,
      loadedAfterMessages,
      loadedBeforeMessages,
      hasMoreAfter,
      hasMoreBefore,
    };
  }

  nextPageToken = undefined;
  while (pages < maxPages) {
    logger.info("较旧邮件分页", { pages, nextPageToken });
    const res = await saveBatch({
      emailAccountId,
      emailProvider,
      logger,
      nextPageToken,
      before,
      after: undefined,
    });

    nextPageToken = res.data.nextPageToken ?? undefined;
    loadedBeforeMessages += res.data.messages?.length || 0;

    if (!res.data.messages || res.data.messages.length < PAGE_SIZE) {
      hasMoreBefore = false;
      break;
    }

    pages++;

    if (!nextPageToken) {
      hasMoreBefore = false;
      break;
    }

    hasMoreBefore = true;
  }

  logger.info("较旧邮件加载完成", { before, pages });

  return {
    pages,
    loadedAfterMessages,
    loadedBeforeMessages,
    hasMoreAfter,
    hasMoreBefore,
  };
}

export async function saveBatch({
  emailAccountId,
  emailProvider,
  logger,
  nextPageToken,
  before,
  after,
}: {
  emailAccountId: string;
  emailProvider: EmailProvider;
  logger: Logger;
  nextPageToken?: string;
} & (
  | { before: Date; after: undefined }
  | { before: undefined; after: Date }
  | { before: undefined; after: undefined }
)) {
  const res = await emailProvider.getMessagesWithPagination({
    maxResults: PAGE_SIZE,
    pageToken: nextPageToken,
    before,
    after,
  });

  const messages = res.messages ?? [];

  const emailsToSave = messages
    .map((m) => {
      const unsubscribeLink = mergeUnsubscribeSources({
        htmlUnsubscribeLink: findUnsubscribeLink(m.textHtml),
        listUnsubscribeHeader: m.headers["list-unsubscribe"],
      });

      const date = internalDateToDate(m.internalDate);
      if (!date) {
        logger.error("邮件没有日期", {
          messageId: m.id,
          date: m.internalDate,
        });
        return;
      }

      return {
        threadId: m.threadId,
        messageId: m.id,
        from: extractEmailAddress(m.headers.from),
        fromName: extractNameFromEmail(m.headers.from),
        fromDomain: extractDomainFromEmail(m.headers.from),
        to: m.headers.to ? extractEmailAddress(m.headers.to) : "Missing",
        date,
        unsubscribeLink,
        read: !m.labelIds?.includes("UNREAD"),
        sent: !!m.labelIds?.includes("SENT"),
        draft: !!m.labelIds?.includes("DRAFT"),
        inbox: !!m.labelIds?.includes("INBOX"),
        emailAccountId,
      };
    })
    .filter(isDefined);

  logger.info("Saving", { count: emailsToSave.length });

  await saveEmailMessages(emailsToSave);

  return {
    data: {
      messages: res.messages,
      nextPageToken: res.nextPageToken,
    },
  };
}

async function saveEmailMessages(
  emails: {
    threadId: string;
    messageId: string;
    from: string;
    fromName: string;
    fromDomain: string;
    to: string;
    date: Date;
    unsubscribeLink: string | null | undefined;
    read: boolean;
    sent: boolean;
    draft: boolean;
    inbox: boolean;
    emailAccountId: string;
  }[],
) {
  if (emails.length === 0) return;

  const rows = emails.map(
    (email) => Prisma.sql`(
      ${randomUUID()}::text,
      ${email.emailAccountId}::text,
      ${email.threadId}::text,
      ${email.messageId}::text,
      ${email.date}::timestamp,
      ${email.from}::text,
      ${email.fromName}::text,
      ${email.fromDomain}::text,
      ${email.to}::text,
      ${email.unsubscribeLink}::text,
      ${email.read}::boolean,
      ${email.sent}::boolean,
      ${email.draft}::boolean,
      ${email.inbox}::boolean,
      NOW(),
      NOW()
    )`,
  );

  await prisma.$executeRaw`
    INSERT INTO "EmailMessage" (
      "id",
      "emailAccountId",
      "threadId",
      "messageId",
      "date",
      "from",
      "fromName",
      "fromDomain",
      "to",
      "unsubscribeLink",
      "read",
      "sent",
      "draft",
      "inbox",
      "createdAt",
      "updatedAt"
    )
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("emailAccountId", "threadId", "messageId") DO UPDATE SET
      "date" = EXCLUDED."date",
      "from" = EXCLUDED."from",
      "fromName" = EXCLUDED."fromName",
      "fromDomain" = EXCLUDED."fromDomain",
      "to" = EXCLUDED."to",
      "unsubscribeLink" = EXCLUDED."unsubscribeLink",
      "read" = EXCLUDED."read",
      "sent" = EXCLUDED."sent",
      "draft" = EXCLUDED."draft",
      "inbox" = EXCLUDED."inbox",
      "updatedAt" = NOW()
  `;
}

function mergeUnsubscribeSources({
  htmlUnsubscribeLink,
  listUnsubscribeHeader,
}: {
  htmlUnsubscribeLink?: string | null;
  listUnsubscribeHeader?: string | null;
}) {
  if (!listUnsubscribeHeader) return cleanUnsubscribeLink(htmlUnsubscribeLink);

  const normalizedHtmlLink = cleanUnsubscribeLink(htmlUnsubscribeLink);
  if (!normalizedHtmlLink) return listUnsubscribeHeader;

  const headerLinks = parseListUnsubscribeHeader(listUnsubscribeHeader);
  if (headerLinks.includes(normalizedHtmlLink)) return listUnsubscribeHeader;

  return `${listUnsubscribeHeader}, <${normalizedHtmlLink}>`;
}
