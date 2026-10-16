import { SafeError } from "@/utils/error";
import type { EmailProvider } from "@/utils/email/types";
import { GmailLabel } from "@/utils/gmail/label";
import { isOutlookInboxSection } from "@/utils/outlook/inbox-sections";
import {
  mailSplitToThreadsQuery,
  type MailSplit,
} from "@/utils/split-inbox/split-query";
import { flattenOutlookFolders } from "@/utils/outlook/folders";
import prisma from "@/utils/prisma";
import {
  getRuleLabel,
  STANDARD_CATEGORY_SYSTEM_TYPES,
} from "@/utils/rule/consts";
import { SystemType } from "@/generated/prisma/enums";
import type { ThreadsQuery } from "@/utils/threads/validation";

const GMAIL_CATEGORIES = [
  { name: "个人", type: GmailLabel.PERSONAL },
  { name: "社交", type: GmailLabel.SOCIAL },
  { name: "更新", type: GmailLabel.UPDATES },
  { name: "论坛", type: GmailLabel.FORUMS },
  { name: "促销", type: GmailLabel.PROMOTIONS },
] as const;

const MAILBOX_TYPES = new Set([
  "inbox",
  "sent",
  "draft",
  "trash",
  "spam",
  "starred",
  "unread",
  "archive",
  "all",
  "snoozed",
  "label",
  "folder",
  "scheduled",
]);

const GMAIL_CATEGORY_BY_ALIAS: Record<string, string> = {
  personal: GmailLabel.PERSONAL,
  social: GmailLabel.SOCIAL,
  updates: GmailLabel.UPDATES,
  forums: GmailLabel.FORUMS,
  promotions: GmailLabel.PROMOTIONS,
};

const LABEL_NAME_BY_ALIAS: Record<string, string> = {};
for (const systemType of STANDARD_CATEGORY_SYSTEM_TYPES) {
  const label = getRuleLabel(systemType);
  const key = normalizeCategoryKey(label);
  LABEL_NAME_BY_ALIAS[key] = label;
  LABEL_NAME_BY_ALIAS[`${key}s`] = label;
}

/**
 * 本地化之前用过的英文类别别名。
 * 旧链接、旧前端状态里仍可能出现这些值，解析时把它们映射回当前的中文标签名。
 */
const LEGACY_LABEL_ALIASES: Array<{ alias: string; systemType: SystemType }> = [
  { alias: "to reply", systemType: SystemType.TO_REPLY },
  { alias: "awaiting reply", systemType: SystemType.AWAITING_REPLY },
  { alias: "fyi", systemType: SystemType.FYI },
  { alias: "actioned", systemType: SystemType.ACTIONED },
  { alias: "newsletter", systemType: SystemType.NEWSLETTER },
  { alias: "newsletters", systemType: SystemType.NEWSLETTER },
  { alias: "marketing", systemType: SystemType.MARKETING },
  { alias: "calendar", systemType: SystemType.CALENDAR },
  { alias: "receipt", systemType: SystemType.RECEIPT },
  { alias: "receipts", systemType: SystemType.RECEIPT },
  { alias: "notification", systemType: SystemType.NOTIFICATION },
  { alias: "notifications", systemType: SystemType.NOTIFICATION },
  { alias: "otp", systemType: SystemType.OTP },
  { alias: "cold email", systemType: SystemType.COLD_EMAIL },
];

for (const { alias, systemType } of LEGACY_LABEL_ALIASES) {
  LABEL_NAME_BY_ALIAS[normalizeCategoryKey(alias)] = getRuleLabel(systemType);
}

export type NativeMailCategory = {
  name: string;
  type: string;
  inboxSection: "focused" | "other" | null;
  labelId: string | null;
  folderId: string | null;
};

export function gmailCategoryIdFor(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("CATEGORY_")) return trimmed;
  return GMAIL_CATEGORY_BY_ALIAS[normalizeCategoryKey(trimmed)] ?? null;
}

export function labelNameForCategory(value: string) {
  return LABEL_NAME_BY_ALIAS[normalizeCategoryKey(value)] ?? null;
}

export function isNativeCategoryAlias(value: string) {
  return Boolean(gmailCategoryIdFor(value) || labelNameForCategory(value));
}

