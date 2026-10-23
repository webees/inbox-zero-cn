import type { JSONValue, ModelMessage, ToolResultPart } from "ai";
import {
  getToolOutputText,
  truncatePromptContent,
} from "@/utils/ai/assistant/compact";

export const RECENT_TOOL_RESULTS_TO_KEEP = 10;
const UNTRIMMED_RESULT_CHAR_BUDGET = 200_000;
const MIN_TRIMMABLE_RESULT_CHARS = 1000;
const STALE_STRING_CHAR_LIMIT = 500;
const TRIMMED_NOTE =
  "较早的结果已缩短以节省上下文。再次运行工具可查看完整详情。";

// 较长的工具循环会在每一步重新发送所有较早的结果。当未裁剪的输出累积到一定量后，
// 较早的结果会被缩减为模型继续处理所需的内容（标识符和表头）。AI SDK 会向下
// 传递 prepareStep 的消息覆盖设置，而触发条件只统计尚未裁剪的结果，因此缓存的
// 提示词前缀每批只变化一次，而不是每一步都变化。
export function trimStaleToolResults(messages: ModelMessage[]) {
  const results = messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.filter((part) => part.type === "tool-result")
      : [],
  );
  const untrimmedChars = results
    .filter(isTrimmable)
    .reduce((total, part) => total + getToolOutputText(part.output).length, 0);
  if (untrimmedChars <= UNTRIMMED_RESULT_CHAR_BUDGET) return messages;

  const staleResults = new Set(
    results.slice(0, -RECENT_TOOL_RESULTS_TO_KEEP).filter(isTrimmable),
  );
  if (staleResults.size === 0) return messages;

  return messages.map((message): ModelMessage => {
    if (message.role !== "tool") return message;

    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result" && staleResults.has(part)
          ? { ...part, output: trimOutput(part.toolName, part.output) }
          : part,
      ),
    };
  });
}

function isTrimmable(part: ToolResultPart) {
  const { output } = part;
  const canShorten =
    output.type === "text" ||
    output.type === "error-text" ||
    (output.type === "json" &&
      isJsonObject(output.value) &&
      !("trimmedForContext" in output.value));

  return (
    canShorten && getToolOutputText(output).length >= MIN_TRIMMABLE_RESULT_CHARS
  );
}

function trimOutput(
  toolName: string,
  output: ToolResultPart["output"],
): ToolResultPart["output"] {
  if (output.type === "text" || output.type === "error-text") {
    return {
      ...output,
      value: truncatePromptContent(output.value, STALE_STRING_CHAR_LIMIT),
    };
  }

  if (output.type !== "json" || !isJsonObject(output.value)) return output;

  const project = STALE_RESULT_PROJECTIONS[toolName];
  const projected = project?.(output.value) ?? truncateStrings(output.value);

  return {
    ...output,
    value: { ...projected, trimmedForContext: TRIMMED_NOTE },
  };
}

const STALE_RESULT_PROJECTIONS: Record<
  string,
  (value: Record<string, JSONValue>) => Record<string, JSONValue> | null
> = {
  searchInbox: (value) => {
    if (!Array.isArray(value.messages)) return null;

    return {
      ...pick(value, [
        "queryUsed",
        "totalReturned",
        "exactCount",
        "countError",
        "nextPageToken",
        "hasMore",
      ]),
      messages: value.messages.map((message) =>
        isJsonObject(message)
          ? pick(message, [
              "messageId",
              "threadId",
              "subject",
              "from",
              "date",
              "isUnread",
              "category",
            ])
          : message,
      ),
    };
  },
  readEmail: (value) => ({
    ...pick(value, [
      "messageId",
      "threadId",
      "from",
      "to",
      "cc",
      "subject",
      "date",
      "attachments",
      "error",
    ]),
    ...(typeof value.content === "string"
      ? {
          content: truncatePromptContent(
            value.content,
            STALE_STRING_CHAR_LIMIT,
          ),
        }
      : {}),
  }),
};

function truncateStrings(value: Record<string, JSONValue>) {
  return truncateJsonStrings(value) as Record<string, JSONValue>;
}

function truncateJsonStrings(value: JSONValue): JSONValue {
  if (typeof value === "string") {
    return truncatePromptContent(value, STALE_STRING_CHAR_LIMIT);
  }
  if (Array.isArray(value)) return value.map(truncateJsonStrings);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        truncateJsonStrings(entry),
      ]),
    );
  }

  return value;
}

function pick(value: Record<string, JSONValue>, keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (key in value ? [[key, value[key]]] : [])),
  );
}

function isJsonObject(
  value: JSONValue | undefined,
): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
