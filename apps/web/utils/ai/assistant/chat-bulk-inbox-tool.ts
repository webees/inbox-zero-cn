import { type InferUITool, tool } from "ai";
import { z } from "zod";
import {
  gmailSearchQuerySchema,
  outlookSearchFilterFields,
  resolveThreadLabel,
} from "@/utils/ai/assistant/chat-inbox-tools";
import { hideToolErrorFromUser } from "@/utils/ai/assistant/tool-error-visibility";
import type {
  BulkInboxActionSearch,
  BulkInboxActionType,
} from "@/utils/bulk-inbox-action/validation";
import { searchBulkInboxActionPage } from "@/utils/bulk-inbox-action/search";
import { createEmailProvider } from "@/utils/email/provider";
import { isGoogleProvider } from "@/utils/email/provider-types";
import type { Logger } from "@/utils/logger";
import { posthogCaptureEvent } from "@/utils/posthog";
import { aiFilterEmailsForBulkAction } from "@/utils/ai/bulk-inbox-action/filter-emails";
import type { ParsedMessage } from "@/utils/types";
import { getEmailAccountWithAi } from "@/utils/user/get";

const ESTIMATE_PAGE_SIZE = 50;
const ESTIMATE_MAX_PAGES = 3;
const SAMPLE_COUNT = 5;
// One economy call on the first matches previews what the instruction keeps.
const PREVIEW_FILTER_SIZE = 25;

const instructionSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .describe(
    'Optional plain-language test each matching email must pass, such as "newsletters I never read". AI judges every email against it and only acts on those that pass. Use it when the search alone cannot express which emails qualify; omit it when every search match should be acted on.',
  );

const gmailBulkInboxInputSchema = z.object({
  query: gmailSearchQuerySchema
    .min(1)
    .describe(
      "Gmail search query selecting the emails, with the same syntax as searchInbox. Include in:inbox when the cleanup is about the inbox.",
    ),
  action: z
    .enum([
      "archive_threads",
      "trash_threads",
      "mark_read_threads",
      "label_threads",
    ])
    .describe(
      "Action applied to every matching thread. label_threads applies an existing label.",
    ),
  labelName: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Exact existing Gmail label name. Required for label_threads; omit for other actions.",
    ),
  instruction: instructionSchema,
});

const outlookBulkInboxInputSchema = z
  .object({
    ...outlookSearchFilterFields,
    action: z
      .enum([
        "archive_threads",
        "trash_threads",
        "mark_read_threads",
        "categorize_threads",
      ])
      .describe(
        "Action applied to every matching thread. categorize_threads applies an existing category.",
      ),
    applyCategoryName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Exact existing Outlook category to apply. Required for categorize_threads; omit for other actions. categoryName only filters the search.",
      ),
    instruction: instructionSchema,
  })
  .refine(
    (value) =>
      Boolean(
        value.query ||
          value.fromEmail ||
          value.readState ||
          value.categoryName ||
          value.folderName,
      ),
    {
      message:
        "必须提供 query、fromEmail、readState、categoryName 或 folderName 中的至少一项",
    },
  );

type BulkInboxToolOptions = {
  email: string;
  emailAccountId: string;
  provider: string;
  logger: Logger;
};

const description = (searchToolTerms: string) =>
  `以后台任务方式，对所有搜索结果页中匹配搜索条件的每封邮件执行同一个操作。当清理范围超过一页搜索结果或涉及某类"全部"邮件时，请使用此工具，而不是分页调用 searchInbox 再调用 manageInbox。对于已经找到的少量邮件，请使用 manageInbox。

调用前请先搜索，确认${searchToolTerms}返回的是目标邮件，并向用户询问任何不明确之处。当仅靠搜索无法区分符合条件的邮件时，请添加 instruction。仅在用户明确要求删除或移至废纸篓时使用 trash_threads。

调用此工具时不会产生任何更改：它会向用户显示一张包含预估数量和示例的卡片，用户需在该卡片中确认后任务才会开始。确认后，任务的进度和总数会出现在后续上下文中；请报告这些数字，而不是预估值。`;

const gmailBulkInboxTool = (options: BulkInboxToolOptions) =>
  tool({
    description: description("query"),
    inputSchema: gmailBulkInboxInputSchema,
    execute: async (input) =>
      prepareBulkInboxAction({
        options,
        search: { query: input.query },
        action: input.action,
        labelName: input.labelName,
        instruction: input.instruction,
      }),
  });

const outlookBulkInboxTool = (options: BulkInboxToolOptions) =>
  tool({
    description: description("same filters"),
    inputSchema: outlookBulkInboxInputSchema,
    execute: async (input) =>
      prepareBulkInboxAction({
        options,
        search: {
          query: input.query,
          fromEmail: input.fromEmail,
          readState: input.readState,
          categoryName: input.categoryName,
          folderName: input.folderName,
        },
        action:
          input.action === "categorize_threads"
            ? "label_threads"
            : input.action,
        labelName: input.applyCategoryName,
        instruction: input.instruction,
      }),
  });

export const bulkManageInboxTool = (options: BulkInboxToolOptions) =>
  isGoogleProvider(options.provider)
    ? gmailBulkInboxTool(options)
    : outlookBulkInboxTool(options);

export type BulkManageInboxTool = InferUITool<
  ReturnType<typeof gmailBulkInboxTool>
>;