export async function listNativeMailSplits({
  emailAccountId,
  emailProvider,
}: {
  emailAccountId: string;
  emailProvider: EmailProvider;
}) {
  const [storedSplits, labels] = await Promise.all([
    prisma.mailSplit.findMany({
      where: { emailAccountId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        order: true,
        matchAll: true,
        filters: {
          orderBy: { order: "asc" },
          select: { kind: true, value: true },
        },
      },
    }),
    emailProvider.getLabels(),
  ]);
  const folders =
    emailProvider.name === "microsoft"
      ? flattenOutlookFolders(await emailProvider.getFolders())
      : [];

  const categories: NativeMailCategory[] = [];
  if (emailProvider.name === "google") {
    for (const category of GMAIL_CATEGORIES) {
      categories.push({
        name: category.name,
        type: category.type,
        inboxSection: null,
        labelId: null,
        folderId: null,
      });
    }
  } else if (emailProvider.name === "microsoft") {
    categories.push(
      {
        name: "重点",
        type: "inbox",
        inboxSection: "focused",
        labelId: null,
        folderId: null,
      },
      {
        name: "其他",
        type: "inbox",
        inboxSection: "other",
        labelId: null,
        folderId: null,
      },
    );
  }

  for (const systemType of STANDARD_CATEGORY_SYSTEM_TYPES) {
    const labelName = getRuleLabel(systemType);
    const label = labels.find(
      (item) =>
        normalizeCategoryKey(item.name) === normalizeCategoryKey(labelName),
    );
    const folder = folders.find(
      (item) =>
        normalizeCategoryKey(item.displayName) ===
        normalizeCategoryKey(labelName),
    );
    categories.push({
      name: labelName,
      type: label?.id ?? folder?.id ?? labelName,
      inboxSection: null,
      labelId: label?.id ?? null,
      folderId: folder?.id ?? null,
    });
  }

  return {
    categories,
    splits: storedSplits.map((split) => ({
      id: split.id,
      name: split.name,
      order: split.order,
      matchAll: split.matchAll,
      filters: split.filters,
    })),
  };
}

export async function resolveNativeThreadsQuery({
  emailAccountId,
  emailProvider,
  query,
}: {
  emailAccountId: string;
  emailProvider: EmailProvider;
  query: ThreadsQuery;
}): Promise<ThreadsQuery> {
  const category =
    query.category ??
    (query.type &&
    !MAILBOX_TYPES.has(query.type) &&
    !query.type.startsWith("CATEGORY_") &&
    isNativeCategoryAlias(query.type)
      ? query.type
      : null);
  const splitId = query.splitId;
  if (!category && !splitId) {
    const { category: _category, splitId: _splitId, ...rest } = query;
    return rest;
  }

  const { limit, nextPageToken, q } = query;
  const page = { limit, nextPageToken, q };

  if (splitId) {
    const split = await findSplit(emailAccountId, { id: splitId });
    if (!split) throw new SafeError("Unknown split", 404);
    return { ...mailSplitToThreadsQuery(toQuerySplit(split)), ...page };
  }

  if (!category) {
    const { category: _category, splitId: _splitId, ...rest } = query;
    return rest;
  }

  if (isOutlookInboxSection(category)) {
    return { ...page, type: "inbox", inboxSection: category };
  }

  const gmailCategory = gmailCategoryIdFor(category);
  if (gmailCategory) return { ...page, type: gmailCategory };

  const namedSplit = await findSplit(emailAccountId, { name: category });
  if (namedSplit) {
    return { ...mailSplitToThreadsQuery(toQuerySplit(namedSplit)), ...page };
  }

  const labelName = labelNameForCategory(category) ?? category;
  if (emailProvider.name === "microsoft") {
    const folder = flattenOutlookFolders(await emailProvider.getFolders()).find(
      (item) =>
        item.id === category ||
        normalizeCategoryKey(item.displayName) ===
          normalizeCategoryKey(labelName),
    );
    if (folder) return { ...page, folderId: folder.id, type: "folder" };
  }

  const labels = await emailProvider.getLabels();
  const label = labels.find(
    (item) =>
      item.id === category ||
      normalizeCategoryKey(item.name) === normalizeCategoryKey(labelName) ||
      normalizeCategoryKey(item.name) === normalizeCategoryKey(category),
  );
  if (label) return { ...page, labelIds: ["INBOX", label.id] };

  throw new SafeError("未知的收件箱类别", 400);
}

async function findSplit(
  emailAccountId: string,
  target: { id: string } | { name: string },
) {
  return prisma.mailSplit.findFirst({
    where: {
      emailAccountId,
      ...("id" in target
        ? { id: target.id }
        : { name: { equals: target.name, mode: "insensitive" } }),
    },
    select: {
      id: true,
      name: true,
      matchAll: true,
      filters: {
        orderBy: { order: "asc" },
        select: { kind: true, value: true },
      },
    },
  });
}

function toQuerySplit(
  split: Awaited<ReturnType<typeof findSplit>> & object,
): MailSplit {
  return {
    id: split.id,
    name: split.name,
    matchAll: split.matchAll,
    filters: split.filters.map((filter) => ({
      kind: filter.kind,
      value: filter.value,
    })),
  };
}

function normalizeCategoryKey(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
