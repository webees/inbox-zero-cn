import type { ProviderMailboxSearch } from "@/utils/email/types";
import { CALENDAR_INVITATION_LIMITS } from "@/utils/calendar/invitations/constants";
import { isSameCalendarInvitation } from "@/utils/calendar/invitations/content";
import { escapeSearchValue } from "@/utils/outlook/search-escape";
import PostalMime from "postal-mime";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import type {
  Message,
  Attachment as GraphAttachment,
} from "@microsoft/microsoft-graph-types";
import type { ParsedMessage, Attachment } from "@/utils/types";
import type { OutlookClient } from "@/utils/outlook/client";
import { OutlookLabel, WELL_KNOWN_FOLDERS } from "./constants";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import { withMicrosoftGraphRetry } from "@/utils/outlook/retry";
import { formatEmailWithName } from "@/utils/email";
import type { Logger } from "@/utils/logger";
import { isOutlookThrottlingError } from "@/utils/error";
import { isMicrosoftEmulationEnabled } from "@/utils/outlook/oauth";
import { resolveMicrosoftGraphNextLink } from "@/utils/outlook/page-token";

// 从 Microsoft Graph API 获取邮件时要选择的标准字段
// internetMessageId 是 RFC 5322 Message-ID 头，用于跨服务商的邮件会话关联
export const MESSAGE_LIST_SELECT_FIELDS =
  "id,conversationId,conversationIndex,internetMessageId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,createdDateTime,isDraft,isRead,flag,categories,parentFolderId,hasAttachments,webLink,inferenceClassification";
export const MESSAGE_SELECT_FIELDS = `${MESSAGE_LIST_SELECT_FIELDS},bccRecipients,body,internetMessageHeaders`;

// contentId 属于 fileAttachment，因此不加上这层类型转换就选择它
// 会导致 Graph 拒绝整个附件集合查询。
export const MESSAGE_EXPAND_ATTACHMENTS =
  "attachments($select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId)";

// Outlook 会在用户日历上保留邀请的自己的副本，并将邮件链接到它。
// 日历查询需要该 id 来同步 RSVP。类型转换将 expand 限定为
// 邀请，因此普通邮件不受影响。
const MESSAGE_EXPAND_LINKED_EVENT =
  "microsoft.graph.eventMessage/event($select=id)";