async function prepareBulkInboxAction({
  options: { email, emailAccountId, provider, logger },
  search,
  action,
  labelName,
  instruction,
}: {
  options: BulkInboxToolOptions;
  search: BulkInboxActionSearch;
  action: BulkInboxActionType;
  labelName?: string;
  instruction?: string;
}) {
  logger.info("正在跟踪工具调用", { tool: "bulk_inbox_action", email });
  posthogCaptureEvent(email, "AI Assistant Chat Tool Call", {
    tool: "bulk_inbox_action",
  });

  if (action === "label_threads" && !labelName) {
    return hideToolErrorFromUser({
      error: isGoogleProvider(provider)
        ? "label_threads 需要 labelName。"
        : "categorize_threads 需要 applyCategoryName。",
    });
  }

  try {
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });

    const label =
      action === "label_threads" && labelName
        ? await resolveThreadLabel({
            emailProvider,
            labelName,
            action,
            // A bulk write must hit exactly the label the user named.
            matchNestedLabels: false,
            missingLabelError: (name) =>
              `“${name}”不存在，如果用户需要，请先创建它。`,
          }).catch((error: unknown) => ({
            error: error instanceof Error ? error.message : "未找到标签",
          }))
        : null;
    if (label && "error" in label) return hideToolErrorFromUser(label);

    const threads: ParsedMessage[] = [];
    const threadIds = new Set<string>();
    let pageToken: string | undefined;
    let hasMore = false;

    for (let pageIndex = 0; pageIndex < ESTIMATE_MAX_PAGES; pageIndex++) {
      const page = await searchBulkInboxActionPage({
        emailProvider,
        provider,
        search,
        pageToken,
        pageSize: ESTIMATE_PAGE_SIZE,
      });

      for (const message of page.messages) {
        if (!message.threadId || threadIds.has(message.threadId)) continue;
        threadIds.add(message.threadId);
        threads.push(message);
      }

      pageToken = page.nextPageToken;
      hasMore = Boolean(pageToken);
      if (!pageToken) break;
    }

    // Filtered Outlook searches can return empty pages before later matches.
    if (threadIds.size === 0 && !hasMore) {
      return {
        success: true,
        estimatedThreadCount: 0,
        message: "没有邮件符合此搜索条件，因此无需执行操作。",
      };
    }

    const preview = instruction
      ? await previewInstruction({
          emailAccountId,
          instruction,
          threads: threads.slice(0, PREVIEW_FILTER_SIZE),
          logger,
        })
      : null;

    if (preview && preview.matches.length === 0) {
      return {
        success: true,
        estimatedThreadCount: 0,
        message: `已检查的 ${preview.checkedCount} 封邮件均不符合“${instruction}”，因此未准备任何操作，也未做任何更改。`,
      };
    }

    const matchingThreads = preview?.matches ?? threads;
    const estimatedThreadCount = preview
      ? Math.max(
          preview.matches.length,
          Math.round(
            (threadIds.size * preview.matches.length) / preview.checkedCount,
          ),
        )
      : threadIds.size;

    return {
      success: true,
      actionType: "bulk_inbox_action" as const,
      requiresConfirmation: true as const,
      confirmationState: "pending" as const,
      pendingAction: {
        search,
        action,
        labelId: label?.labelId ?? null,
        labelName: label?.labelName ?? null,
        instruction: instruction ?? null,
      },
      estimate: {
        threadCount: estimatedThreadCount,
        isApproximate: Boolean(preview),
        // The preview stops after a few pages; the job covers every match.
        isLowerBound: hasMore,
        searchThreadCount: threadIds.size,
      },
      matchSummary: preview?.matchSummary ?? null,
      samples: matchingThreads.slice(0, SAMPLE_COUNT).map((message) => ({
        from: message.headers.from,
        subject: message.headers.subject,
        date: message.date,
      })),
      nextStep:
        "The card shows the details and handles confirmation and progress.",
    };
  } catch (error) {
    logger.error("Failed to prepare bulk inbox action", { error });
    return { error: "Failed to search the inbox for this bulk action." };
  }
}

// Without a working preview the card falls back to the unfiltered search, and
// the job still filters every email.
async function previewInstruction({
  emailAccountId,
  instruction,
  threads,
  logger,
}: {
  emailAccountId: string;
  instruction: string;
  threads: ParsedMessage[];
  logger: Logger;
}) {
  try {
    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
    if (!emailAccount) return null;
    const { matchingIds, matchSummary } = await aiFilterEmailsForBulkAction({
      emailAccount,
      instruction,
      messages: threads,
      describeMatches: true,
    });
    return {
      matches: threads.filter((message) => matchingIds.has(message.id)),
      matchSummary,
      checkedCount: threads.length,
    };
  } catch (error) {
    logger.warn("Failed to preview bulk inbox action instruction", { error });
    return null;
  }
}

/**
 * A pending bulk card is the whole reply: it asks for confirmation and then
 * shows progress, so text after it would only repeat it and go stale.
 */
export function endsWithPendingBulkInboxAction(step: {
  toolResults: Array<{ toolName: string; output: unknown }>;
}) {
  return step.toolResults.some(
    ({ toolName, output }) =>
      toolName === "bulkManageInbox" &&
      typeof output === "object" &&
      output !== null &&
      (output as { requiresConfirmation?: unknown }).requiresConfirmation ===
        true,
  );
}
