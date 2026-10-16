import type { ProviderMailboxSearch } from "@/utils/email/types";
import type { LocalMailSyncRequest } from "@/utils/actions/local-mail-sync.validation";
import type { LocalMailSyncResponse } from "@/utils/email/local-mail-sync-types";
import {
  getOutlookMailFoldersPage,
  getOutlookMailFolderChangesPage,
  getOutlookMailBackfillPage,
  getOutlookLocalMailMessage,
  resolveOutlookLocalMailFolderIds,
} from "@/utils/outlook/local-mail-sync";
import { matchesSenderFilter } from "@/utils/split-inbox/sender-filter";
import { DraftNotFoundError } from "@/utils/error";
import type { Message } from "@microsoft/microsoft-graph-types";
import type { OutlookClient } from "@/utils/outlook/client";
import type { ParsedMessage } from "@/utils/types";
import type { Attachment as MailAttachment } from "nodemailer/lib/mailer";
import { toMailerAttachments } from "@/utils/types/mail";
import {
  getMessage,
  getMessages,
  queryBatchMessages,
  queryMessagesWithAttachments,
  getCategoryMap,
  getFolderIds,
  convertMessage,
  MESSAGE_LIST_SELECT_FIELDS,
  MESSAGE_SELECT_FIELDS,
  sanitizeKqlValue,
} from "@/utils/outlook/message";
import {
  getLabels,
  getLabel,
  createLabel,
  getOrCreateInboxZeroLabel,
  getLabelById,
  renameCategoryOnMessages,
  OUTLOOK_COLOR_MAP,
} from "@/utils/outlook/label";
import { sanitizeOutlookCategoryName } from "@/utils/outlook/label-validation";
import type { InboxZeroLabel } from "@/utils/label";
import type { ThreadsQuery } from "@/utils/threads/validation";
import {
  compileOutlookThreadSearch,
  isEmptyOutlookSearch,
  type CompiledOutlookSearch,
} from "@/utils/outlook/thread-search-query";
import { getLatestNonDraftMessage } from "@/utils/email/latest-message";
import { getMessageTimestamp } from "@/utils/email/message-timestamp";
import {
  draftEmail,
  forwardEmail,
  replyToEmail,
  sendEmailWithPlainText,
  sendEmailWithHtml,
} from "@/utils/outlook/mail";
import {
  archiveThread,
  markReadThread,
  markStarredMessage,
  removeThreadLabel,
  unarchiveThread,
  untrashThread,
  updateMessageCategories,
} from "@/utils/outlook/label";
import { trashThread } from "@/utils/outlook/trash";
import { markNotSpam, markSpam } from "@/utils/outlook/spam";
import { handlePreviousDraftDeletion } from "@/utils/ai/choose-rule/draft-management";
import { type Logger, createScopedLogger } from "@/utils/logger";
import {
  getThreadMessages,
  getThreadsFromSenderWithSubject,
} from "@/utils/outlook/thread";
import {
  getOutlookAttachment,
  getOutlookAttachmentStream,
} from "@/utils/outlook/attachment";
import {
  getDraft,
  getDraftReference,
  deleteDraft,
  sendDraft,
} from "@/utils/outlook/draft";
import {
  getFiltersList,
  createFilter,
  deleteFilter,
  createAutoArchiveFilter,
} from "@/utils/outlook/filter";
import { queryMessagesWithFilters } from "@/utils/outlook/message";
import { resolveMicrosoftGraphNextLink } from "@/utils/outlook/page-token";
import type {
  EmailProvider,
  EmailThread,
  EmailLabel,
  EmailFilter,
  EmailSignature,
  EmailFolderCount,
  SentMessagePage,
  BulkArchiveThread,
  BulkArchiveResult,
  EmailLabelUpdate,
  GetThreadOptions,
  SendEmailOptions,
  DraftAttachmentUploadStart,
} from "@/utils/email/types";
import type { SendAsAddress } from "@/utils/email/send-as";
import type { DraftAttachmentMetadata } from "@/utils/actions/draft-attachments.validation";
import { assertDraftAttachmentLimits } from "@/utils/email/draft-attachment-upload";
import {
  addOutlookDraftAttachment,
  createOutlookDraftAttachmentUploadSession,
  listOutlookDraftAttachments,
  removeOutlookDraftAttachment,
} from "@/utils/outlook/draft-attachments";
import type { SendEmailBody } from "@/utils/types/mail";
import { getOutlookCategoryPreset } from "@/utils/outlook/category-colors";
import { unwatchOutlook, watchOutlook } from "@/utils/outlook/watch";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import { OutlookLabel } from "@/utils/outlook/constants";
import { resolveOutlookCategoryName } from "@/utils/outlook/search-scope";
import {
  extractEmailAddress,
  getSearchTermForSender,
  splitRecipientList,
} from "@/utils/email";
import {
  getOrCreateOutlookFolderIdByName,
  getOutlookFolderTree,
  flattenOutlookFolders,
  addOutlookSystemFolderTypes,
  deleteOutlookFolder,
  renameOutlookFolder,
} from "@/utils/outlook/folders";
import { extractSignatureFromHtml } from "@/utils/email/signature-extraction";
import {
  getThreadParticipantMessagesInBatches,
  moveMessagesForSenders,
  moveThreadsInBatches,
} from "@/utils/outlook/batch";
import {
  extractErrorInfo,
  isRetryableError,
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";
import { isMicrosoftEmulationEnabled } from "@/utils/outlook/oauth";
import { shouldSkipAutoDraft } from "@/utils/auto-draft";
import { getOutlookMailboxSyncPage } from "@/utils/outlook/mailbox-sync";
import { requireSentMessageId } from "@/utils/email/sent-message-id";
import { searchContacts } from "@/utils/outlook/contact";
import { mapWithConcurrency } from "@/utils/async";

export class OutlookProvider implements EmailProvider {
  readonly name = "microsoft";
  readonly localMailSyncStrategy = "folder-delta";
  private readonly client: OutlookClient;
  private readonly logger: Logger;

  constructor(client: OutlookClient, logger?: Logger) {
    this.client = client;
    this.logger = (logger || createScopedLogger("outlook-provider")).with({
      provider: "microsoft",
    });
  }

  toJSON() {
    return { name: this.name, type: "OutlookProvider" };
  }

  async countMessages({
    folderId,
    labelId,
  }: {
    folderId?: string;
    labelId?: string;
  }): Promise<number> {
    const categoryName = await resolveOutlookCategoryName({
      emailProvider: this,
      categoryName: labelId,
    });
    const response = await withMicrosoftGraphRetry(() => {
      let request = this.client
        .getClient()
        .api(
          folderId
            ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages`
            : "/me/messages",
        )
        .count(true)
        .select("id")
        .top(1);
      if (categoryName) {
        request = request.filter(
          `categories/any(c:c eq '${escapeODataString(categoryName)}')`,
        );
      }
      return request.get();
    }, this.logger);

    const count = response["@odata.count"];
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error("Outlook 未返回准确的邮件数量");
    }
    return count;
  }

  async getThreads(folderId?: string): Promise<EmailThread[]> {
    const messages = await this.getMessages({ folderId });
    const threadMap = new Map<string, ParsedMessage[]>();

    messages.forEach((message) => {
      const threadId = message.threadId;
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(message);
    });

    return Array.from(threadMap.entries()).map(([id, messages]) => ({
      id,
      messages,
      snippet: messages[0]?.snippet || "",
    }));
  }

  async getThread(
    threadId: string,
    options?: GetThreadOptions,
  ): Promise<EmailThread> {
    try {
      const messages = await getThreadMessages(
        threadId,
        this.client,
        this.logger,
        options,
      );

      return {
        id: threadId,
        messages,
        snippet: messages.at(-1)?.snippet || "",
      };
    } catch (error) {
      const context = {
        threadId,
        error,
        // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
        errorCode: (error as any)?.code,
      };
      if (isRetryableError(extractErrorInfo(error)).isRateLimit) {
        this.logger.warn("getThread 失败", context);
      } else {
        this.logger.error("getThread 失败", context);
      }
      throw error;
    }
  }

  async getLabels(_options?: {
    includeHidden?: boolean;
  }): Promise<EmailLabel[]> {
    const labels = await getLabels(this.client);
    return labels.map((label) => ({
      id: label.id || "",
      name: label.displayName || "",
      type: "user",
      color: mapOutlookPresetColor(label.color),
    }));
  }

  async getLabelById(labelId: string): Promise<EmailLabel | null> {
    const labels = await this.getLabels();
    return labels.find((label) => label.id === labelId) || null;
  }

  async getLabelByName(name: string): Promise<EmailLabel | null> {
    const category = await getLabel({ client: this.client, name });
    if (!category) return null;
    return {
      id: category.id || "",
      name: category.displayName || "",
      type: "user",
      color: mapOutlookPresetColor(category.color),
    };
  }

  private async resolveCategoryWithFallback(
    labelId: string,
    labelName: string | null,
  ): Promise<{ category: EmailLabel | null; usedFallback: boolean }> {
    let category = await this.getLabelById(labelId);
    let usedFallback = false;

    if (!category && labelName) {
      this.logger.warn("按 ID 未找到类别，尝试按名称", {
        labelId,
        labelName,
      });
      category = await this.getLabelByName(labelName);
      usedFallback = true;
    }

    return { category, usedFallback };
  }

  async getMessage(
    messageId: string,
    options?: { includeCalendarContent?: boolean },
  ): Promise<ParsedMessage> {
    return getMessage(messageId, this.client, this.logger, options);
  }

  async getMessageByRfc822MessageId(
    rfc822MessageId: string,
  ): Promise<ParsedMessage | null> {
    const cleanMessageId = rfc822MessageId.trim().replace(/^<|>$/g, "");
    const messageIdWithBrackets = `<${cleanMessageId}>`;

    const response = await this.client
      .getClient()
      .api("/me/messages")
      .filter(
        `internetMessageId eq '${escapeODataString(messageIdWithBrackets)}'`,
      )
      .top(1)
      .get();

    const message = response.value?.[0];
    if (!message) {
      return null;
    }

    const folderIds = await getFolderIds(this.client, this.logger, {
      includeDrafts: false,
    });
    return convertMessage(message, folderIds);
  }

  private async getMessages({
    searchQuery,
    maxResults = 50,
    folderId,
  }: {
    searchQuery?: string;
    folderId?: string;
    maxResults?: number;
  }): Promise<ParsedMessage[]> {
    const allMessages: ParsedMessage[] = [];
    let pageToken: string | undefined;
    const pageSize = 20; // Outlook API limit

    while (allMessages.length < maxResults) {
      const response = await queryBatchMessages(
        this.client,
        {
          searchQuery,
          folderId,
          maxResults: Math.min(pageSize, maxResults - allMessages.length),
          pageToken,
        },
        this.logger,
      );

      const messages = response.messages || [];
      allMessages.push(...messages);

      // 如果获取的邮件少于请求数量，说明已到达末尾
      if (messages.length < pageSize || !response.nextPageToken) {
        break;
      }

      pageToken = response.nextPageToken;
    }

    return allMessages;
  }

  async getSentMessages(maxResults = 20): Promise<ParsedMessage[]> {
    const folderIds = await getFolderIds(this.client, this.logger, {
      includeDrafts: false,
    });

    const response: { value: Message[] } = await withMicrosoftGraphRetry(
      () =>
        this.client
          .getClient()
          .api("/me/mailFolders/sentitems/messages")
          .select(MESSAGE_SELECT_FIELDS)
          .top(maxResults)
          .orderby("sentDateTime desc")
          .get(),
      this.logger,
    );

    return (response.value || [])
      .filter((message: Message) => !message.isDraft)
      .map((message: Message) => convertMessage(message, folderIds));
  }

  async getInboxMessages(maxResults = 20): Promise<ParsedMessage[]> {
    const folderIds = await getFolderIds(this.client, this.logger, {
      includeDrafts: false,
    });

    const response: { value: Message[] } = await withMicrosoftGraphRetry(
      () =>
        this.client
          .getClient()
          .api("/me/mailFolders/inbox/messages")
          .select(MESSAGE_SELECT_FIELDS)
          .top(maxResults)
          .orderby("receivedDateTime desc")
          .get(),
      this.logger,
    );

    return (response.value || [])
      .filter((message: Message) => !message.isDraft)
      .map((message: Message) => convertMessage(message, folderIds));
  }

  async getSentMessageIds(options: {
    maxResults: number;
    after?: Date;
    before?: Date;
    pageToken?: string;
  }): Promise<SentMessagePage> {
    const { maxResults, after, before, pageToken } = options;

    const buildRequest = () => {
      // nextLink 已编码了原始请求中的 top/skip/filter。
      const nextLink = resolveMicrosoftGraphNextLink(pageToken);
      if (nextLink) {
        return this.client.getClient().api(nextLink);
      }

      const filters: string[] = [];
      if (after) filters.push(`sentDateTime ge ${after.toISOString()}`);
      if (before) filters.push(`sentDateTime le ${before.toISOString()}`);

      let request = this.client
        .getClient()
        .api("/me/mailFolders/sentitems/messages")
        .select("id,conversationId")
        .top(maxResults)
        .orderby("sentDateTime desc");

      if (filters.length) {
        request = request.filter(filters.join(" and "));
      }

      return request;
    };

    const response: {
      value?: { id?: string; conversationId?: string }[];
      "@odata.nextLink"?: string;
    } = await withMicrosoftGraphRetry(() => buildRequest().get(), this.logger);

    return {
      messages: (response.value || []).flatMap((m) =>
        m.id && m.conversationId
          ? [{ id: m.id, threadId: m.conversationId }]
          : [],
      ),
      nextPageToken: response["@odata.nextLink"],
    };
  }

  async getSentThreadsExcluding(options: {
    excludeToEmails?: string[];
    excludeFromEmails?: string[];
    maxResults?: number;
  }): Promise<EmailThread[]> {
    const {
      excludeToEmails = [],
      excludeFromEmails = [],
      maxResults = 100,
    } = options;
    const client = this.client.getClient();

    // 构建 Microsoft Graph API 过滤器（此处仅排除项；文件夹通过端点限定）
    const filters: string[] = [];

    // 为 TO 邮件添加排除过滤器
    for (const email of excludeToEmails) {
      const escapedEmail = escapeODataString(email);
      filters.push(
        `not (toRecipients/any(r: r/emailAddress/address eq '${escapedEmail}'))`,
      );
    }

    // 为 FROM 邮件添加排除过滤器
    for (const email of excludeFromEmails) {
      const escapedEmail = escapeODataString(email);
      filters.push(`not (from/emailAddress/address eq '${escapedEmail}')`);
    }

    const filter = filters.length ? filters.join(" and ") : undefined;

    // 从 Microsoft Graph API 获取邮件（已知的已发送邮件文件夹）
    let request = client
      .api("/me/mailFolders/sentitems/messages")
      .select(MESSAGE_SELECT_FIELDS)
      .top(maxResults)
      .orderby("sentDateTime desc");

    if (filter) {
      request = request.filter(filter);
    }

    const response = await request.get();

    // 按 conversationId 分组邮件以创建最少的会话（类似原始 Gmail 实现）
    const threadMap = new Map<string, string>();

    for (const message of response.value) {
      const conversationId = message.conversationId;
      if (!conversationId) continue;

      // 每个会话只保留第一个摘要（类似 Gmail 的最少会话方式）
      if (!threadMap.has(conversationId)) {
        threadMap.set(conversationId, message.bodyPreview || "");
      }
    }

    // 转换为 EmailThread 格式（最少，不含邮件——使用者如有需要会调用 getThreadMessages）
    return Array.from(threadMap.entries()).map(([id, snippet]) => ({
      id,
      snippet,
      messages: [], // Empty - consumer will call getThreadMessages(id) if needed
    }));
  }

  async archiveThread(threadId: string, ownerEmail: string): Promise<void> {
    await archiveThread({
      client: this.client,
      threadId,
      ownerEmail,
      actionSource: "automation",
      folderId: "archive",
      logger: this.logger,
    });
  }

  async archiveThreadWithLabel(
    threadId: string,
    ownerEmail: string,
  ): Promise<void> {
    await archiveThread({
      client: this.client,
      threadId,
      ownerEmail,
      actionSource: "user",
      folderId: "archive",
      logger: this.logger,
    });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await unarchiveThread({
      client: this.client,
      threadId,
      logger: this.logger,
    });
  }

  async untrashThread(threadId: string): Promise<void> {
    await untrashThread({
      client: this.client,
      threadId,
      logger: this.logger,
    });
  }

  async bulkArchiveThreads(
    threads: BulkArchiveThread[],
    ownerEmail: string,
  ): Promise<BulkArchiveResult> {
    return moveThreadsInBatches({
      client: this.client,
      threads,
      destinationId: "archive",
      ownerEmail,
      logger: this.logger,
    });
  }

  async trashThread(
    threadId: string,
    ownerEmail: string,
    actionSource: "user" | "automation",
  ): Promise<void> {
    await trashThread({
      client: this.client,
      threadId,
      ownerEmail,
      actionSource,
      logger: this.logger,
    });
  }

  async labelMessage({
    messageId,
    labelId,
    labelName,
  }: {
    messageId: string;
    labelId: string;
    labelName: string | null;
  }): Promise<{ usedFallback?: boolean; actualLabelId?: string }> {
    let { category, usedFallback } = await this.resolveCategoryWithFallback(
      labelId,
      labelName,
    );

    if (!category) {
      if (!labelName) {
        this.logger.warn(
          "Category was deleted but labelName is not available for recreation. Skipping label action.",
          { labelId },
        );
        return {};
      }
      // 模仿 Gmail：按名称重建已删除的类别并继续
      this.logger.warn("类别已被删除，按名称重建", {
        labelId,
        labelName,
      });
      category = await this.createLabel(labelName);
      usedFallback = true;
    }

    const categoryName = category.name;
    const applied = await updateMessageCategories({
      client: this.client,
      messageId,
      update: (categories) =>
        categories.includes(categoryName)
          ? categories
          : [...categories, categoryName],
      logger: this.logger,
    });

    if (applied) {
      this.logger.info("标签已应用", { labelId: category.id });
    } else {
      this.logger.info("标签已存在，跳过", {
        labelId: category.id,
      });
    }

    return {
      usedFallback,
      actualLabelId: category.id || undefined,
    };
  }

  async starMessage(messageId: string): Promise<void> {
    await markStarredMessage({
      client: this.client,
      messageId,
      logger: this.logger,
    });
  }

  async getDraft(
    draftId: string,
    options?: { includeAttachments?: boolean },
  ): Promise<ParsedMessage | null> {
    return getDraft({
      client: this.client,
      draftId,
      logger: this.logger,
      includeAttachments: options?.includeAttachments,
    });
  }

  async getDraftReferenceForMessage(messageId: string) {
    return getDraftReference({
      client: this.client,
      messageId,
      logger: this.logger,
    });
  }

  async deleteDraft(draftId: string, version?: string): Promise<boolean> {
    const draftReference = version
      ? { id: draftId, version }
      : await this.getDraftReferenceForMessage(draftId);
    if (!draftReference) return false;

    return deleteDraft({
      client: this.client,
      draftId: draftReference.id,
      version: draftReference.version,
      logger: this.logger,
    });
  }

  async sendDraft(
    draftId: string,
  ): Promise<{ messageId: string; threadId: string }> {
    return sendDraft({ client: this.client, draftId, logger: this.logger });
  }

  async createDraft(params: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    messageHtml: string;
    replyToMessageId?: string;
    forwardedMessageId?: string;
  }): Promise<{ id: string }> {
    this.logger.info("正在创建草稿", {
      replyToMessageId: params.replyToMessageId,
      forwardedMessageId: params.forwardedMessageId,
    });
    // 为空时省略，以便创建时绝不会清除源邮件所设置的内容。
    const recipients = {
      ...(params.to.trim()
        ? { toRecipients: toGraphRecipients(params.to, this.logger) }
        : {}),
      ...(params.cc?.trim()
        ? { ccRecipients: toGraphRecipients(params.cc, this.logger) }
        : {}),
      ...(params.bcc?.trim()
        ? { bccRecipients: toGraphRecipients(params.bcc, this.logger) }
        : {}),
    };

    // 回复通过 createReply 建立会话关联。转发则从被转发邮件
    // 创建草稿，以便保留其会话和文件。
    let sourceAction: string | undefined;
    if (params.replyToMessageId)
      sourceAction = `/me/messages/${encodeURIComponent(params.replyToMessageId)}/createReply`;
    else if (params.forwardedMessageId)
      sourceAction = `/me/messages/${encodeURIComponent(params.forwardedMessageId)}/createForward`;
    if (sourceAction) {
      const action = sourceAction;
      const draft = await withMicrosoftGraphWriteRetry(
        () => this.client.getClient().api(action).post({}),
        this.logger,
      );

      // 用我们的内容更新草稿
      await withMicrosoftGraphWriteRetry(
        () =>
          this.client
            .getClient()
            .api(`/me/messages/${draft.id}`)
            .patch({
              body: { contentType: "html", content: params.messageHtml },
              subject: params.subject,
              ...recipients,
            }),
        this.logger,
      );

      this.logger.info("已创建关联会话的草稿", { draftId: draft.id });
      return { id: draft.id };
    }

    // 否则创建独立草稿
    const draft = await withMicrosoftGraphWriteRetry(
      () =>
        this.client
          .getClient()
          .api("/me/messages")
          .post({
            subject: params.subject,
            body: { contentType: "html", content: params.messageHtml },
            ...recipients,
          }),
      this.logger,
    );

    this.logger.info("已创建独立草稿", { draftId: draft.id });
    return { id: draft.id };
  }

  async updateDraft(
    draftId: string,
    params: {
      messageHtml?: string;
      subject?: string;
      to?: string;
      cc?: string;
      bcc?: string;
    },
  ): Promise<void> {
    this.logger.info("正在更新草稿", { draftId });

    const draft = await this.getDraftReferenceForMessage(draftId);
    if (!draft)
      throw new DraftNotFoundError("Could not find this draft to update.");

    const body: Partial<Message> = {};
    if (params.messageHtml !== undefined) {
      body.body = { contentType: "html", content: params.messageHtml };
    }
    if (params.subject !== undefined) {
      body.subject = params.subject;
    }

    if (params.to !== undefined)
      body.toRecipients = toGraphRecipients(params.to, this.logger);
    if (params.cc !== undefined)
      body.ccRecipients = toGraphRecipients(params.cc, this.logger);
    if (params.bcc !== undefined)
      body.bccRecipients = toGraphRecipients(params.bcc, this.logger);

    await withMicrosoftGraphWriteRetry(
      () =>
        this.client
          .getClient()
          .api(`/me/messages/${draftId}`)
          .header("If-Match", draft.version)
          .patch(body),
      this.logger,
    );

    this.logger.info("草稿已更新", { draftId });
  }

  async getDraftAttachments(draftId: string) {
    const attachments = await listOutlookDraftAttachments({
      client: this.client,
      draftId,
      logger: this.logger,
    });
    return attachments ? { messageId: draftId, attachments } : null;
  }

  async addDraftAttachment(
    draftId: string,
    attachment: DraftAttachmentMetadata & { content: Buffer },
  ) {
    const { attachments } = await this.getEditableDraftAttachments(draftId);
    assertDraftAttachmentLimits(attachments, attachment.size);
    const attachmentId = await addOutlookDraftAttachment({
      client: this.client,
      draftId,
      attachment,
      logger: this.logger,
    });
    return { ...(await this.listDraftAttachments(draftId)), attachmentId };
  }

  async removeDraftAttachment(draftId: string, attachmentId: string) {
    await this.getEditableDraftAttachments(draftId);
    await removeOutlookDraftAttachment({
      client: this.client,
      draftId,
      attachmentId,
      logger: this.logger,
    });
    return this.listDraftAttachments(draftId);
  }

  async startDraftAttachmentUpload(
    draftId: string,
    attachment: DraftAttachmentMetadata,
  ): Promise<DraftAttachmentUploadStart> {
    const { attachments } = await this.getEditableDraftAttachments(draftId);
    assertDraftAttachmentLimits(attachments, attachment.size);
    const uploadUrl = await createOutlookDraftAttachmentUploadSession({
      client: this.client,
      draftId,
      attachment,
      logger: this.logger,
    });
    return { type: "provider-url", uploadUrl };
  }

  // Graph 也会更改已发送和已接收邮件上的附件，因此在更改之前
  // 先确认该邮件是草稿。
  private async getEditableDraftAttachments(draftId: string) {
    if (!(await this.getDraftReferenceForMessage(draftId)))
      throw new DraftNotFoundError("Could not find this draft in Outlook.");
    return this.listDraftAttachments(draftId);
  }

  private async listDraftAttachments(draftId: string) {
    const result = await this.getDraftAttachments(draftId);
    if (!result)
      throw new DraftNotFoundError("Could not find this draft in Outlook.");
    return result;
  }

  async draftEmail(
    email: ParsedMessage,
    args: {
      to?: string;
      subject?: string;
      content: string;
      cc?: string;
      bcc?: string;
      attachments?: MailAttachment[];
    },
    userEmail: string,
    executedRule?: { id: string; threadId: string; emailAccountId: string },
  ): Promise<{ draftId: string }> {
    if (shouldSkipAutoDraft({ logger: this.logger, source: "microsoft" })) {
      return { draftId: "" };
    }

    this.logger.info("正在创建 Outlook 草稿", {
      hasExecutedRule: Boolean(executedRule),
      contentLength: args.content?.length,
    });

    if (executedRule) {
      // 并行运行草稿创建和先前草稿删除
      const [result] = await Promise.all([
        draftEmail(this.client, email, args, userEmail, this.logger),
        handlePreviousDraftDeletion({
          client: this,
          executedRule,
          logger: this.logger,
        }),
      ]);

      this.logger.info("Outlook 草稿创建成功", {
        draftId: result.id,
      });
      return { draftId: result.id || "" };
    } else {
      const result = await draftEmail(
        this.client,
        email,
        args,
        userEmail,
        this.logger,
      );

      this.logger.info("Outlook 草稿创建成功", {
        draftId: result.id,
      });
      return { draftId: result.id || "" };
    }
  }

  async replyToEmail(
    email: ParsedMessage,
    content: string,
    options?: {
      replyTo?: string;
      from?: string;
      attachments?: MailAttachment[];
    },
  ): Promise<{ messageId: string }> {
    const result = await replyToEmail(
      this.client,
      email,
      content,
      this.logger,
      options,
    );
    return { messageId: requireSentMessageId(result.id) };
  }

  async sendEmail(args: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    messageText: string;
    attachments?: MailAttachment[];
  }): Promise<{ messageId: string }> {
    const result = await sendEmailWithPlainText(this.client, args, this.logger);
    return { messageId: requireSentMessageId(result.id) };
  }

  async sendEmailWithHtml(body: SendEmailBody, options?: SendEmailOptions) {
    const result = await sendEmailWithHtml(
      this.client,
      {
        ...body,
        attachments: toMailerAttachments(body.attachments),
      },
      this.logger,
      options,
    );
    return {
      messageId: result.id || "",
      threadId: result.conversationId || "",
    };
  }

  async forwardEmail(
    email: ParsedMessage,
    args: {
      to: string;
      cc?: string;
      bcc?: string;
      content?: string;
      from?: string;
    },
  ): Promise<{ messageId: string }> {
    const result = await forwardEmail(
      this.client,
      { messageId: email.id, ...args },
      this.logger,
    );
    return { messageId: requireSentMessageId(result.id) };
  }

  async markSpam(threadId: string): Promise<void> {
    await markSpam(this.client, threadId, this.logger);
  }

  async markNotSpam(threadId: string): Promise<void> {
    await markNotSpam(this.client, threadId, this.logger);
  }

  async markRead(threadId: string): Promise<void> {
    await markReadThread({
      client: this.client,
      threadId,
      read: true,
      logger: this.logger,
    });
  }

  async markReadMessage(messageId: string): Promise<void> {
    await this.client.getClient().api(`/me/messages/${messageId}`).patch({
      isRead: true,
    });
  }

  async blockUnsubscribedEmail(messageId: string): Promise<void> {
    await this.archiveMessage(messageId);
    await this.markReadMessage(messageId);
  }

  async getThreadMessages(threadId: string): Promise<ParsedMessage[]> {
    try {
      const messages = await getThreadMessages(
        threadId,
        this.client,
        this.logger,
      );
      return messages;
    } catch (error) {
      // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
      const err = error as any;
      const context = {
        threadId,
        error,
        errorCode: err?.code,
      };
      if (isRetryableError(extractErrorInfo(error)).isRateLimit) {
        this.logger.warn("getThreadMessages 失败", context);
      } else {
        this.logger.error("getThreadMessages 失败", context);
      }
      throw error;
    }
  }

  async getThreadMessagesInInbox(threadId: string): Promise<ParsedMessage[]> {
    // 优化：按收件箱文件夹过滤的直接 API 调用
    const client = this.client.getClient();

    try {
      const folderIds = await getFolderIds(this.client, this.logger, {
        includeDrafts: false,
      });
      const inboxFolderId = folderIds.inbox;

      if (!inboxFolderId) {
        throw new Error("无法解析收件箱文件夹 ID");
      }

      const escapedThreadId = escapeODataString(threadId);

      const response = await client
        .api("/me/messages")
        .filter(
          `conversationId eq '${escapedThreadId}' and parentFolderId eq '${escapeODataString(inboxFolderId)}'`,
        )
        .select(MESSAGE_SELECT_FIELDS)
        .get();

      // 使用现有辅助函数转换为 ParsedMessage 格式
      const messages: ParsedMessage[] = [];

      for (const message of response.value) {
        try {
          // 使用现有的 getMessage 函数正确解析每封邮件
          const parsedMessage = await getMessage(
            message.id,
            this.client,
            this.logger,
          );
          messages.push(parsedMessage);
        } catch (error) {
          this.logger.warn("解析收件箱会话中的邮件失败", {
            error,
            messageId: message.id,
            threadId,
          });
        }
      }

      // 按 receivedDateTime 升序排序邮件（最旧优先）以避免 "restriction or sort order is too complex" 错误
      return messages.sort((a, b) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateA - dateB; // asc order (oldest first)
      });
    } catch (error) {
      this.logger.error("获取收件箱会话邮件时出错", {
        error,
        threadId,
      });
      throw error;
    }
  }

  async getPreviousConversationMessages(
    messageIds: string[],
  ): Promise<ParsedMessage[]> {
    return this.getMessagesBatch(messageIds);
  }

  async removeThreadLabel(threadId: string, labelId: string): Promise<void> {
    // 获取标签以将 ID 转换为名称（Outlook 使用名称）
    // 注意：如果我们已有名称，可以跳过此步骤。但由于我们允许用户使用自定义 id 且不存储自定义类别名称，因此需要先获取名称。
    try {
      const label = await getLabelById({ client: this.client, id: labelId });
      const categoryName = label.displayName || "";

      await removeThreadLabel({
        client: this.client,
        threadId,
        categoryName,
        logger: this.logger,
      });
    } catch (error) {
      // 如果标签不存在（404），没关系——没有需要移除的内容
      if (
        (error as { statusCode?: number; code?: string }).statusCode === 404 ||
        (error as { statusCode?: number; code?: string }).code ===
          "CategoryNotFound"
      ) {
        this.logger.info("未找到标签，跳过移除", {
          threadId,
          labelId,
        });
        return;
      }
      throw error;
    }
  }

  async removeThreadLabels(
    threadId: string,
    labelIds: string[],
  ): Promise<void> {
    if (!labelIds.length) return;

    const [allLabels, messages] = await Promise.all([
      this.getLabels(),
      this.client
        .getClient()
        .api("/me/messages")
        .filter(`conversationId eq '${escapeODataString(threadId)}'`)
        .select("id,categories")
        .get() as Promise<{
        value: Array<{ id: string; categories?: string[] }>;
      }>,
    ]);

    const labelIdsSet = new Set(labelIds);
    const removeCategoryNames = allLabels
      .filter((label) => labelIdsSet.has(label.id))
      .map((label) => label.name);

    if (!removeCategoryNames.length) return;

    const messagesWithCategories = messages.value.filter((message) =>
      message.categories?.some((cat) => removeCategoryNames.includes(cat)),
    );

    for (const message of messagesWithCategories) {
      await updateMessageCategories({
        client: this.client,
        messageId: message.id,
        update: (categories) =>
          categories.filter((cat) => !removeCategoryNames.includes(cat)),
        logger: this.logger,
      });
    }
  }

  async createLabel(name: string): Promise<EmailLabel> {
    const label = await createLabel({
      client: this.client,
      name,
      logger: this.logger,
    });

    return {
      id: label.id || "",
      name: label.displayName || label.id || "",
      type: "user",
    };
  }

  async deleteLabel(labelId: string): Promise<void> {
    try {
      await withMicrosoftGraphRetry(
        () =>
          this.client
            .getClient()
            .api(`/me/outlook/masterCategories/${encodeURIComponent(labelId)}`)
            .delete(),
        this.logger,
      );
    } catch (error) {
      if (extractErrorInfo(error).status !== 404) throw error;
      this.logger.info("类别已被删除", { labelId });
    }
    this.client.invalidateCategoryMapCache();
  }

  async updateLabel(labelId: string, update: EmailLabelUpdate): Promise<void> {
    if (update.name) throw new Error("Microsoft 类别名称无法更改");
    if (update.labelListVisibility || update.messageListVisibility)
      throw new Error("Microsoft 类别没有可见性设置");
    if (!update.color) throw new Error("需要 Microsoft 类别颜色");
    const color = getOutlookCategoryPreset(update.color.backgroundColor);
    if (!color) throw new Error("不支持的 Microsoft 类别颜色");

    await withMicrosoftGraphWriteRetry(
      () =>
        this.client
          .getClient()
          .api(`/me/outlook/masterCategories/${encodeURIComponent(labelId)}`)
          .patch({ color }),
      this.logger,
    );
    this.client.invalidateCategoryMapCache();
  }

  async renameLabel(labelId: string, newName: string): Promise<void> {
    const sanitizedName = sanitizeOutlookCategoryName(newName);
    if (!sanitizedName) throw new Error("标签名称不能为空");

    const existing = await getLabelById({ client: this.client, id: labelId });
    const previousName = existing?.displayName;
    if (!previousName)
      throw new Error(`未找到要重命名的 Outlook 类别: ${labelId}`);
    if (previousName === sanitizedName) return;

    await withMicrosoftGraphWriteRetry(
      () =>
        this.client
          .getClient()
          .api(`/me/outlook/masterCategories/${encodeURIComponent(labelId)}`)
          .patch({ displayName: sanitizedName }),
      this.logger,
    );
    this.client.invalidateCategoryMapCache();

    // 邮件上的类别名是旧名字，必须一并改写，否则它们会变成孤立类别。
    await renameCategoryOnMessages({
      client: this.client,
      previousName,
      nextName: sanitizedName,
      logger: this.logger,
    });
  }

  async getOrCreateInboxZeroLabel(key: InboxZeroLabel): Promise<EmailLabel> {
    const label = await getOrCreateInboxZeroLabel({
      client: this.client,
      key,
      logger: this.logger,
    });
    return {
      id: label.id || "",
      name: label.displayName || label.id || "",
      type: "user",
    };
  }

  async getOriginalMessage(
    originalMessageId: string | undefined,
  ): Promise<ParsedMessage | null> {
    if (!originalMessageId) return null;
    try {
      return await this.getMessage(originalMessageId);
    } catch {
      return null;
    }
  }

  async getFiltersList(): Promise<EmailFilter[]> {
    try {
      const response = await getFiltersList({
        client: this.client,
        logger: this.logger,
      });

      const mappedFilters = (response.value || []).map((filter) => {
        const mappedFilter = {
          id: filter.id || "",
          criteria: {
            from: filter.conditions?.senderContains?.[0] || undefined,
          },
          action: {
            addLabelIds: filter.actions?.assignCategories || undefined,
            removeLabelIds: filter.actions?.moveToFolder
              ? ["INBOX"]
              : undefined,
          },
        };
        return mappedFilter;
      });

      return mappedFilters;
    } catch (error) {
      this.logger.error("Outlook getFiltersList 出错", { error });
      throw error;
    }
  }

  async createFilter(options: {
    from: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }) {
    return createFilter({
      client: this.client,
      ...options,
      logger: this.logger,
    });
  }

  async createAutoArchiveFilter(options: { from: string; labelName?: string }) {
    return createAutoArchiveFilter({
      client: this.client,
      from: options.from,
      labelName: options.labelName,
      logger: this.logger,
    });
  }

  async deleteFilter(id: string) {
    return deleteFilter({ client: this.client, id, logger: this.logger });
  }

  async getMessagesWithPagination(options: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
    folderId?: string;
    before?: Date;
    after?: Date;
    inboxOnly?: boolean;
    unreadOnly?: boolean;
    includeDrafts?: boolean;
  }): Promise<{
    messages: ParsedMessage[];
    nextPageToken?: string;
  }> {
    this.logger.info("已调用 getMessagesWithPagination", {
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      before: options.before?.toISOString(),
      after: options.after?.toISOString(),
    });
    this.logger.trace("getMessagesWithPagination query", {
      query: options.query,
    });

    // 重要：这是有意设计的损失性转换！
    // 像 "subject:" 这样的 Gmail 风格前缀无法转换为 Microsoft Graph，因为：
    // 1. $filter with contains(subject, ...) can't be combined with $search or date filters
    //    (causes "InefficientFilter" error)
    // 2. $search doesn't support field-specific syntax like "subject:term"
    //
    // 我们剥离前缀并使用普通 $search，它会同时搜索主题和正文。
    // 这比预期更宽泛，但仍能找到相关邮件。
    // 如果将来需要按主题搜索，请添加一个专用方法
    // 该方法仅使用 $filter，而不使用 $search 或日期过滤器。
    function stripGmailPrefixes(query: string): string {
      return query
        .replace(/\b(subject|from|to|label):(?:"[^"]*"|\S+)/gi, (match) => {
          // 提取去除前缀后的值用于搜索
          const colonIndex = match.indexOf(":");
          const value = match.slice(colonIndex + 1);
          // 如果存在引号则移除
          return value.replace(/^"|"$/g, "");
        })
        .replace(/\s+/g, " ")
        .trim();
    }

    const searchQuery = stripGmailPrefixes(options.query || "");

    let folderId = options.folderId;
    if (options.inboxOnly) {
      const folderIds = await getFolderIds(this.client, this.logger, {
        includeDrafts: Boolean(options.includeDrafts),
      });
      folderId = folderIds.inbox;
    }

    // 为 Outlook 构建日期过滤器（DateTimeOffset 比较不加引号）
    const dateFilters: string[] = [];
    if (options.before) {
      dateFilters.push(`receivedDateTime lt ${options.before.toISOString()}`);
    }
    if (options.after) {
      dateFilters.push(`receivedDateTime gt ${options.after.toISOString()}`);
    }

    this.logger.info("正在调用 queryBatchMessages", {
      dateFilters,
      maxResults: options.maxResults || 20,
      pageToken: options.pageToken,
    });
    this.logger.trace("Search query", {
      searchQuery: searchQuery || undefined,
    });

    const response = await queryBatchMessages(
      this.client,
      {
        searchQuery: searchQuery || undefined,
        dateFilters,
        maxResults: options.maxResults || 20,
        pageToken: options.pageToken,
        folderId,
        includeDrafts: options.includeDrafts,
      },
      this.logger,
    );

    const filteredMessages = options.unreadOnly
      ? response.messages.filter((message) =>
          message.labelIds?.some(
            (labelId) => labelId.toLowerCase() === "unread",
          ),
        )
      : response.messages;

    return {
      messages: filteredMessages || [],
      nextPageToken: response.nextPageToken,
    };
  }

  async searchMessages(options: {
    query: string;
    mailboxSearch?: ProviderMailboxSearch;
    maxResults?: number;
    pageToken?: string;
    fromEmail?: string;
    readState?: "read" | "unread";
    labelName?: string;
    folderId?: string;
    labelIds?: string[];
    includeSpamTrash?: boolean;
    folder?: "spam" | "trash";
  }): Promise<{ messages: ParsedMessage[]; nextPageToken?: string }> {
    const categoryName = await resolveOutlookCategoryName({
      emailProvider: this,
      categoryName: options.labelName,
    });
    const folderId =
      options.folderId ??
      (await outlookSpamTrashFolderId({
        client: this.client,
        logger: this.logger,
        folder: options.folder ?? spamTrashFolderFromLabels(options.labelIds),
      }));
    const mailbox = options.mailboxSearch?.mailbox;
    const wellKnownFolder = mailbox
      ? {
          inbox: "inbox",
          sent: "sentitems",
          drafts: "drafts",
          spam: "junkemail",
          trash: "deleteditems",
          all: undefined,
          archive: undefined,
          starred: undefined,
        }[mailbox]
      : undefined;
    const categoryNames = categoryName ? [categoryName] : [];

    const response = await queryBatchMessages(
      this.client,
      {
        searchQuery: options.query,
        maxResults: options.maxResults || 20,
        pageToken: options.pageToken,
        fromEmail: options.fromEmail,
        readState: options.readState,
        folderId: wellKnownFolder ?? folderId,
        categoryNames,
        mailboxSearch: options.mailboxSearch,
        includeDrafts: options.mailboxSearch !== undefined,
      },
      this.logger,
    );

    return {
      messages: response.messages || [],
      nextPageToken: response.nextPageToken,
    };
  }

  async getMessagesWithAttachments(options: {
    maxResults?: number;
    pageToken?: string;
  }): Promise<{ messages: ParsedMessage[]; nextPageToken?: string }> {
    return queryMessagesWithAttachments(
      this.client,
      {
        maxResults: options.maxResults,
        pageToken: options.pageToken,
      },
      this.logger,
    );
  }

  async getMessagesFromSender(options: {
    senderEmail: string;
    maxResults?: number;
    pageToken?: string;
    before?: Date;
    after?: Date;
  }): Promise<{
    messages: ParsedMessage[];
    nextPageToken?: string;
  }> {
    const filters: string[] = [
      `from/emailAddress/address eq '${escapeODataString(options.senderEmail)}'`,
    ];

    const dateFilters: string[] = [];
    if (options.before) {
      dateFilters.push(`receivedDateTime lt ${options.before.toISOString()}`);
    }
    if (options.after) {
      dateFilters.push(`receivedDateTime gt ${options.after.toISOString()}`);
    }

    return queryMessagesWithFilters(
      this.client,
      {
        filters,
        dateFilters,
        maxResults: options.maxResults,
        pageToken: options.pageToken,
      },
      this.logger,
    );
  }

  async getThreadsWithParticipant(options: {
    participantEmail: string;
    maxThreads?: number;
  }): Promise<EmailThread[]> {
    const { participantEmail, maxThreads = 5 } = options;
    const maxSearchResults = Math.min(20, Math.max(10, maxThreads * 4));

    // 重要：
    // Microsoft Graph 并不可靠地支持按收件人集合过滤 Messages
    // (e.g. `toRecipients/any(...)`) and will error with:
    // "The query filter contains one or more invalid nodes."
    //
    const sanitizedEmail = sanitizeKqlValue(participantEmail);
    const searchQuery = `participants:${sanitizedEmail}`;

    const { messages, nextPageToken } = await queryBatchMessages(
      this.client,
      {
        searchQuery,
        maxResults: maxSearchResults,
      },
      this.logger,
    );

    const participantLower = participantEmail.toLowerCase().trim();
    const relevant = filterMessagesForParticipant(messages, participantLower);

    // 从解析后的邮件中提取唯一的 conversationId（会话 ID）
    const conversationIds = getUniqueThreadIds(relevant, maxThreads);

    this.logger.info("Outlook 参与者搜索已完成", {
      rawMessageCount: messages.length,
      exactParticipantMessageCount: relevant.length,
      threadCount: conversationIds.length,
      hasMorePages: !!nextPageToken,
    });

    if (conversationIds.length === 0) {
      return [];
    }

    // 为每个会话获取完整会话邮件
    const threads: EmailThread[] = [];
    for (const conversationId of conversationIds) {
      try {
        const messages = await this.getThreadMessages(conversationId);
        threads.push({
          id: conversationId,
          messages,
          snippet: messages.at(-1)?.snippet || "",
        });
      } catch (error) {
        this.logger.warn("为 conversationId 获取会话邮件失败", {
          conversationId,
          error,
          // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
          errorCode: (error as any)?.code,
          // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
          errorStatusCode: (error as any)?.statusCode,
        });
      }
    }

    return threads;
  }

  async getThreadsWithLabel(options: {
    labelId: string;
    maxResults?: number;
  }): Promise<EmailThread[]> {
    const { labelId, maxResults = 100 } = options;

    const category = await this.getLabelById(labelId);
    if (!category) {
      this.logger.warn("未找到类别", { labelId });
      return [];
    }

    const categoryName = category.name;
    if (!categoryName) {
      this.logger.warn("类别没有名称", { labelId });
      return [];
    }

    const escapedCategoryName = escapeODataString(categoryName);
    const filter = `categories/any(c:c eq '${escapedCategoryName}')`;

    const response = await this.client
      .getClient()
      .api("/me/messages")
      .filter(filter)
      .select(MESSAGE_SELECT_FIELDS)
      .top(maxResults)
      .orderby("receivedDateTime DESC")
      .get();

    const messagesByThread = new Map<string, ParsedMessage[]>();

    for (const message of response.value || []) {
      if (!message.conversationId) continue;
      if (message.isDraft) continue;

      const parsed = convertMessage(message);
      const existing = messagesByThread.get(message.conversationId) || [];
      existing.push(parsed);
      messagesByThread.set(message.conversationId, existing);
    }

    return Array.from(messagesByThread.entries()).map(
      ([threadId, messages]) => ({
        id: threadId,
        messages: messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        ),
        snippet: messages.at(-1)?.snippet || "",
      }),
    );
  }

  async getLatestMessageFromThreadSnapshot(
    threadSnapshot: Pick<EmailThread, "id" | "messages">,
  ): Promise<ParsedMessage | null> {
    return this.getLatestMessageInThread(threadSnapshot.id);
  }

  async getLatestMessageInThread(
    threadId: string,
  ): Promise<ParsedMessage | null> {
    const escapedThreadId = escapeODataString(threadId);
    // 带正文的整个会话可能达到数兆字节，而 Graph 有时会在
    // 响应体中途结束这样的 200 响应。先从元数据中选取最新的邮件，
    // 然后仅完整获取那一封。
    const messages: Message[] = [];
    let nextLink: string | undefined;
    do {
      const pageLink = nextLink;
      const page: { value?: Message[]; "@odata.nextLink"?: string } =
        await withMicrosoftGraphRetry(
          () =>
            pageLink
              ? this.client.getClient().api(pageLink).get()
              : this.client
                  .getClient()
                  .api("/me/messages")
                  .filter(`conversationId eq '${escapedThreadId}'`)
                  .select(MESSAGE_LIST_SELECT_FIELDS)
                  .top(100)
                  .get(),
          this.logger,
        );
      messages.push(...(page.value ?? []));
      nextLink = page["@odata.nextLink"];
    } while (nextLink);

    const parsedMessages: ParsedMessage[] = messages
      .filter((message: Message) => !message.isDraft)
      .map((message: Message) => convertMessage(message));
    if (parsedMessages.length === 0) return null;

    const latestMessage = getLatestNonDraftMessage({
      messages: parsedMessages,
      getTimestamp: getMessageTimestamp,
    });
    if (!latestMessage) return null;

    return this.getMessage(latestMessage.id);
  }

  async getDrafts(options?: { maxResults?: number }): Promise<ParsedMessage[]> {
    const response: { value: Message[] } = await this.client
      .getClient()
      .api("/me/mailFolders/drafts/messages")
      .select(MESSAGE_SELECT_FIELDS)
      .top(options?.maxResults || 50)
      .get();

    return response.value.map((msg) => convertMessage(msg));
  }

  async getMessagesBatch(messageIds: string[]): Promise<ParsedMessage[]> {
    // 对于 Outlook，由于没有批量端点，我们需要逐封获取邮件
    const messagePromises = messageIds.map((messageId) =>
      this.getMessage(messageId),
    );
    return Promise.all(messagePromises);
  }

  async syncLocalMail(
    request: LocalMailSyncRequest,
    context: { emailAccountId: string },
  ): Promise<LocalMailSyncResponse> {
    if (!context.emailAccountId) throw new Error("需要本地邮件账号上下文");
    const base = {
      emailAccountId: context.emailAccountId,
      client: this.client,
      logger: this.logger,
    };
    if (request.phase === "folders")
      return {
        status: "ok",
        phase: request.phase,
        result: await getOutlookMailFoldersPage({ ...base, ...request }),
      };
    if (
      ![
        "capabilities",
        "folder-changes",
        "folder-backfill",
        "message-lookup",
      ].includes(request.phase)
    )
      return { status: "unsupported", strategy: this.localMailSyncStrategy };
    const folderIds = await resolveOutlookLocalMailFolderIds(base);
    switch (request.phase) {
      case "capabilities":
        return {
          status: "ok",
          phase: request.phase,
          result: {
            strategy: this.localMailSyncStrategy,
            excludedFolderIds: [
              folderIds.drafts!,
              folderIds.deleteditems!,
              folderIds.junkemail!,
            ],
            maxHydrationMessages: 1,
          },
        };
      case "folder-changes": {
        const result = await getOutlookMailFolderChangesPage({
          ...base,
          ...request,
          folderIds,
          priority: request.stream === "backfill" ? "backfill" : "current",
        });
        return result.resetRequired
          ? { status: "reset-required", phase: request.phase }
          : { status: "ok", phase: request.phase, result };
      }
      case "folder-backfill": {
        const result = await getOutlookMailBackfillPage({
          ...base,
          ...request,
          folderIds,
          after: new Date(request.after),
          before: new Date(request.before),
        });
        return result.resetRequired
          ? { status: "reset-required", phase: request.phase }
          : { status: "ok", phase: request.phase, result };
      }
      case "message-lookup":
        return {
          status: "ok",
          phase: request.phase,
          result: await getOutlookLocalMailMessage({
            ...base,
            ...request,
            folderIds,
            priority: request.stream === "backfill" ? "backfill" : "current",
          }),
        };
      default:
        return { status: "unsupported", strategy: this.localMailSyncStrategy };
    }
  }

  async getMailboxSyncPage(options: {
    after?: Date;
    cursor?: string;
    folderId?: string;
    limit: number;
  }) {
    return getOutlookMailboxSyncPage({
      client: this.client,
      logger: this.logger,
      ...options,
    });
  }

  getAccessToken(): string {
    return this.client.getAccessToken();
  }

  async searchContacts(query: string) {
    // Microsoft 模拟器没有人员/联系人 Graph 端点。
    if (isMicrosoftEmulationEnabled()) return [];
    return searchContacts(this.client, query, this.logger);
  }

  async getContactPhotos() {
    // Graph 将联系人照片作为每个联系人的二进制提供，而不是 URL。
    return {};
  }

  async markReadThread(threadId: string, read: boolean): Promise<void> {
    await markReadThread({
      client: this.client,
      threadId,
      read,
      logger: this.logger,
    });
  }
  async checkIfReplySent(senderEmail: string): Promise<boolean> {
    try {
      const query = `from:me to:${senderEmail}`;
      const response = await getMessages(
        this.client,
        {
          query,
          maxResults: 1,
        },
        this.logger,
      );
      const sent = (response.messages?.length ?? 0) > 0;
      this.logger.info("已检查是否发送了回复", { senderEmail, sent });
      return sent;
    } catch (error) {
      this.logger.warn("检查是否发送了回复时出错", {
        error,
        senderEmail,
      });
      return true; // Default to true on error (safer for TO_REPLY filtering)
    }
  }

  async countReceivedMessages(
    senderEmail: string,
    threshold: number,
  ): Promise<number> {
    try {
      const query = `from:${senderEmail}`;
      this.logger.info("正在检查已接收邮件数量", {
        senderEmail,
        threshold,
      });

      // 最多获取阈值的邮件数量
      const response = await getMessages(
        this.client,
        {
          query,
          maxResults: threshold,
        },
        this.logger,
      );
      const count = response.messages?.length ?? 0;

      this.logger.info("已接收邮件数量检查结果", {
        senderEmail,
        count,
      });
      return count;
    } catch (error) {
      this.logger.warn("统计已接收邮件时出错", {
        error,
        senderEmail,
      });
      return 0; // Default to 0 on error
    }
  }

  getAttachmentStream(
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ) {
    return getOutlookAttachmentStream(
      this.client,
      messageId,
      attachmentId,
      signal,
    );
  }

  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const attachment = await getOutlookAttachment(
      this.client,
      messageId,
      attachmentId,
    );

    // Outlook 附件直接返回数据，而不是 base64 编码的
    // 我们需要将其转换为 base64 以与 Gmail 保持一致
    const data = attachment.contentBytes
      ? Buffer.from(attachment.contentBytes, "base64").toString("base64")
      : "";

    return {
      data,
      size: attachment.size || 0,
    };
  }

  async getThreadsWithQuery(options: {
    query?: ThreadsQuery;
    maxResults?: number;
    pageToken?: string;
    messageFormat?: "full" | "metadata";
  }): Promise<{
    threads: EmailThread[];
    nextPageToken?: string;
  }> {
    const senderFilter = options.query?.fromEmail?.trim();
    const domainFilter = senderFilter?.startsWith("@") ? senderFilter : null;

    const {
      fromEmail,
      after,
      before,
      isUnread,
      type,
      folderId,
      inboxSection,
      labelId,
      labelIds,
      excludeLabelNames,
    } = options.query || {};

    const client = this.client.getClient();
    const hasExplicitLabelFilters = Boolean(labelId || labelIds?.length);
    const requiredLabelIds = getRequiredOutlookThreadLabelIds({
      labelId,
      labelIds,
      type,
    });
    const requiredLabelIdsForLocalFiltering = hasExplicitLabelFilters
      ? requiredLabelIds
      : undefined;
    const resolvedFolderIds = await getFolderIds(this.client, this.logger, {
      includeDrafts:
        requiredLabelIds?.some((id) => id.toUpperCase() === "DRAFT") ?? false,
    });
    const cachedCategoryMap = this.client.getCategoryMapCache() || undefined;
    const needsCategoryMapForFiltering = shouldFetchOutlookCategoryMap({
      excludeLabelNames,
      requiredLabelIds: requiredLabelIdsForLocalFiltering,
      folderIds: resolvedFolderIds,
    });
    let categoryMap = needsCategoryMapForFiltering
      ? await getCategoryMap(this.client, this.logger)
      : cachedCategoryMap;
    const { categoryMap: ensuredCategoryMap, unresolvedRequiredLabelIds } =
      await ensureOutlookRequiredCategoryMap({
        client: this.client,
        logger: this.logger,
        requiredLabelIds: requiredLabelIdsForLocalFiltering,
        folderIds: resolvedFolderIds,
        categoryMap,
      });
    categoryMap = ensuredCategoryMap;
    const effectiveRequiredLabelIdsForLocalFiltering =
      requiredLabelIdsForLocalFiltering?.filter(
        (labelId) => !unresolvedRequiredLabelIds.includes(labelId),
      );
    const excludedLabelIds = getExcludedOutlookThreadLabelIds(
      excludeLabelNames,
      categoryMap,
    );
    const requiresLocalLabelFiltering = Boolean(
      excludedLabelIds.size ||
        effectiveRequiredLabelIdsForLocalFiltering?.length,
    );
    const maxResults = options.maxResults || 50;

    const fetchThreadPage = async (pageToken?: string) => {
      const nextLink = resolveMicrosoftGraphNextLink(pageToken);
      if (nextLink) {
        return await client.api(nextLink).get();
      }

      // 根据查询类型确定端点并构建过滤器
      let endpoint = "/me/messages";
      const filters: string[] = [];

      // Graph 要求 orderby 字段的过滤器排在其他所有字段之前。
      if (after) {
        filters.push(`receivedDateTime gt ${after.toISOString()}`);
      }

      if (before) {
        filters.push(`receivedDateTime lt ${before.toISOString()}`);
      }

      // 根据类型路由到相应的端点
      // 邮件上的 parentFolderId 是 GUID，而不是已知名称——始终解析
      if (folderId) {
        endpoint = `/me/mailFolders/${encodeURIComponent(folderId)}/messages`;
      } else if (inboxSection && !hasExplicitLabelFilters) {
        endpoint = "/me/mailFolders/inbox/messages";
      } else if (type === "sent" && !hasExplicitLabelFilters) {
        endpoint = "/me/mailFolders/sentitems/messages";
      } else {
        if (labelId && !labelIds?.length) {
          const labelFilter = await resolveOutlookThreadQueryFilter({
            client: this.client,
            folderIds: resolvedFolderIds,
            labelId,
            logger: this.logger,
          });
          if (labelFilter) filters.push(labelFilter);
        } else if (!hasExplicitLabelFilters) {
          const defaultFolderFilter = getDefaultOutlookThreadFolderFilter({
            folderIds: resolvedFolderIds,
            type,
          });
          if (defaultFolderFilter) filters.push(defaultFolderFilter);
        }
      }

      if (fromEmail && !domainFilter) {
        const escapedEmail = escapeODataString(fromEmail);
        filters.push(`from/emailAddress/address eq '${escapedEmail}'`);
      }

      if (isUnread) {
        filters.push("isRead eq false");
      }

      // Outlook 没有星标文件夹：星标是邮件上的标志，因此
      // 该视图跨越每个文件夹，而不是限定到某一个。
      if (type === "starred" && !hasExplicitLabelFilters) {
        filters.push("flag/flagStatus eq 'flagged'");
      }

      if (inboxSection && !folderId) {
        filters.push(`inferenceClassification eq '${inboxSection}'`);
      }

      const filter = filters.length > 0 ? filters.join(" and ") : undefined;

      let request = client
        .api(endpoint)
        .select(
          options.messageFormat === "metadata"
            ? MESSAGE_LIST_SELECT_FIELDS
            : MESSAGE_SELECT_FIELDS,
        )
        .top(maxResults);

      if (filter) {
        request = request.filter(filter);
      }

      if (!fromEmail || domainFilter) {
        request = request.orderby("receivedDateTime DESC");
      }

      return await request.get();
    };

    const localPageState = parseOutlookThreadPageToken(options.pageToken);
    let nextPageTokenToFetch =
      localPageState?.pageToken ?? (options.pageToken || undefined);
    let nextPageToken: string | undefined;
    const collectedMessages: Message[] = [];
    const fetchedPages: Array<{ pageToken?: string; nextPageToken?: string }> =
      [];
    const threadFirstPageIndex = new Map<string, number>();

    do {
      const response = await fetchThreadPage(nextPageTokenToFetch);
      if (domainFilter) {
        response.value = response.value.filter((message: Message) =>
          matchesSenderFilter(
            message.from?.emailAddress?.address ?? "",
            domainFilter,
          ),
        );
      }
      const currentPageIndex = fetchedPages.length;
      fetchedPages.push({
        pageToken: nextPageTokenToFetch,
        nextPageToken: response["@odata.nextLink"],
      });

      for (const message of response.value) {
        if (
          message.conversationId &&
          !threadFirstPageIndex.has(message.conversationId)
        ) {
          threadFirstPageIndex.set(message.conversationId, currentPageIndex);
        }
      }

      collectedMessages.push(...response.value);
      nextPageToken = response["@odata.nextLink"];

      // Graph 搜索会限制结果数量且无法保留 OData 过滤器。改为扫描
      // 普通查询页面，并限制每次请求的稀疏域扫描。
      if (
        (!requiresLocalLabelFiltering && !domainFilter) ||
        !nextPageToken ||
        (domainFilter && fetchedPages.length >= 5)
      )
        break;

      const matchedThreads = buildOutlookThreadsFromMessages({
        messages: collectedMessages,
        fromEmail,
        folderIds: resolvedFolderIds,
        categoryMap,
        excludedLabelIds,
        requiredLabelIds: effectiveRequiredLabelIdsForLocalFiltering,
        logger: this.logger,
      });

      if (matchedThreads.length >= maxResults) break;

      nextPageTokenToFetch = nextPageToken;
    } while (nextPageTokenToFetch);

    let threads = buildOutlookThreadsFromMessages({
      messages: collectedMessages,
      fromEmail,
      folderIds: resolvedFolderIds,
      categoryMap,
      excludedLabelIds,
      requiredLabelIds: effectiveRequiredLabelIdsForLocalFiltering,
      logger: this.logger,
    });

    if (localPageState?.skipThreadIds.length) {
      const skippedThreadIds = new Set(localPageState.skipThreadIds);
      threads = threads.filter((thread) => {
        const firstPageIndex = threadFirstPageIndex.get(thread.id);
        return !(firstPageIndex === 0 && skippedThreadIds.has(thread.id));
      });
    }

    if (threads.length > maxResults && fetchedPages.length > 0) {
      const resumePageIndex =
        threadFirstPageIndex.get(threads[maxResults]!.id) ??
        fetchedPages.length - 1;
      const resumePage = fetchedPages[resumePageIndex];
      const skipThreadIds = threads
        .slice(0, maxResults)
        .filter(
          (thread) => threadFirstPageIndex.get(thread.id) === resumePageIndex,
        )
        .map((thread) => thread.id);

      nextPageToken = skipThreadIds.length
        ? encodeOutlookThreadPageToken({
            pageToken: resumePage?.pageToken,
            skipThreadIds,
          })
        : resumePage?.pageToken;
    }

    threads = threads.slice(0, maxResults);

    if (options.messageFormat === "metadata") {
      threads = await addOutlookThreadParticipantMessages({
        client: this.client,
        threads,
        logger: this.logger,
      });
    }

    return {
      threads,
      nextPageToken,
    };
  }

  async searchThreads(options: {
    query: string;
    maxResults?: number;
    pageToken?: string;
    messageFormat?: "full" | "metadata";
    includeSpamTrash?: boolean;
    folder?: "spam" | "trash";
    labelIds?: string[];
  }): Promise<{
    threads: EmailThread[];
    nextPageToken?: string;
  }> {
    const compiled = withOutlookSpamTrashFolder(
      compileOutlookThreadSearch(options.query),
      options.folder ?? spamTrashFolderFromLabels(options.labelIds),
    );
    if (isEmptyOutlookSearch(compiled)) return { threads: [] };

    const client = this.client.getClient();
    const [folderIds, categoryMap] = await Promise.all([
      getFolderIds(this.client, this.logger, { includeDrafts: true }),
      getCategoryMap(this.client, this.logger),
    ]);

    const folderId = await resolveOutlookSearchFolderId({
      compiled,
      folderIds,
      getFolders: () => this.getFolders(),
    });
    if ((compiled.folderKey || compiled.folderName) && !folderId) {
      return { threads: [] };
    }

    const apiPath = folderId
      ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages`
      : "/me/messages";
    const selectFields =
      options.messageFormat === "metadata"
        ? MESSAGE_LIST_SELECT_FIELDS
        : MESSAGE_SELECT_FIELDS;

    const requiredLabelIds: string[] = [];
    if (compiled.search) {
      if (compiled.flagged) requiredLabelIds.push(OutlookLabel.STARRED);
      if (compiled.category) {
        requiredLabelIds.push(
          categoryMap.get(compiled.category) ?? compiled.category,
        );
      }
    }

    const maxResults = options.maxResults || 25;
    const needsLocalScopeFilter = requiredLabelIds.length > 0;
    const collectedMessages: Message[] = [];
    let nextPageTokenToFetch = options.pageToken;
    let nextPageToken: string | undefined;

    do {
      const pageLink = resolveMicrosoftGraphNextLink(nextPageTokenToFetch);
      const response: { value: Message[]; "@odata.nextLink"?: string } =
        pageLink
          ? await client.api(pageLink).get()
          : await fetchOutlookSearchPage({
              client,
              apiPath,
              selectFields,
              compiled,
              maxResults,
            });

      collectedMessages.push(...response.value);
      nextPageToken = response["@odata.nextLink"];

      if (!needsLocalScopeFilter || !nextPageToken) break;

      const matchedThreads = buildOutlookThreadsFromMessages({
        messages: collectedMessages,
        folderIds,
        categoryMap,
        excludedLabelIds: new Set(),
        requiredLabelIds,
        logger: this.logger,
      });
      if (matchedThreads.length >= maxResults) break;

      nextPageTokenToFetch = nextPageToken;
    } while (nextPageTokenToFetch);

    let threads = buildOutlookThreadsFromMessages({
      messages: collectedMessages,
      folderIds,
      categoryMap,
      excludedLabelIds: new Set(),
      requiredLabelIds: requiredLabelIds.length ? requiredLabelIds : undefined,
      logger: this.logger,
    }).slice(0, maxResults);

    if (options.messageFormat === "metadata") {
      threads = await addOutlookThreadParticipantMessages({
        client: this.client,
        threads,
        logger: this.logger,
      });
    }

    return { threads, nextPageToken };
  }

  async hasPreviousCommunicationsWithSenderOrDomain(options: {
    from: string;
    date: Date;
    messageId: string;
  }): Promise<boolean> {
    // 使用共享逻辑：公共域按完整邮箱搜索，公司域按域搜索
    const searchTerm = getSearchTermForSender(options.from);
    const isFullEmail = searchTerm.includes("@");

    const dateString = options.date.toISOString();

    // 对于域匹配，使用 $search 而不是 $filter，因为 endsWith 有局限性
    // 对于精确邮箱匹配，使用带 eq 的 $filter（电子邮件地址不区分大小写）
    if (!isFullEmail) {
      // 基于域的搜索——发送和接收都使用 $search
      const escapedKqlDomain = searchTerm
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');

      const [sentResponse, receivedResponse] = await Promise.all([
        this.client
          .getClient()
          .api("/me/messages")
          .search(`"to:@${escapedKqlDomain}"`)
          .top(5)
          .select("id,sentDateTime")
          .get(),

        this.client
          .getClient()
          .api("/me/messages")
          .search(`"from:@${escapedKqlDomain}"`)
          .top(5)
          .select("id,receivedDateTime")
          .get(),
      ]);

      // 按日期过滤，因为 $search 不能很好地支持日期过滤
      const validSentMessages = (sentResponse.value || []).filter(
        (msg: Message) => {
          if (!msg.sentDateTime) return false;
          return new Date(msg.sentDateTime) < options.date;
        },
      );

      const validReceivedMessages = (receivedResponse.value || []).filter(
        (msg: Message) => {
          if (!msg.receivedDateTime) return false;
          return new Date(msg.receivedDateTime) < options.date;
        },
      );

      const messages = [...validSentMessages, ...validReceivedMessages];
      return messages.some((message) => message.id !== options.messageId);
    }

    // 完整邮箱搜索——接收使用 $filter，发送使用 $search
    const escapedSearchTerm = escapeODataString(searchTerm);
    const receivedFilter = `from/emailAddress/address eq '${escapedSearchTerm}' and receivedDateTime lt ${dateString}`;

    // 对已发送邮件使用 $search，因为对 toRecipients 使用 $filter 不可靠
    const escapedKqlSearchTerm = searchTerm
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const sentSearch = `"to:${escapedKqlSearchTerm}"`;

    const [sentResponse, receivedResponse] = await Promise.all([
      this.client
        .getClient()
        .api("/me/messages")
        .search(sentSearch)
        .top(5) // Increase top to account for potential future messages we filter out
        .select("id,sentDateTime")
        .get(),

      this.client
        .getClient()
        .api("/me/messages")
        .filter(receivedFilter)
        .top(2)
        .select("id")
        .get(),
    ]);

    // 按日期过滤已发送邮件，因为 $search 不能很好地支持日期过滤
    const validSentMessages = (sentResponse.value || []).filter(
      (msg: Message) => {
        if (!msg.sentDateTime) return false;
        return new Date(msg.sentDateTime) < options.date;
      },
    );

    const messages = [...validSentMessages, ...(receivedResponse.value || [])];

    return messages.some((message) => message.id !== options.messageId);
  }

  async getThreadsFromSenderWithSubject(
    sender: string,
    limit: number,
  ): Promise<Array<{ id: string; snippet: string; subject: string }>> {
    return getThreadsFromSenderWithSubject(
      this.client,
      sender,
      limit,
      this.logger,
    );
  }

  async watchEmails(): Promise<{
    expirationDate: Date;
    subscriptionId?: string;
  } | null> {
    const subscription = await watchOutlook(
      this.client.getClient(),
      this.logger,
    );

    if (subscription.expirationDateTime) {
      const expirationDate = new Date(subscription.expirationDateTime);
      return {
        expirationDate,
        subscriptionId: subscription.id,
      };
    }
    return null;
  }

  async unwatchEmails(subscriptionId?: string): Promise<void> {
    if (!subscriptionId) {
      this.logger.warn("未为 Outlook 取消监控提供订阅 ID");
      return;
    }
    await unwatchOutlook(this.client.getClient(), subscriptionId, this.logger);
  }

  isReplyInThread(message: ParsedMessage): boolean {
    try {
      return atob(message.conversationIndex || "").length > 22;
    } catch (error) {
      this.logger.warn("无效的 conversationIndex base64", {
        conversationIndex: message.conversationIndex,
        error,
      });
      return false;
    }
  }

  // 我们会提前在内部进行映射，以便其按预期工作
  isSentMessage(message: ParsedMessage): boolean {
    return message.labelIds?.includes("SENT") || false;
  }

  async moveThreadToFolder(
    threadId: string,
    ownerEmail: string,
    folderId: string,
  ): Promise<void> {
    await archiveThread({
      client: this.client,
      threadId,
      ownerEmail,
      actionSource: "automation",
      folderId,
      logger: this.logger,
    });
  }

  async archiveMessage(messageId: string): Promise<void> {
    try {
      await this.client.getClient().api(`/me/messages/${messageId}/move`).post({
        destinationId: "archive",
      });

      this.logger.info("邮件归档成功", {
        messageId,
      });
    } catch (error) {
      this.logger.error("归档邮件失败", {
        messageId,
        error,
      });
      throw error;
    }
  }

  async archiveMessages(
    messageIds: string[],
    _labelId?: string,
  ): Promise<void> {
    await this.moveMessageSnapshots(messageIds, "archive");
  }

  async unarchiveMessages(messageIds: string[]): Promise<void> {
    await this.moveMessageSnapshots(messageIds, "inbox");
  }

  async trashMessages(messageIds: string[]): Promise<void> {
    await this.moveMessageSnapshots(messageIds, "deleteditems");
  }

  async untrashMessages(messageIds: string[]): Promise<void> {
    await this.moveMessageSnapshots(messageIds, "inbox");
  }

  async markMessagesStarredState(
    messageIds: string[],
    starred: boolean,
  ): Promise<void> {
    await mapWithConcurrency([...new Set(messageIds)], 4, async (messageId) => {
      try {
        await markStarredMessage({
          client: this.client,
          messageId,
          starred,
          logger: this.logger,
        });
      } catch (error) {
        if (extractErrorInfo(error).status !== 404) throw error;
      }
    });
  }

  async markMessagesReadState(
    messageIds: string[],
    read: boolean,
  ): Promise<void> {
    await mapWithConcurrency([...new Set(messageIds)], 4, async (messageId) => {
      try {
        await withMicrosoftGraphWriteRetry(
          () =>
            this.client
              .getClient()
              .api(`/me/messages/${messageId}`)
              .patch({ isRead: read }),
          this.logger,
        );
      } catch (error) {
        if (extractErrorInfo(error).status !== 404) throw error;
      }
    });
  }

  private async moveMessageSnapshots(
    messageIds: string[],
    destinationId: "archive" | "deleteditems" | "inbox",
  ) {
    await mapWithConcurrency([...new Set(messageIds)], 4, async (messageId) => {
      try {
        await withMicrosoftGraphWriteRetry(
          () =>
            this.client
              .getClient()
              .api(`/me/messages/${messageId}/move`)
              .post({ destinationId }),
          this.logger,
        );
      } catch (error) {
        if (extractErrorInfo(error).status !== 404) throw error;
      }
    });
  }

  async bulkArchiveFromSenders(
    fromEmails: string[],
    ownerEmail: string,
    emailAccountId: string,
  ): Promise<void> {
    await moveMessagesForSenders({
      client: this.client,
      senders: fromEmails,
      destinationId: "archive",
      action: "archive",
      ownerEmail,
      emailAccountId,
      logger: this.logger,
    });
  }

  async bulkArchiveSenderOrThrow(
    fromEmail: string,
    ownerEmail: string,
    emailAccountId: string,
  ): Promise<number> {
    return moveMessagesForSenders({
      client: this.client,
      senders: [fromEmail],
      destinationId: "archive",
      action: "archive",
      ownerEmail,
      emailAccountId,
      logger: this.logger,
      continueOnError: false,
    });
  }

  async bulkTrashFromSenders(
    fromEmails: string[],
    ownerEmail: string,
    emailAccountId: string,
  ): Promise<void> {
    await moveMessagesForSenders({
      client: this.client,
      senders: fromEmails,
      destinationId: "deleteditems",
      action: "trash",
      ownerEmail,
      emailAccountId,
      logger: this.logger,
    });
  }

  async getOrCreateFolderIdByName(folderName: string): Promise<string> {
    return await getOrCreateOutlookFolderIdByName(
      this.client,
      folderName,
      this.logger,
    );
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    await renameOutlookFolder(this.client, folderId, name, this.logger);
  }

  async deleteFolder(folderId: string): Promise<void> {
    await deleteOutlookFolder(this.client, folderId, this.logger);
  }

  async getFolders() {
    const [folders, folderIds] = await Promise.all([
      getOutlookFolderTree(this.client, undefined, this.logger),
      getFolderIds(this.client, this.logger),
    ]);
    return addOutlookSystemFolderTypes(folders, folderIds);
  }

  async getForwardingAddresses(): Promise<string[]> {
    // Graph 没有与 Gmail 已验证转发地址列表对应的功能
    return [];
  }

  async getFolderCounts(): Promise<EmailFolderCount[]> {
    const folders = await this.getFolders();
    return flattenOutlookFolders(folders).map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      total: folder.totalItemCount ?? 0,
      unread: folder.unreadItemCount ?? 0,
      systemType: folder.systemType,
    }));
  }

  // Graph 无法列出邮箱可能从中发送的别名，且从别名发送
  // 取决于租户设置，因此 Outlook 邮件始终使用账号地址。
  async getSendAsAddresses(): Promise<SendAsAddress[]> {
    return [];
  }

  async getSignatures(): Promise<EmailSignature[]> {
    // Microsoft Graph API 目前不支持通过 API 获取签名
    // https://learn.microsoft.com/en-my/answers/questions/1093518/user-email-signature-management-via-graph-api
    // 因此我们改为从近期已发送邮件中提取

    try {
      const sentMessages = await this.getSentMessages(5);

      for (const message of sentMessages) {
        if (!message.textHtml) continue;

        const signature = extractSignatureFromHtml(message.textHtml);
        if (signature) {
          // 返回我们找到的第一个签名
          return [
            {
              email: message.headers.from,
              signature,
              isDefault: true,
              displayName: message.headers.from,
            },
          ];
        }
      }

      this.logger.info("在近期已发送邮件中未找到签名");
      return [];
    } catch (error) {
      this.logger.error("从已发送邮件中提取签名失败", {
        error,
      });
      return [];
    }
  }

  async getInboxStats(): Promise<{ total: number; unread: number }> {
    const folder = await withMicrosoftGraphRetry(
      () =>
        this.client
          .getClient()
          .api("/me/mailFolders/inbox")
          .select("totalItemCount,unreadItemCount")
          .get(),
      this.logger,
    );
    return {
      total: folder.totalItemCount ?? 0,
      unread: folder.unreadItemCount ?? 0,
    };
  }
}

// 将 OutlookLabel 名称（例如 "INBOX"）映射到 getFolderIds() 中使用的 WELL_KNOWN_FOLDERS 键
const LABEL_TO_FOLDER_KEY: Record<string, string> = {
  INBOX: "inbox",
  SENT: "sentitems",
  DRAFT: "drafts",
  ARCHIVE: "archive",
  TRASH: "deleteditems",
  SPAM: "junkemail",
};

function resolveOutlookFolderId(
  labelId: string,
  folderIds: Record<string, string>,
): string | undefined {
  const folderKey = LABEL_TO_FOLDER_KEY[labelId.toUpperCase()];
  return folderKey ? folderIds[folderKey] : undefined;
}

function filterMessagesForParticipant(
  messages: ParsedMessage[],
  participantLower: string,
): ParsedMessage[] {
  return messages.filter((message) => {
    const headers = message.headers;

    const fromEmail = extractEmailAddress(headers.from || "").toLowerCase();
    if (fromEmail === participantLower) return true;

    const toAddresses = splitRecipientList(headers.to || "")
      .map((addr) => extractEmailAddress(addr).toLowerCase())
      .filter(Boolean);
    if (toAddresses.includes(participantLower)) return true;

    const ccAddresses = splitRecipientList(headers.cc || "")
      .map((addr) => extractEmailAddress(addr).toLowerCase())
      .filter(Boolean);
    if (ccAddresses.includes(participantLower)) return true;

    return false;
  });
}

function getUniqueThreadIds(
  messages: ParsedMessage[],
  maxThreads: number,
): string[] {
  return Array.from(
    new Set(messages.map((message) => message.threadId).filter(Boolean)),
  ).slice(0, maxThreads);
}

function getRequiredOutlookThreadLabelIds({
  labelId,
  labelIds,
  type,
}: Pick<ThreadsQuery, "labelId" | "labelIds" | "type">): string[] | undefined {
  if (labelIds?.length) return labelIds;
  if (labelId) return [labelId];

  switch (type) {
    case "all":
      return;
    case "archive":
      return ["ARCHIVE"];
    case "draft":
      return ["DRAFT"];
    case "sent":
      return ["SENT"];
    case "spam":
      return ["SPAM"];
    case "starred":
      return ["STARRED"];
    case "trash":
      return ["TRASH"];
    case "unread":
      return ["UNREAD"];
    case "inbox":
    case undefined:
    case null:
    case "undefined":
    case "null":
      return ["INBOX"];
    default:
      return [type];
  }
}

function getDefaultOutlookThreadFolderFilter({
  folderIds,
  type,
}: {
  folderIds: Record<string, string>;
  type?: string | null;
}): string | undefined {
  switch (type) {
    case "all": {
      const folderClauses: string[] = [];
      if (folderIds.inbox) {
        folderClauses.push(
          `parentFolderId eq '${escapeODataString(folderIds.inbox)}'`,
        );
      }
      if (folderIds.archive) {
        folderClauses.push(
          `parentFolderId eq '${escapeODataString(folderIds.archive)}'`,
        );
      }
      return folderClauses.length > 0
        ? `(${folderClauses.join(" or ")})`
        : undefined;
    }
    case "archive":
      return folderIds.archive
        ? `parentFolderId eq '${escapeODataString(folderIds.archive)}'`
        : undefined;
    case "draft":
      return folderIds.drafts
        ? `parentFolderId eq '${escapeODataString(folderIds.drafts)}'`
        : undefined;
    case "spam":
      return folderIds.junkemail
        ? `parentFolderId eq '${escapeODataString(folderIds.junkemail)}'`
        : undefined;
    case "trash":
      return folderIds.deleteditems
        ? `parentFolderId eq '${escapeODataString(folderIds.deleteditems)}'`
        : undefined;
    case "unread":
    case "inbox":
    case undefined:
    case null:
    case "undefined":
    case "null":
      return folderIds.inbox
        ? `parentFolderId eq '${escapeODataString(folderIds.inbox)}'`
        : undefined;
    default:
      return;
  }
}

function getExcludedOutlookThreadLabelIds(
  excludeLabelNames: string[] | null | undefined,
  categoryMap?: Map<string, string>,
): Set<string> {
  const excludedLabels = new Set<string>();
  if (!excludeLabelNames?.length) return excludedLabels;

  const categoryEntries = Array.from(categoryMap?.entries() || []);

  for (const labelName of excludeLabelNames) {
    const trimmedLabelName = labelName.trim();
    if (!trimmedLabelName) continue;

    excludedLabels.add(trimmedLabelName);
    excludedLabels.add(trimmedLabelName.toUpperCase());

    for (const [categoryName, categoryId] of categoryEntries) {
      if (categoryName.toLowerCase() === trimmedLabelName.toLowerCase()) {
        excludedLabels.add(categoryId);
      }
    }
  }

  return excludedLabels;
}

function shouldFetchOutlookCategoryMap({
  excludeLabelNames,
  requiredLabelIds,
  folderIds,
}: {
  excludeLabelNames: string[] | null | undefined;
  requiredLabelIds: string[] | undefined;
  folderIds?: Record<string, string>;
}): boolean {
  if (excludeLabelNames?.length) return true;
  if (!requiredLabelIds?.length) return false;

  return requiredLabelIds.some(
    (labelId) => !isOutlookFolderBackedLabelId(labelId, folderIds),
  );
}

function doesOutlookThreadLabelRequireFolderIds(labelId: string): boolean {
  return (
    labelId === "INBOX" ||
    labelId === "SENT" ||
    labelId === "ARCHIVE" ||
    labelId === "TRASH" ||
    labelId === "SPAM"
  );
}

function isOutlookFolderBackedLabelId(
  labelId: string,
  folderIds?: Record<string, string>,
): boolean {
  if (doesOutlookThreadLabelRequireFolderIds(labelId)) return true;
  return folderIds ? Object.values(folderIds).includes(labelId) : false;
}

function messageHasAllThreadLabels(
  message: Pick<ParsedMessage, "labelIds">,
  requiredLabelIds: string[],
): boolean {
  if (!requiredLabelIds.length) return true;

  const messageLabelIds = new Set(message.labelIds || []);
  return requiredLabelIds.every((labelId) => messageLabelIds.has(labelId));
}

function messageHasAnyThreadLabel(
  message: Pick<ParsedMessage, "labelIds">,
  labelIds: Set<string>,
): boolean {
  if (!message.labelIds?.length || labelIds.size === 0) return false;
  return message.labelIds.some((labelId) => labelIds.has(labelId));
}

async function resolveOutlookThreadQueryFilter({
  client,
  folderIds,
  labelId,
  logger,
}: {
  client: OutlookClient;
  folderIds: Record<string, string>;
  labelId: string;
  logger: Logger;
}): Promise<string | undefined> {
  const resolvedFolderId = resolveOutlookFolderId(labelId, folderIds);
  if (resolvedFolderId) {
    return `parentFolderId eq '${escapeODataString(resolvedFolderId)}'`;
  }

  if (Object.values(folderIds).includes(labelId)) {
    return `parentFolderId eq '${escapeODataString(labelId)}'`;
  }

  try {
    const label = await getLabelById({ client, id: labelId });
    if (label.displayName) {
      return `categories/any(c:c eq '${escapeODataString(label.displayName)}')`;
    }
    logger.warn("Outlook 标签查询未返回 displayName", {
      labelId,
    });
    return;
  } catch (error) {
    logger.warn("解析 Outlook 类别过滤器失败", {
      labelId,
      error,
    });
    return;
  }
}

function buildOutlookThreadsFromMessages({
  messages,
  fromEmail,
  folderIds,
  categoryMap,
  excludedLabelIds,
  requiredLabelIds,
  logger,
}: {
  messages: Message[];
  fromEmail?: string | null;
  folderIds: Record<string, string>;
  categoryMap?: Map<string, string>;
  excludedLabelIds: Set<string>;
  requiredLabelIds?: string[];
  logger: Logger;
}): EmailThread[] {
  const sortedMessages = fromEmail
    ? [...messages].sort(
        (a, b) =>
          new Date(b.receivedDateTime || 0).getTime() -
          new Date(a.receivedDateTime || 0).getTime(),
      )
    : messages;

  const messagesByThread = new Map<string, Message[]>();

  for (const message of sortedMessages) {
    if (!message.conversationId) {
      logger.warn("邮件缺少 conversationId", {
        messageId: message.id,
      });
      continue;
    }

    const threadMessages = messagesByThread.get(message.conversationId) || [];
    threadMessages.push(message);
    messagesByThread.set(message.conversationId, threadMessages);
  }

  return Array.from(messagesByThread.entries())
    .filter(([_threadId, threadMessages]) => threadMessages.length > 0)
    .map(([threadId, threadMessages]) => {
      const parsedMessages = threadMessages.map((message) =>
        convertMessage(message, folderIds, categoryMap, logger),
      );

      return {
        id: threadId,
        messages: parsedMessages,
        snippet: parsedMessages[0]?.snippet || "",
      };
    })
    .filter((thread) => {
      if (
        excludedLabelIds.size > 0 &&
        thread.messages.some((message) =>
          messageHasAnyThreadLabel(message, excludedLabelIds),
        )
      ) {
        return false;
      }

      if (!requiredLabelIds?.length) return true;

      return thread.messages.some((message) =>
        messageHasAllThreadLabels(message, requiredLabelIds),
      );
    });
}

async function addOutlookThreadParticipantMessages({
  client,
  threads,
  logger,
}: {
  client: OutlookClient;
  threads: EmailThread[];
  logger: Logger;
}): Promise<EmailThread[]> {
  try {
    const messagesByThreadId = await getThreadParticipantMessagesInBatches({
      client,
      threadIds: threads.map((thread) => thread.id),
      logger,
    });

    return threads.map((thread) => {
      const messages = messagesByThreadId.get(thread.id);
      if (!messages?.length) return thread;

      const participantMessages = [...messages]
        .sort(
          (left, right) =>
            new Date(left.receivedDateTime || 0).getTime() -
            new Date(right.receivedDateTime || 0).getTime(),
        )
        .map((message) => {
          const { from, to } = convertMessage(message).headers;
          return { headers: { from, to } };
        });

      return { ...thread, participantMessages };
    });
  } catch (error) {
    logger.warn("水合 Outlook 会话参与者失败", {
      error,
      threadCount: threads.length,
    });
    return threads;
  }
}

async function ensureOutlookRequiredCategoryMap({
  client,
  logger,
  requiredLabelIds,
  folderIds,
  categoryMap,
}: {
  client: OutlookClient;
  logger: Logger;
  requiredLabelIds?: string[];
  folderIds: Record<string, string>;
  categoryMap?: Map<string, string>;
}): Promise<{
  categoryMap?: Map<string, string>;
  unresolvedRequiredLabelIds: string[];
}> {
  if (!requiredLabelIds?.length) {
    return {
      categoryMap,
      unresolvedRequiredLabelIds: [],
    };
  }

  const missingCategoryIds = requiredLabelIds.filter(
    (labelId) =>
      !isOutlookFolderBackedLabelId(labelId, folderIds) &&
      !Array.from(categoryMap?.values() || []).includes(labelId),
  );

  if (!missingCategoryIds.length) {
    return {
      categoryMap,
      unresolvedRequiredLabelIds: [],
    };
  }

  const resolvedCategoryMap = new Map(categoryMap?.entries() || []);
  const unresolvedRequiredLabelIds: string[] = [];

  for (const labelId of missingCategoryIds) {
    try {
      const label = await getLabelById({ client, id: labelId });
      if (label.displayName) {
        resolvedCategoryMap.set(label.displayName, labelId);
      } else {
        logger.warn("Outlook 必需的类别没有 displayName", {
          labelId,
        });
        unresolvedRequiredLabelIds.push(labelId);
      }
    } catch (error) {
      logger.warn("解析 Outlook 必需类别失败", {
        labelId,
        error,
      });
      unresolvedRequiredLabelIds.push(labelId);
    }
  }

  return {
    categoryMap:
      resolvedCategoryMap.size > 0 ? resolvedCategoryMap : categoryMap,
    unresolvedRequiredLabelIds,
  };
}

const OUTLOOK_THREAD_PAGE_TOKEN_PREFIX = "outlook-threads:";

type OutlookThreadPageToken = {
  pageToken?: string;
  skipThreadIds: string[];
};

function encodeOutlookThreadPageToken(token: OutlookThreadPageToken): string {
  return `${OUTLOOK_THREAD_PAGE_TOKEN_PREFIX}${Buffer.from(
    JSON.stringify(token),
  ).toString("base64url")}`;
}

function parseOutlookThreadPageToken(
  pageToken?: string,
): OutlookThreadPageToken | undefined {
  if (!pageToken?.startsWith(OUTLOOK_THREAD_PAGE_TOKEN_PREFIX)) {
    return;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(
        pageToken.slice(OUTLOOK_THREAD_PAGE_TOKEN_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    ) as Partial<OutlookThreadPageToken>;

    return {
      pageToken: parsed.pageToken,
      skipThreadIds: Array.isArray(parsed.skipThreadIds)
        ? parsed.skipThreadIds.filter(
            (threadId): threadId is string => typeof threadId === "string",
          )
        : [],
    };
  } catch {
    return;
  }
}

// Graph 需要每个收件人一个条目。调用方传入与 Gmail RFC-822 路径
// 相同的逗号分隔字符串，因此将其拆分，而不是把整个列表
// 作为单个格式错误的地址发送。
function toGraphRecipients(to: string, logger: Logger) {
  const candidates = splitRecipientList(to);
  const parsed = candidates.map((candidate) => ({
    candidate,
    email: extractEmailAddress(candidate),
  }));
  const recipients = parsed
    .filter(({ email }) => email.length > 0)
    .map(({ email }) => ({ emailAddress: { address: email } }));

  if (candidates.length > 0 && recipients.length === 0) {
    throw new Error("没有有效的收件人电子邮件地址");
  }

  // 格式错误的参与者会被丢弃，而不是让整个草稿失败：用户
  // 在发送前会审阅草稿，因此缺少收件人可恢复，
  // 而缺少草稿则不可恢复。
  const dropped = parsed.filter(({ email }) => email.length === 0);
  if (dropped.length > 0) {
    logger.warn("丢弃了没有可解析电子邮件地址的收件人", {
      droppedCount: dropped.length,
    });
    logger.trace("Dropped malformed recipients", {
      dropped: dropped.map(({ candidate }) => candidate),
    });
  }

  return recipients;
}

function mapOutlookPresetColor(
  preset: string | null | undefined,
): EmailLabel["color"] {
  const backgroundColor =
    preset && OUTLOOK_COLOR_MAP[preset as keyof typeof OUTLOOK_COLOR_MAP];
  if (!backgroundColor) return;
  return { backgroundColor, textColor: null };
}

async function resolveOutlookSearchFolderId({
  compiled,
  folderIds,
  getFolders,
}: {
  compiled: CompiledOutlookSearch;
  folderIds: Record<string, string>;
  getFolders: () => ReturnType<OutlookProvider["getFolders"]>;
}): Promise<string | undefined> {
  if (compiled.folderKey) return folderIds[compiled.folderKey];
  if (!compiled.folderName) return;

  const folders = flattenOutlookFolders(await getFolders());
  const normalized = compiled.folderName.toLowerCase();
  const byPath = folders.find(
    (folder) => folder.path.toLowerCase() === normalized,
  );
  if (byPath) return byPath.id;

  const byName = folders.filter(
    (folder) => folder.displayName.toLowerCase() === normalized,
  );
  if (byName.length === 1) return byName[0].id;
}

async function fetchOutlookSearchPage({
  client,
  apiPath,
  selectFields,
  compiled,
  maxResults,
}: {
  client: ReturnType<OutlookClient["getClient"]>;
  apiPath: string;
  selectFields: string;
  compiled: CompiledOutlookSearch;
  maxResults?: number;
}): Promise<{ value: Message[]; "@odata.nextLink"?: string }> {
  // Graph 禁止将 $search 与 $filter/$orderby 组合使用，并将页大小限制为 25。
  let request = client.api(apiPath).select(selectFields);
  if (compiled.search) {
    request = request.search(compiled.search);
  } else {
    const filters: string[] = [];
    if (compiled.flagged) filters.push("flag/flagStatus eq 'flagged'");
    if (compiled.category) {
      filters.push(
        `categories/any(c:c eq '${escapeODataString(compiled.category)}')`,
      );
    }
    if (filters.length) request = request.filter(filters.join(" and "));
  }

  return request.top(Math.min(maxResults || 25, 25)).get();
}

function spamTrashFolderFromLabels(
  labelIds: string[] | undefined,
): "spam" | "trash" | undefined {
  if (labelIds?.includes("SPAM")) return "spam";
  if (labelIds?.includes("TRASH")) return "trash";
}

function withOutlookSpamTrashFolder(
  compiled: CompiledOutlookSearch,
  folder: "spam" | "trash" | undefined,
): CompiledOutlookSearch {
  if (!folder || compiled.folderKey || compiled.folderName) return compiled;
  return {
    ...compiled,
    folderKey: folder === "spam" ? "junkemail" : "deleteditems",
  };
}

async function outlookSpamTrashFolderId({
  client,
  logger,
  folder,
}: {
  client: OutlookClient;
  logger: Logger;
  folder?: "spam" | "trash";
}) {
  if (!folder) return;
  const folderIds = await getFolderIds(client, logger);
  return folder === "spam" ? folderIds.junkemail : folderIds.deleteditems;
}