export async function getFolderIds(
  client: OutlookClient,
  logger: Logger,
  options: { includeDrafts?: boolean; signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  const includeDrafts = options.includeDrafts ?? true;
  const cachedFolderIds = client.getFolderIdCache();
  if (cachedFolderIds && (!includeDrafts || cachedFolderIds.drafts)) {
    return cachedFolderIds;
  }

  const folderEntries = Object.entries(WELL_KNOWN_FOLDERS).filter(
    ([key]) => includeDrafts || key !== "drafts",
  );

  const existingFolderIds = cachedFolderIds ?? {};
  const entriesToFetch = folderEntries.filter(
    ([key]) => !existingFolderIds[key],
  );

  if (entriesToFetch.length === 0) {
    return existingFolderIds;
  }

  const wellKnownFolders = await Promise.all(
    entriesToFetch.map(async ([key, folderName]) => {
      const response: { id?: string | null } = await withMicrosoftGraphRetry(
        () => {
          options.signal?.throwIfAborted();
          const request = client
            .getClient()
            .api(`/me/mailFolders/${folderName}`)
            .select("id");
          return (
            options.signal
              ? request.options({ signal: options.signal })
              : request
          ).get();
        },
        logger,
      ).catch((error) => {
        options.signal?.throwIfAborted();
        logWellKnownFolderFetchError(logger, folderName, error);
        return { id: null };
      });

      return [key, response.id ?? null] as [string, string | null];
    }),
  );

  const fetchedFolderIds = wellKnownFolders.reduce(
    (acc, [key, id]) => {
      if (id) acc[key] = id;
      return acc;
    },
    {} as Record<string, string>,
  );

  const mergedFolderIds = { ...existingFolderIds, ...fetchedFolderIds };
  client.setFolderIdCache(mergedFolderIds);

  return mergedFolderIds;
}

export async function getCategoryMap(
  client: OutlookClient,
  logger: Logger,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  signal?.throwIfAborted();
  const cachedMap = client.getCategoryMapCache();
  if (cachedMap) return cachedMap;

  try {
    const response: { value: Array<{ id?: string; displayName?: string }> } =
      await withMicrosoftGraphRetry(() => {
        signal?.throwIfAborted();
        const request = client.getClient().api("/me/outlook/masterCategories");
        return (signal ? request.options({ signal }) : request).get();
      }, logger);

    const categoryMap = new Map<string, string>();
    for (const category of response.value) {
      if (category.displayName && category.id) {
        categoryMap.set(category.displayName, category.id);
      }
    }

    client.setCategoryMapCache(categoryMap);
    return categoryMap;
  } catch (error) {
    signal?.throwIfAborted();
    logger.warn("获取类别映射失败", { error });
    return new Map();
  }
}

function getOutlookLabels(
  message: Message,
  folderIds: Record<string, string>,
  categoryMap?: Map<string, string>,
): string[] {
  const labels: string[] = [];

  // 检查邮件是否为草稿
  if (message.isDraft) {
    labels.push(OutlookLabel.DRAFT);
  }

  // 处理已读/未读状态 - Outlook 使用 isRead 属性，而不是标签
  // isRead 可以为 true、false 或 undefined/null
  if (message.isRead === false) {
    labels.push(OutlookLabel.UNREAD);
  }

  if (message.flag?.flagStatus === "flagged") {
    labels.push(OutlookLabel.STARRED);
  }

  // 将文件夹 ID 映射到标签
  if (message.parentFolderId) {
    const folderKey = Object.entries(folderIds).find(
      ([_, id]) => id === message.parentFolderId,
    )?.[0];

    if (folderKey) {
      const FOLDER_TO_LABEL_MAP = {
        [WELL_KNOWN_FOLDERS.inbox]: OutlookLabel.INBOX,
        [WELL_KNOWN_FOLDERS.sentitems]: OutlookLabel.SENT,
        [WELL_KNOWN_FOLDERS.drafts]: OutlookLabel.DRAFT,
        [WELL_KNOWN_FOLDERS.archive]: OutlookLabel.ARCHIVE,
        [WELL_KNOWN_FOLDERS.junkemail]: OutlookLabel.SPAM,
        [WELL_KNOWN_FOLDERS.deleteditems]: OutlookLabel.TRASH,
      };

      const label =
        FOLDER_TO_LABEL_MAP[folderKey as keyof typeof FOLDER_TO_LABEL_MAP];
      if (label) {
        labels.push(label);
      }
    }
  }

  // 添加类别标签 - 当类别映射可用时将名称映射为 ID
  if (message.categories) {
    for (const categoryName of message.categories) {
      const categoryId = categoryMap?.get(categoryName);
      labels.push(categoryId ?? categoryName);
    }
  }

  // 去除重复项
  return [...new Set(labels)];
}

const OUTLOOK_SEARCH_DISALLOWED_CHARS = /[?]/g;

// 用于检测 KQL 字段语法的模式：fieldname:value（例如 participants:email@example.com）
// 排除应被视为文本的 URL 方案（http、https、ftp、mailto、file）
const KQL_FIELD_PATTERN = /^(\w+):.+$/;
const KQL_FIELD_TOKEN_PATTERN = /\b(\w+):(?:"([^"]*)"|(\S+))/g;
const URL_SCHEME_PATTERN = /^(https?|ftp|mailto|file):/i;
const KQL_BOOLEAN_OPERATOR_PATTERN = /\b(?:AND|OR|NOT)\b/i;
const KQL_BOOLEAN_PATTERN = /\b(?:AND|OR|NOT)\b/gi;
const KQL_GROUPING_DETECTION_PATTERN = /[()]/;
const KQL_GROUPING_PATTERN = /[()]/g;
// 仅在将失败的 KQL 查询降级为自由文本回退时剥离，因为
// 比较过滤器和已读状态词会损害那里的关键词召回。
const OUTLOOK_COMPARISON_FILTER_PATTERN =
  /\b(?:received(?:DateTime)?|sent(?:DateTime)?)\s*(?:>=|<=|>|<)\s*\S+/gi;

/**
 * 清理用于 KQL 查询的值。
 * 移除不允许的字符并转义特殊字符。
 */
