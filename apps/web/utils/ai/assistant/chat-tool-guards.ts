import {
  asSchema,
  jsonSchema,
  type ModelMessage,
  type ToolResultPart,
  type ToolSet,
} from "ai";
import isEqual from "lodash/isEqual";
import type { Logger } from "@/utils/logger";
import { getToolFailureMessage } from "@/utils/ai/assistant/chat-response-guard";
import { hideToolErrorFromUser } from "@/utils/ai/assistant/tool-error-visibility";

const MAX_REPORTED_ISSUES = 3;
const EMAIL_ID_FIELDS = ["threadId", "threadIds", "messageId", "messageIds"];
const EMAIL_ID_KEY = /(?:thread|message)Ids?$/i;
const THREAD_ID_KEY = /threadIds?$/i;
const TEXT_TOKEN_SEPARATOR = /[\s"'`<>,;:()[\]{}|]+/;

// Wraps every chat tool so that mistakes the model can fix come back as
// readable tool results instead of opaque SDK errors or repeated side effects.
export function guardChatTools<TTools extends ToolSet>(
  tools: TTools,
  logger: Logger,
  { skipEmailIdCheck = [] }: { skipEmailIdCheck?: string[] } = {},
): TTools {
  const guardedTools: ToolSet = { ...tools };

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const { execute } = toolDefinition;
    if (!execute || !toolDefinition.inputSchema) continue;

    const schema = asSchema(toolDefinition.inputSchema);
    const validate = async (value: unknown) =>
      schema.validate
        ? await schema.validate(value)
        : { success: true as const, value };
    const invalidInputErrors = new WeakMap<object, unknown>();
    const validatedInputs = new WeakSet<object>();

    guardedTools[toolName] = {
      ...toolDefinition,
      // A failed SDK validation hands the model a raw dump of the schema
      // error. Keep the JSON schema the model sees, but let invalid input
      // through to execute so it can return a message the model can act on.
      // Valid input is still replaced by its parsed value, because the SDK
      // stores it as the call's input and later flows replay it.
      inputSchema: jsonSchema(() => schema.jsonSchema, {
        validate: async (value) => {
          const result = await validate(value);
          if (result.success) {
            if (isObject(result.value)) validatedInputs.add(result.value);
            return result;
          }
          if (isObject(value)) invalidInputErrors.set(value, result.error);
          return { success: true, value };
        },
      }),
      execute: async (
        input: unknown,
        options: Parameters<NonNullable<typeof execute>>[1],
      ) => {
        const getValidation = async (value: unknown) => {
          if (isObject(value) && invalidInputErrors.has(value)) {
            return {
              success: false as const,
              error: invalidInputErrors.get(value),
            };
          }
          if (isObject(value) && validatedInputs.has(value)) {
            return { success: true as const, value };
          }
          return validate(value);
        };

        const previousFailure = findPreviousFailureInTurn({
          toolName,
          input,
          messages: options.messages,
        });
        if (previousFailure) {
          logger.warn("Blocked repeat of a failed chat tool call", {
            toolName,
          });
          return hideToolErrorFromUser({
            error: `本次响应中，完全相同的 ${toolName} 调用此前已经失败：${previousFailure} 不要原样重复该调用。请更改输入、尝试其他方法，或告诉用户为什么无法完成。`,
          });
        }

        const validation = await getValidation(input);
        if (!validation.success) {
          logger.warn("Invalid chat tool input", { toolName });
          logger.trace("Invalid chat tool input details", {
            toolName,
            error: validation.error,
          });
          return hideToolErrorFromUser({
            error: formatToolInputError(toolName, validation.error),
          });
        }

        const idProblems = skipEmailIdCheck.includes(toolName)
          ? null
          : findEmailIdProblems(input, options.messages);
        if (idProblems) {
          logger.warn("Rejected chat tool call with unknown email IDs", {
            toolName,
          });
          return hideToolErrorFromUser({
            error: formatEmailIdProblems(toolName, idProblems),
          });
        }

        return execute.call(toolDefinition, validation.value, options);
      },
    };
  }

  return guardedTools as TTools;
}

function formatToolInputError(toolName: string, error: unknown) {
  const issues = getValidationIssues(error);
  if (!issues.length) return `${toolName} 的输入无效`;

  const details = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map(formatValidationIssue)
    .join("; ");

  return `${toolName} 的输入无效：${details}`;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

// 模型可能会错误复制较长的服务商 ID。只有本次对话中已经传给模型的 ID 才可能是真实的，
// 因此其他 ID 都是转写错误。进行精确比较：带有多余空白字符的 ID 会原样传给服务商。
function findEmailIdProblems(input: unknown, messages: ModelMessage[]) {
  if (!isObject(input)) return null;

  const idsToCheck: Array<{ field: string; label: string; id: string }> = [];
  for (const field of EMAIL_ID_FIELDS) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string") {
      idsToCheck.push({ field, label: field, id: value });
    }
    if (Array.isArray(value)) {
      value.forEach((id, index) => {
        if (typeof id === "string") {
          idsToCheck.push({ field, label: `${field}[${index}]`, id });
        }
      });
    }
  }
  if (!idsToCheck.length) return null;

  const { seenIds, threadIds, messageIds } = collectSeenIds(messages);
  const unseen = idsToCheck.filter(({ id }) => !seenIds.has(id));
  // 工具结果只将该 ID 列为消息 ID，却被传到了应填写会话 ID 的位置。归档和垃圾箱会把未知会话
  // 视为已处理，因此否则该操作会“成功”却不做任何更改。
  const messageIdsAsThreads = idsToCheck.filter(
    ({ field, id }) =>
      field.startsWith("threadId") && messageIds.has(id) && !threadIds.has(id),
  );
  if (!unseen.length && !messageIdsAsThreads.length) return null;

  return { unseen, messageIdsAsThreads };
}