export function sanitizeKqlValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";

  return escapeSearchValue(
    normalized
      .replace(OUTLOOK_SEARCH_DISALLOWED_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * 清理 KQL 字段查询（例如 participants:email@example.com）。
 * 不会将整个查询包裹在外部引号中 - 仅当值包含空格时才加引号。
 */
export function sanitizeKqlFieldQuery(query: string): string {
  const colonIndex = query.indexOf(":");
  if (colonIndex === -1) return query;

  const field = query.slice(0, colonIndex);
  const value = query.slice(colonIndex + 1);

  if (!value) {
    return `${field}:`;
  }

  let sanitizedValue = value
    .replace(OUTLOOK_SEARCH_DISALLOWED_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hasSpaces = sanitizedValue.includes(" ");

  sanitizedValue = escapeSearchValue(sanitizedValue);

  if (hasSpaces) {
    return `${field}:"${sanitizedValue}"`;
  }

  return `${field}:${sanitizedValue}`;
}

/**
 * 清理用于 KQL 的常规文本查询。
 * 移除内部双引号并将整个查询包裹在外部引号中。
 */
export function sanitizeKqlTextQuery(query: string): string {
  let sanitized = query
    .replace(OUTLOOK_SEARCH_DISALLOWED_CHARS, " ")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  sanitized = sanitized.replace(/\\/g, "\\\\");

  return `"${sanitized}"`;
}

function sanitizeComplexKqlQueryAsText(query: string): string {
  const collapsedToText = collapseOutlookSearchQueryToText(query);

  return sanitizeKqlTextQuery(collapsedToText);
}

export function buildOutlookSearchFallbackQuery(query: string): string | null {
  const normalized = query.trim();
  if (!normalized) return null;

  const collapsedToText = collapseOutlookSearchQueryToText(normalized);
  if (!collapsedToText) return null;

  const fallbackQuery = sanitizeKqlTextQuery(collapsedToText);
  const currentQuery = sanitizeOutlookSearchQuery(normalized).sanitized;

  return fallbackQuery === currentQuery ? null : fallbackQuery;
}

function hasTrailingContentAfterQuotedFieldValue(value: string): boolean {
  if (!value.startsWith('"')) return false;

  const closingQuoteIndex = value.indexOf('"', 1);
  if (closingQuoteIndex === -1) return false;

  return value.slice(closingQuoteIndex + 1).trim().length > 0;
}

function isComplexKqlFieldQuery(query: string): boolean {
  const colonIndex = query.indexOf(":");
  if (colonIndex === -1) return false;

  const value = query.slice(colonIndex + 1).trim();
  if (!value) return false;

  if (KQL_BOOLEAN_OPERATOR_PATTERN.test(query)) return true;
  if (KQL_GROUPING_DETECTION_PATTERN.test(query)) return true;
  if (/\s+\w+:(?:"[^"]*"|\S+)/.test(value)) return true;

  return hasTrailingContentAfterQuotedFieldValue(value);
}

export function sanitizeOutlookSearchQuery(query: string): {
  sanitized: string;
  wasSanitized: boolean;
} {
  const normalized = query.trim();
  if (!normalized) {
    return { sanitized: "", wasSanitized: false };
  }

  // 检查这是否为 KQL 字段语法查询（例如 participants:email@example.com）
  // 但排除应被视为文本的 URL 方案
  if (
    KQL_FIELD_PATTERN.test(normalized) &&
    !URL_SCHEME_PATTERN.test(normalized)
  ) {
    if (isComplexKqlFieldQuery(normalized)) {
      return {
        sanitized: sanitizeComplexKqlQueryAsText(normalized),
        wasSanitized: true,
      };
    }

    return {
      sanitized: sanitizeKqlFieldQuery(normalized),
      wasSanitized: true,
    };
  }

  return {
    sanitized: sanitizeKqlTextQuery(normalized),
    wasSanitized: true,
  };
}

function collapseOutlookSearchQueryToText(query: string): string {
  return stripStandaloneOutlookStateTerms(query)
    .replace(
      KQL_FIELD_TOKEN_PATTERN,
      (_match, field: string, quotedValue?: string, bareValue?: string) => {
        const value = quotedValue ?? bareValue ?? "";
        if (
          /^(true|false)$/i.test(value) &&
          /^(hasattachments?|attachment|isread|read|unread)$/i.test(field)
        ) {
          return " ";
        }

        return ` ${value} `;
      },
    )
    .replace(OUTLOOK_COMPARISON_FILTER_PATTERN, " ")
    .replace(KQL_GROUPING_PATTERN, " ")
    .replace(KQL_BOOLEAN_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getOutlookComparisonFilters(query: string) {
  return Array.from(
    query.matchAll(OUTLOOK_COMPARISON_FILTER_PATTERN),
    (match) => match[0].trim(),
  );
}

export function stripOutlookComparisonFilters(query: string) {
  return query.replace(OUTLOOK_COMPARISON_FILTER_PATTERN, " ");
}

export function stripStandaloneOutlookStateTerms(query: string) {
  return splitOutlookQueryTerms(query)
    .filter((term) => {
      const normalized = term.replace(/^[()]+|[()]+$/g, "").toLowerCase();
      return normalized !== "read" && normalized !== "unread";
    })
    .join(" ");
}

export function getStandaloneOutlookStateTerms(query: string) {
  return splitOutlookQueryTerms(query)
    .map((term) => term.replace(/^[()]+|[()]+$/g, "").toLowerCase())
    .filter((term) => term === "read" || term === "unread");
}

function splitOutlookQueryTerms(query: string) {
  const terms: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        terms.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    terms.push(current);
  }

  return terms;
}

type OutlookMetadataFilters = {
  isRead?: boolean;
  starred?: boolean;
  hasAttachment?: boolean;
  categoryNames: string[];
};

function createOutlookMetadataFilters(options: {
  searchQuery?: string;
  readState?: "read" | "unread";
  categoryNames?: string[];
  starred?: boolean;
  hasAttachment?: boolean;
}): {
  filters: OutlookMetadataFilters;
  odataFilters: string[];
} {
  const stateTerms = getStandaloneOutlookStateTerms(options.searchQuery ?? "");
  const hasRead = stateTerms.includes("read");
  const hasUnread = stateTerms.includes("unread");
  const queryReadState =
    hasRead === hasUnread ? undefined : hasRead ? "read" : "unread";
  const readState = options.readState ?? queryReadState;
  const filters: OutlookMetadataFilters = {
    starred: options.starred,
    hasAttachment: options.hasAttachment,
    isRead:
      readState === "read" ? true : readState === "unread" ? false : undefined,
    categoryNames: [...new Set(options.categoryNames ?? [])],
  };

  return {
    filters,
    odataFilters: createOutlookMetadataODataFilters(filters),
  };
}

function matchesOutlookMetadataFilters(
  message: Message,
  filters: OutlookMetadataFilters,
) {
  if (
    typeof filters.isRead === "boolean" &&
    message.isRead !== filters.isRead
  ) {
    return false;
  }

  if (
    filters.starred !== undefined &&
    (message.flag?.flagStatus === "flagged") !== filters.starred
  )
    return false;
  if (
    filters.hasAttachment !== undefined &&
    Boolean(message.hasAttachments) !== filters.hasAttachment
  )
    return false;

  if (filters.categoryNames.length) {
    const messageCategories = new Set(message.categories ?? []);
    return filters.categoryNames.every((categoryName) =>
      messageCategories.has(categoryName),
    );
  }

  return true;
}

function matchesOutlookSender(message: Message, normalizedFromEmail: string) {
  return (
    message.from?.emailAddress?.address?.trim().toLowerCase() ===
    normalizedFromEmail
  );
}

function createOutlookMetadataODataFilters(filters: OutlookMetadataFilters) {
  const odataFilters: string[] = [];

  if (typeof filters.isRead === "boolean") {
    odataFilters.push(`isRead eq ${filters.isRead}`);
  }

  if (filters.starred !== undefined)
    odataFilters.push(
      `flag/flagStatus ${filters.starred ? "eq" : "ne"} 'flagged'`,
    );
  if (filters.hasAttachment !== undefined)
    odataFilters.push(`hasAttachments eq ${filters.hasAttachment}`);

  for (const categoryName of filters.categoryNames) {
    odataFilters.push(
      `categories/any(category: category eq '${escapeODataString(categoryName)}')`,
    );
  }

  return odataFilters;
}

export async function queryBatchMessages(
  client: OutlookClient,
  options: {
    searchQuery?: string; // Pure search query
    dateFilters?: string[]; // Array of OData date filters
    maxResults?: number;
    pageToken?: string;
    folderId?: string;
    fromEmail?: string;
    readState?: "read" | "unread";
    categoryNames?: string[];
    includeDrafts?: boolean;
    mailboxSearch?: ProviderMailboxSearch;
  },
  logger: Logger,
) {
  const { searchQuery, dateFilters, pageToken, folderId } = options;
  const normalizedFromEmail = options.fromEmail?.trim().toLowerCase();

  const MAX_RESULTS = 20;

  const maxResults = Math.min(options.maxResults || MAX_RESULTS, MAX_RESULTS);

  // 这对 Microsoft Graph API 成立，还是从 Gmail 复制粘贴过来的？
  if (options.maxResults && options.maxResults > MAX_RESULTS) {
    logger.warn(
      "Max results is greater than 20, which will cause rate limiting",
      {
        maxResults,
      },
    );
  }

  const [folderIds, categoryMap] = await Promise.all([
    getFolderIds(client, logger, {
      includeDrafts:
        Boolean(options.includeDrafts) || folderId?.toLowerCase() === "drafts",
    }),
    getCategoryMap(client, logger),
  ]);
  const parseMessages = (messages: Message[]) =>
    convertMessages(messages, folderIds, categoryMap, options.includeDrafts);
  // 邮件携带文件夹的不透明 id，因此像 "inbox" 这样的已知名称必须在比较前解析。
  const expectedParentFolderId = resolveFolderId(folderId, folderIds);

  let readState = options.readState;
  if (options.mailboxSearch?.read !== undefined) {
    readState = options.mailboxSearch.read ? "read" : "unread";
  }
  const metadataSearch = createOutlookMetadataFilters({
    searchQuery: options.mailboxSearch ? undefined : searchQuery,
    readState,
    categoryNames: options.categoryNames,
    starred:
      options.mailboxSearch?.starred ??
      (options.mailboxSearch?.mailbox === "starred" ? true : undefined),
    hasAttachment: options.mailboxSearch?.hasAttachment,
  });

  const nextLink = resolveMicrosoftGraphNextLink(pageToken);
  if (nextLink) {
    const response: { value: Message[]; "@odata.nextLink"?: string } =
      await withMicrosoftGraphRetry(
        () => client.getClient().api(nextLink).get(),
        logger,
      );

    const filteredMessages = response.value.filter((message) => {
      if (
        expectedParentFolderId &&
        message.parentFolderId !== expectedParentFolderId
      )
        return false;
      if (
        normalizedFromEmail &&
        !matchesOutlookSender(message, normalizedFromEmail)
      ) {
        return false;
      }
      return matchesOutlookMetadataFilters(message, metadataSearch.filters);
    });
    const isSearchPage = new URL(
      nextLink,
      "https://graph.microsoft.com",
    ).searchParams.has("$search");
    const messages = await parseMessages(
      isSearchPage
        ? await normalizeOutlookSearchIds(client, filteredMessages, logger)
        : filteredMessages,
    );

    return { messages, nextPageToken: response["@odata.nextLink"] };
  }

  const rawSearchQuery = options.mailboxSearch
    ? outlookMailboxText(options.mailboxSearch)
    : stripStandaloneOutlookStateTerms(searchQuery?.trim() || "").trim();
  const { sanitized: cleanedSearchQuery, wasSanitized } = options.mailboxSearch
    ? { sanitized: rawSearchQuery, wasSanitized: false }
    : sanitizeOutlookSearchQuery(rawSearchQuery);
  const effectiveSearchQuery = cleanedSearchQuery || undefined;

  logger.info("正在构建 Outlook 请求", {
    maxResults,
    hasSearchQuery: !!effectiveSearchQuery,
    hasDateFilters: !!(dateFilters && dateFilters.length > 0),
    pageToken,
    folderId,
    hasMetadataFilters: metadataSearch.odataFilters.length > 0,
    queryWasSanitized: wasSanitized,
  });

  // 构建基础请求
  let request = createMessagesRequest(client, folderId).top(maxResults);

  let nextPageToken: string | undefined;

  // 判断我们是有搜索查询还是纯过滤器
  const hasSearchQuery = !!effectiveSearchQuery;
  const hasDateFilters = !!(dateFilters && dateFilters.length > 0);

  // 仅在请求了特定 folderId 时应用文件夹过滤
  // API 默认已排除垃圾邮件/已删除邮件，草稿在 convertMessages 中过滤
  const folderFilter = folderId
    ? `parentFolderId eq '${escapeODataString(folderId)}'`
    : undefined;

  if (hasSearchQuery) {
    // 搜索路径 - 使用 $search 参数
    logger.info("使用搜索路径", {
      rawSearchQuery,
      effectiveSearchQuery,
      queryWasSanitized: wasSanitized,
      folderFilter,
      metadataFilters: metadataSearch.odataFilters,
    });

    request = request.search(
      options.mailboxSearch
        ? encodeURIComponent(effectiveSearchQuery!)
        : effectiveSearchQuery!,
    );

    const response: { value: Message[]; "@odata.nextLink"?: string } =
      await withMicrosoftGraphRetry(() => request.get(), logger);

    const filteredMessages = response.value.filter((message) => {
      if (
        expectedParentFolderId &&
        message.parentFolderId !== expectedParentFolderId
      )
        return false;
      if (
        normalizedFromEmail &&
        !matchesOutlookSender(message, normalizedFromEmail)
      ) {
        return false;
      }
      return matchesOutlookMetadataFilters(message, metadataSearch.filters);
    });
    const messages = await parseMessages(
      await normalizeOutlookSearchIds(client, filteredMessages, logger),
    );

    nextPageToken = response["@odata.nextLink"];

    logger.info("搜索结果", {
      totalFound: response.value.length,
      filteredByFolder: folderId ? filteredMessages.length : undefined,
      messageCount: messages.length,
      hasNextPageToken: !!nextPageToken,
    });

    return { messages, nextPageToken };
  } else {
    // 过滤路径 - 对日期过滤器或仅文件夹查询使用 $filter 参数
    const filters: string[] = [];

    if (metadataSearch.odataFilters.length) {
      filters.push(...metadataSearch.odataFilters);
    }

    if (options.fromEmail) {
      filters.push(
        `from/emailAddress/address eq '${escapeODataString(options.fromEmail)}'`,
      );
    }

    // 如果提供了日期过滤器则添加
    if (hasDateFilters) {
      filters.push(...dateFilters!);
    }

    const combinedFilter =
      filters.length > 0 ? filters.join(" and ") : undefined;

    logger.info("使用过滤路径", {
      folderFilter,
      metadataFilters: metadataSearch.odataFilters,
      dateFilters: dateFilters || [],
      hasSenderFilter: !!normalizedFromEmail,
    });

    // 仅当有内容需要过滤时才应用过滤器
    if (combinedFilter) {
      request = request.filter(combinedFilter);
    }

    // Graph 拒绝在发件人或元数据属性上同时使用 $orderby 与 $filter
    // （InefficientFilter），因此仅在这些不存在时才排序
    if (!metadataSearch.odataFilters.length && !options.fromEmail) {
      request = request.orderby("receivedDateTime DESC");
    }

    const response: { value: Message[]; "@odata.nextLink"?: string } =
      await withMicrosoftGraphRetry(() => request.get(), logger);
    const messages = await parseMessages(response.value);

    nextPageToken = response["@odata.nextLink"];

    logger.info("过滤结果", {
      messageCount: messages.length,
      hasNextPageToken: !!nextPageToken,
      hasSenderFilter: !!normalizedFromEmail,
    });

    return { messages, nextPageToken };
  }
}

export async function queryMessagesWithFilters(
  client: OutlookClient,
  options: {
    filters?: string[]; // OData filter expressions to AND together
    dateFilters?: string[]; // additional date filters like receivedDateTime gt/lt
    maxResults?: number;
    pageToken?: string;
    folderId?: string; // if omitted, defaults to inbox OR archive
  },
  logger: Logger,
) {
  const { filters = [], dateFilters = [], pageToken, folderId } = options;

  const MAX_RESULTS = 20;
  const maxResults = Math.min(options.maxResults || MAX_RESULTS, MAX_RESULTS);
  if (options.maxResults && options.maxResults > MAX_RESULTS) {
    logger.warn(
      "Max results is greater than 20, which will cause rate limiting",
      {
        maxResults: options.maxResults,
      },
    );
  }

  const [folderIds, categoryMap] = await Promise.all([
    getFolderIds(client, logger, { includeDrafts: false }),
    getCategoryMap(client, logger),
  ]);

  const nextLink = resolveMicrosoftGraphNextLink(pageToken);
  if (nextLink) {
    const response: { value: Message[]; "@odata.nextLink"?: string } =
      await withMicrosoftGraphRetry(
        () => client.getClient().api(nextLink).get(),
        logger,
      );

    const messages = await convertMessages(
      response.value,
      folderIds,
      categoryMap,
    );
    return { messages, nextPageToken: response["@odata.nextLink"] };
  }

  const inboxFolderId = folderIds.inbox;
  const archiveFolderId = folderIds.archive;

  // 构建基础请求
  let request = createMessagesRequest(client).top(maxResults);

  // 安全地构建文件夹过滤器（避免空 ID）
  let folderFilter: string | undefined;
  if (folderId) {
    folderFilter = `parentFolderId eq '${escapeODataString(folderId)}'`;
  } else {
    const folderClauses: string[] = [];
    if (inboxFolderId) {
      folderClauses.push(
        `parentFolderId eq '${escapeODataString(inboxFolderId)}'`,
      );
    }
    if (archiveFolderId) {
      folderClauses.push(
        `parentFolderId eq '${escapeODataString(archiveFolderId)}'`,
      );
    }
    if (folderClauses.length === 1) {
      folderFilter = folderClauses[0];
    } else if (folderClauses.length > 1) {
      folderFilter = `(${folderClauses.join(" or ")})`;
    } else {
      folderFilter = undefined; // omit folder clause entirely if none present
    }
  }

  const combinedFilters = [
    ...(folderFilter ? [folderFilter] : []),
    ...dateFilters,
    ...filters,
  ].filter(Boolean);
  const combinedFilter = combinedFilters.join(" and ");

  if (combinedFilter) {
    request = request.filter(combinedFilter);
  }

  const response: { value: Message[]; "@odata.nextLink"?: string } =
    await withMicrosoftGraphRetry(() => request.get(), logger);

  const messages = await convertMessages(
    response.value,
    folderIds,
    categoryMap,
  );

  return { messages, nextPageToken: response["@odata.nextLink"] };
}

async function convertMessages(
  messages: Message[],
  folderIds: Record<string, string>,
  categoryMap?: Map<string, string>,
  includeDrafts = false,
): Promise<ParsedMessage[]> {
  return messages
    .filter((message: Message) => includeDrafts || !message.isDraft)
    .map((message: Message) => convertMessage(message, folderIds, categoryMap));
}

export async function queryMessagesWithAttachments(
  client: OutlookClient,
  options: {
    maxResults?: number;
    pageToken?: string;
  },
  logger: Logger,
): Promise<{
  messages: ParsedMessage[];
  nextPageToken?: string;
}> {
  const MAX_RESULTS = 20;
  const maxResults = Math.min(options.maxResults || MAX_RESULTS, MAX_RESULTS);

  const categoryMap = await getCategoryMap(client, logger);

  const nextLink = resolveMicrosoftGraphNextLink(options.pageToken);
  if (nextLink) {
    const response: { value: Message[]; "@odata.nextLink"?: string } =
      await withMicrosoftGraphRetry(
        () => client.getClient().api(nextLink).get(),
        logger,
      );

    // 在内存中排序，以便所有页面的顺序一致
    const sortedMessages = response.value.sort((a, b) => {
      const dateA = new Date(a.receivedDateTime || 0).getTime();
      const dateB = new Date(b.receivedDateTime || 0).getTime();
      return dateB - dateA;
    });

    const messages = await convertMessages(sortedMessages, {}, categoryMap);
    return { messages, nextPageToken: response["@odata.nextLink"] };
  }

  // 构建带 hasAttachments 过滤器的请求
  // 注意：createMessagesRequest 已包含 .expand(MESSAGE_EXPAND_ATTACHMENTS)
  // 避免添加 .orderby() 以防止 "restriction or sort order is too complex" 错误
  const request = createMessagesRequest(client)
    .top(maxResults)
    .filter("hasAttachments eq true");

  const response: { value: Message[]; "@odata.nextLink"?: string } =
    await withMicrosoftGraphRetry(() => request.get(), logger);

  // 在内存中排序以避免 "restriction or sort order is too complex" 错误
  const sortedMessages = response.value.sort((a, b) => {
    const dateA = new Date(a.receivedDateTime || 0).getTime();
    const dateB = new Date(b.receivedDateTime || 0).getTime();
    return dateB - dateA;
  });

  const messages = await convertMessages(sortedMessages, {}, categoryMap);

  logger.info("已获取带附件的邮件", {
    messageCount: messages.length,
    hasNextPageToken: !!response["@odata.nextLink"],
  });

  return {
    messages,
    nextPageToken: response["@odata.nextLink"],
  };
}

export async function getMessage(
  messageId: string,
  client: OutlookClient,
  logger: Logger,
  options?: { includeCalendarContent?: boolean },
): Promise<ParsedMessage> {
  const message: Message & { event?: { id?: string } } =
    await withMicrosoftGraphRetry(
      () =>
        createMessageRequest(client, messageId, {
          includeLinkedCalendarEvent: options?.includeCalendarContent,
        }).get(),
      logger,
    );

  const [folderIds, categoryMap] = await Promise.all([
    getFolderIds(client, logger, { includeDrafts: false }),
    getCategoryMap(client, logger),
  ]);

  const parsed = convertMessage(message, folderIds, categoryMap, logger);
  if (options?.includeCalendarContent && parsed.isMeetingInvitation) {
    try {
      const raw: string = await withMicrosoftGraphRetry(
        () =>
          client
            .getClient()
            .api(`/me/messages/${encodeURIComponent(messageId)}/$value`)
            .responseType(ResponseType.TEXT)
            .get(),
        logger,
      );
      if (raw.length <= 2_000_000) {
        const mime = await PostalMime.parse(raw, {
          attachmentEncoding: "utf8",
        });
        const calendars = mime.attachments.filter(
          (attachment) =>
            attachment.mimeType === "text/calendar" ||
            attachment.mimeType === "application/ics",
        );
        const contents = calendars.map((attachment) =>
          String(attachment.content),
        );
        const content = contents[0];
        if (
          calendars.length > CALENDAR_INVITATION_LIMITS.attachments ||
          contents.some(
            (candidate) =>
              candidate.length > CALENDAR_INVITATION_LIMITS.content ||
              !isSameCalendarInvitation(candidate, content),
          )
        ) {
          parsed.isMeetingInvitation = false;
        } else if (content !== undefined) {
          parsed.calendarContent = content;
        }
      }
    } catch (error) {
      logger.warn("读取日历 MIME 内容失败；改用附件", {
        error,
      });
    }
    if (parsed.isMeetingInvitation) parsed.calendarEventId = message.event?.id;
  }
  return parsed;
}

export async function getMessages(
  client: OutlookClient,
  options: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
  },
  logger: Logger,
) {
  const top = options.maxResults || 20;
  let request = createMessagesRequest(client).top(top);

  if (options.query) {
    request = request.filter(
      `contains(subject, '${escapeODataString(options.query)}')`,
    );
  }

  const response: { value: Message[]; "@odata.nextLink"?: string } =
    await withMicrosoftGraphRetry(() => request.get(), logger);

  const [folderIds, categoryMap] = await Promise.all([
    getFolderIds(client, logger, { includeDrafts: false }),
    getCategoryMap(client, logger),
  ]);
  const messages = await convertMessages(
    response.value,
    folderIds,
    categoryMap,
  );

  return {
    messages,
    nextPageToken: response["@odata.nextLink"],
  };
}

/**
 * 用于创建选取标准字段的多封邮件获取请求的辅助函数。
 * 返回一个类型化的请求构建器，可链式调用 .filter()、.top() 等。
 */
export function createMessagesRequest(
  client: OutlookClient,
  folderId?: string,
) {
  return client
    .getClient()
    .api(
      folderId
        ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages`
        : "/me/messages",
    )
    .select(MESSAGE_SELECT_FIELDS)
    .expand(MESSAGE_EXPAND_ATTACHMENTS);
}

/**
 * 用于创建选取标准字段的单封邮件获取请求的辅助函数。
 */
export function createMessageRequest(
  client: OutlookClient,
  messageId: string,
  options?: { includeLinkedCalendarEvent?: boolean },
) {
  return client
    .getClient()
    .api(`/me/messages/${messageId}`)
    .select(MESSAGE_SELECT_FIELDS)
    .expand(
      options?.includeLinkedCalendarEvent
        ? [MESSAGE_EXPAND_ATTACHMENTS, MESSAGE_EXPAND_LINKED_EVENT]
        : MESSAGE_EXPAND_ATTACHMENTS,
    );
}

/**
 * 将 Outlook 邮件收件人数组转换为逗号分隔的字符串
 * 格式："Name1 <email1@example.com>, Name2 <email2@example.com>"
 */
function formatRecipientsList(
  recipients:
    | Array<{
        emailAddress?: { name?: string | null; address?: string | null } | null;
      }>
    | null
    | undefined,
): string | undefined {
  if (!recipients || recipients.length === 0) return;

  const formatted = recipients
    .map((recipient) =>
      formatEmailWithName(
        recipient.emailAddress?.name,
        recipient.emailAddress?.address,
      ),
    )
    .filter(Boolean)
    .join(", ");

  return formatted || undefined;
}

export function convertMessage(
  message: Message,
  folderIds: Record<string, string> = {},
  categoryMap?: Map<string, string>,
  logger?: Logger,
): ParsedMessage {
  const bodyContent = message.body?.content || "";
  const bodyType = message.body?.contentType?.toLowerCase() as
    | "text"
    | "html"
    | undefined;

  const labelIds = getOutlookLabels(message, folderIds, categoryMap);
  const date =
    message.receivedDateTime ||
    message.createdDateTime ||
    new Date().toISOString();

  logger?.trace("Converting Outlook message", () => ({
    messageId: message.id,
    subject: message.subject,
    isDraft: message.isDraft,
    parentFolderId: message.parentFolderId,
    folderIds,
    labelIds,
  }));

  return {
    isMeetingInvitation:
      "@odata.type" in message &&
      message["@odata.type"] === "#microsoft.graph.eventMessageRequest"
        ? true
        : undefined,
    id: message.id || "",
    threadId: message.conversationId || "",
    externalUrl: message.webLink || undefined,
    snippet: message.bodyPreview || "",
    textPlain: bodyType === "text" ? bodyContent : undefined,
    textHtml: bodyType === "html" ? bodyContent : undefined,
    bodyContentType: bodyType,
    headers: {
      from:
        formatEmailWithName(
          message.from?.emailAddress?.name,
          message.from?.emailAddress?.address,
        ) || "",
      to: formatRecipientsList(message.toRecipients) || "",
      cc: formatRecipientsList(message.ccRecipients),
      bcc: formatRecipientsList(message.bccRecipients),
      subject: message.subject || "",
      date,
      // RFC 5322 Message-ID 头，用于跨服务商的邮件会话关联（例如 Outlook -> Gmail）
      "message-id": message.internetMessageId || "",
      "in-reply-to": getInternetHeader(message, "in-reply-to") ?? undefined,
      "list-unsubscribe":
        getInternetHeader(message, "list-unsubscribe") ?? undefined,
      "list-unsubscribe-post":
        getInternetHeader(message, "list-unsubscribe-post") ?? undefined,
    },
    subject: message.subject || "",
    date,
    labelIds,
    inboxSection: normalizeInboxSection(message.inferenceClassification),
    parentFolderId: message.parentFolderId || undefined,
    internalDate: date,
    historyId: "",
    inline: convertInlineAttachments(message.attachments),
    attachments: convertAttachments(message.attachments),
    hasAttachment: message.hasAttachments ?? undefined,
    conversationIndex: message.conversationIndex,
    rawRecipients: {
      from: message.from,
      toRecipients: message.toRecipients,
      ccRecipients: message.ccRecipients,
    },
  };
}

function normalizeInboxSection(value: unknown): ParsedMessage["inboxSection"] {
  return value === "focused" || value === "other" ? value : null;
}

function convertAttachments(
  graphAttachments: GraphAttachment[] | undefined | null,
): Attachment[] | undefined {
  if (!graphAttachments || graphAttachments.length === 0) {
    return;
  }

  return graphAttachments
    .filter((attachment) => !attachment.isInline)
    .map((attachment) => ({
      filename: attachment.name || "",
      mimeType: attachment.contentType || "application/octet-stream",
      size: attachment.size || 0,
      attachmentId: attachment.id || "",
      headers: {
        "content-type": attachment.contentType || "",
        "content-description": "",
        "content-transfer-encoding": "",
        "content-id": "",
      },
    }));
}

function convertInlineAttachments(
  graphAttachments: GraphAttachment[] | undefined | null,
): ParsedMessage["inline"] {
  if (!graphAttachments) return [];

  return graphAttachments
    .filter((attachment) => attachment.isInline)
    .map((attachment) => {
      const contentId =
        ("contentId" in attachment && typeof attachment.contentId === "string"
          ? attachment.contentId
          : undefined) || "";

      return {
        filename: attachment.name || "",
        mimeType: attachment.contentType || "application/octet-stream",
        size: attachment.size || 0,
        attachmentId: attachment.id || "",
        headers: {
          "content-type": attachment.contentType || "",
          "content-description": "",
          "content-transfer-encoding": "",
          "content-id": contentId,
        },
      };
    });
}

function logWellKnownFolderFetchError(
  logger: Logger,
  folderName: string,
  error: unknown,
) {
  const log = isOutlookThrottlingError(error) ? logger.info : logger.warn;
  log("Failed to get well-known folder", {
    folderName,
    error,
  });
}

function getInternetHeader(message: Message, name: string) {
  return (
    message.internetMessageHeaders?.find(
      (header) => header.name?.toLowerCase() === name,
    )?.value ?? undefined
  );
}

/** Maps a well-known folder name (`inbox`, `sentitems`, ...) to its id. Other ids pass through. */
function resolveFolderId(
  folderId: string | undefined,
  folderIds: Record<string, string>,
): string | undefined {
  if (!folderId) return;
  return folderIds[folderId.toLowerCase()] ?? folderId;
}

function outlookMailboxText(search: ProviderMailboxSearch): string {
  if (!search.text) return "";
  const terms =
    search.text.match === "phrase"
      ? [search.text.value]
      : search.text.value.trim().split(/\s+/).filter(Boolean);
  if (!terms.some((term) => term.trim())) return "";
  const expression = terms
    .map((term) => {
      const literal = `"${escapeSearchValue(term)}"`;
      return search.text?.field === "any"
        ? literal
        : `${search.text?.field}:${literal}`;
    })
    .join(" AND ");
  return JSON.stringify(expression);
}

async function normalizeOutlookSearchIds(
  client: OutlookClient,
  messages: Message[],
  logger: Logger,
): Promise<Message[]> {
  const inputIds = [
    ...new Set(messages.flatMap((message) => (message.id ? [message.id] : []))),
  ];
  if (!inputIds.length) return messages;

  // 模拟器已使用稳定的 ID，且不实现 Exchange ID 转换。
  if (isMicrosoftEmulationEnabled()) return messages;

  // 尽管有 ImmutableId 首选项，Graph 的 $search 仍可能返回依赖文件夹的 REST ID。
  const response: { value: { sourceId: string; targetId?: string }[] } =
    await withMicrosoftGraphRetry(
      () =>
        client.getClient().api("/me/translateExchangeIds").post({
          inputIds,
          sourceIdType: "restId",
          targetIdType: "restImmutableEntryId",
        }),
      logger,
    );
  const ids = new Map(
    response.value.map((item) => [item.sourceId, item.targetId]),
  );
  const unresolvedIds = inputIds.filter((id) => !ids.get(id));
  if (unresolvedIds.length) {
    logger.warn("部分 Outlook 搜索邮件无法解析", {
      unresolvedCount: unresolvedIds.length,
      messageCount: messages.length,
    });
    logger.trace("Unresolved Outlook search message IDs", {
      messageIds: unresolvedIds,
    });
  }
  return messages.flatMap((message) => {
    const id = message.id ? ids.get(message.id) : null;
    return id ? [{ ...message, id }] : [];
  });
}