function formatEmailIdProblems(
  toolName: string,
  problems: NonNullable<ReturnType<typeof findEmailIdProblems>>,
) {
  const sentences = [`${toolName} 未运行。`];
  if (problems.unseen.length) {
    sentences.push(
      `${problems.unseen.map(({ label }) => label).join(", ")} 未出现在本次对话中任何先前的工具结果或用户消息里，因此可能是输入错误。请从先前结果中精确复制 ID，或重新搜索以获取 ID。`,
    );
  }
  if (problems.messageIdsAsThreads.length) {
    sentences.push(
      `${problems.messageIdsAsThreads.map(({ label }) => label).join(", ")} 是 messageId，而不是 threadId。请使用同一结果中的 threadId。`,
    );
  }
  return sentences.join(" ");
}

function collectSeenIds(messages: ModelMessage[]) {
  const seenIds = new Set<string>();
  const threadIds = new Set<string>();
  const messageIds = new Set<string>();
  const addText = (text: string) => {
    for (const token of text.split(TEXT_TOKEN_SEPARATOR)) {
      if (!token) continue;
      seenIds.add(token);
      seenIds.add(token.replace(/\.+$/, ""));
    }
  };
  const addId = (key: string, id: string) => {
    seenIds.add(id);
    if (THREAD_ID_KEY.test(key)) threadIds.add(id);
    else messageIds.add(id);
  };
  // Only ID fields count: free text in a result, like an email body, could
  // contain an ID-shaped token that was never an ID.
  const addKeyedIds = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(addKeyedIds);
      return;
    }
    if (!isObject(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (!EMAIL_ID_KEY.test(key)) {
        addKeyedIds(entry);
      } else if (typeof entry === "string") {
        addId(key, entry);
      } else if (Array.isArray(entry)) {
        for (const id of entry) if (typeof id === "string") addId(key, id);
      }
    }
  };

  for (const message of messages) {
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result" || getToolResultFailure(part.output))
          continue;
        if (part.output.type === "json") addKeyedIds(part.output.value);
      }
      continue;
    }

    // User and system messages carry hidden email context and UI notes. The
    // model's own text keeps IDs from results that compaction later dropped.
    if (typeof message.content === "string") addText(message.content);
    else
      for (const part of message.content) {
        if (part.type === "text") addText(part.text);
      }
  }

  return { seenIds, threadIds, messageIds };
}

function findPreviousFailureInTurn({
  toolName,
  input,
  messages,
}: {
  toolName: string;
  input: unknown;
  messages: ModelMessage[];
}) {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const turnMessages = messages.slice(turnStart + 1);

  const matchingCallIds = new Set<string>();
  for (const message of turnMessages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (
        part.type === "tool-call" &&
        part.toolName === toolName &&
        isEqual(part.input, input)
      ) {
        matchingCallIds.add(part.toolCallId);
      }
    }
  }
  if (!matchingCallIds.size) return null;

  // A failed call may be repeated once after another tool call succeeds, since
  // that is how the model recovers (refreshing stale rule state, creating a
  // missing label). A second identical failure is always final.
  let firstFailure: string | null = null;
  let failureCount = 0;
  let recoveredSinceFailure = false;
  for (const message of turnMessages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;

      const failure = getToolResultFailure(part.output);
      if (!matchingCallIds.has(part.toolCallId)) {
        if (failureCount && !failure) recoveredSinceFailure = true;
        continue;
      }
      if (!failure || isRetryableFailure(part.output)) continue;

      firstFailure ??= failure;
      failureCount++;
      recoveredSinceFailure = false;
    }
  }

  if (!failureCount) return null;
  if (failureCount === 1 && recoveredSinceFailure) return null;
  return firstFailure;
}

// Some tools (such as Gmail search) flag transient failures as retryable;
// repeating those unchanged is fine.
function isRetryableFailure(output: ToolResultPart["output"]) {
  if (output.type !== "json" || !isObject(output.value)) return false;
  const value = output.value as Record<string, unknown>;
  const feedback = value.searchFeedback;
  return (
    value.retryable === true ||
    (isObject(feedback) &&
      (feedback as Record<string, unknown>).retryable === true)
  );
}

function getToolResultFailure(output: ToolResultPart["output"]) {
  if (output.type === "error-text") return output.value;
  if (output.type === "error-json") return JSON.stringify(output.value);
  if (output.type === "json") return getToolFailureMessage(output.value);
  return null;
}

type ValidationIssue = {
  code?: string;
  path?: PropertyKey[];
  message?: string;
  keys?: string[];
};

function getValidationIssues(error: unknown): ValidationIssue[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues as ValidationIssue[];
  }
  return [];
}

function formatValidationIssue(issue: ValidationIssue) {
  if (issue.code === "unrecognized_keys") {
    const firstKey = issue.keys?.[0];
    return firstKey ? `unsupported field "${firstKey}"` : "unsupported fields";
  }

  const field = (issue.path ?? []).map(String).join(".");
  return field ? `${field} ${issue.message}` : (issue.message ?? "invalid");
}
