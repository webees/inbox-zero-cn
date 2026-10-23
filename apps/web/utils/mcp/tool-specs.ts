/**
 * MCP 写入工具（规则动作可调用）的声明式规格。
 *
 * 一个规格只描述一次工具的参数，规则编辑器、AI 填参流程、执行器、校验和历史展示
 * 都会读取它。`buildPayload` 是唯一知道工具线格式的地方。
 *
 * `Action.integrationArgs` 的存储语义：
 *
 * - 文本参数：带 `aiPrompt` 的参数为空（或缺失）时，表示 AI 在执行时写入整个值——
 *   与草稿回复动作的空 `content` 约定相同。非空值按字面使用，除非它包含 `{{...}}`，
 *   此时仍作为高级用户的模板转义口继续生效。
 * - 选择参数：存储值始终是某个选项值，因此该选择能在导入/导出和 v1 API 往返中保留。
 *   选项可以通过匹配 `aiValue` 表示“让 AI 决定”；那是一个显式存储值，绝不是
 *   缺失与空字符串的区分。`buildPayload` 把选项值映射为工具期望的内容。
 *
 * 仅用于展示的参数（见 `displayValueKey`）与其参数一起存储，以便编辑器和历史
 * 显示可读的标签，并且永远不会发送给工具。
 */

import type { IntegrationKey } from "@/utils/mcp/integrations";

export type IntegrationArgOption = {
  value: string; // 存储在 Action.integrationArgs 中
  label: string; // 显示在规则编辑器中
  payloadValue?: string; // 发送给工具；缺失时从 payload 中省略
};

export type IntegrationArgControl =
  | { type: "text" }
  | { type: "select"; options: readonly IntegrationArgOption[] }
  // 选项来自集成本身：控件指定要调用的 MCP 读工具以及如何读取其响应，
  // 因此调用方无需知道自己在与哪个集成交互。
  | {
      type: "remote-select";
      optionsTool: string; // 提供选项的 MCP 读工具（不是该规格的写工具）
      parseOptions: (content: unknown) => IntegrationArgOption[];
      fallbackOptions?: readonly IntegrationArgOption[]; // 即使获取失败也始终提供
    };

export type IntegrationArgSpec = {
  key: string; // Action.integrationArgs 中的键
  label: string;
  control: IntegrationArgControl;
  placeholder?: string; // 对 AI 将写入内容的通俗描述
  aiPrompt?: string; // 设置后 => 该参数可在执行时由 AI 填入
  aiValue?: string; // 仅用于选择：表示“AI 决定”的存储选项值
  defaultValue?: string;
  defaultDisplayValue?: string;
  displayValueKey?: string; // 存放人类可读标签的伴生键；永不发送给工具
  required?: boolean; // 执行时必须解析为非空值
  llmDescription?: string; // 设置后 => 编写规则的 LLM 可设置该参数
};

export type IntegrationToolSpec = {
  integration: IntegrationKey;
  tool: string;
  actionLabel: string;
  displayArgKey?: string;
  llmDescription: string; // 向编写规则的 LLM 描述该动作
  args: readonly IntegrationArgSpec[];
  buildPayload: (resolved: Record<string, string>) => Record<string, unknown>;
};

// Todoist 的虚拟收件箱：即使项目尚未加载也始终可选。
const TODOIST_INBOX_PROJECT: IntegrationArgOption = {
  value: "inbox",
  label: "收件箱",
};

const TODOIST_DUE_DATE_AI_VALUE = "ai";

const TODOIST_DUE_DATE_OPTIONS: readonly IntegrationArgOption[] = [
  { value: TODOIST_DUE_DATE_AI_VALUE, label: "由 AI 根据邮件决定" },
  { value: "none", label: "无截止日期" },
  { value: "today", label: "今天", payloadValue: "today" },
  { value: "tomorrow", label: "明天", payloadValue: "tomorrow" },
  { value: "in-7-days", label: "一周后", payloadValue: "in 7 days" },
];

const todoistAddTasksSpec: IntegrationToolSpec = {
  integration: "todoist",
  tool: "add-tasks",
  actionLabel: "添加 Todoist 任务",
  displayArgKey: "content",
  llmDescription:
    "Add a task to the user's Todoist for the matching email. Only use this when the user explicitly asks to create Todoist tasks. Fails if Todoist isn't connected.",
  args: [
    {
      key: "content",
      label: "任务",
      control: { type: "text" },
      placeholder: "AI 根据邮件写一条简短的行动项",
      aiPrompt:
        "A short task title describing what the recipient needs to do about this email. Use a few words, not a sentence.",
      required: true,
      llmDescription:
        "The Todoist task title. Leave empty unless the user asked for specific wording, and the AI writes a task title from each matching email.",
    },
    {
      key: "description",
      label: "描述",
      control: { type: "text" },
      placeholder: "AI 写一行上下文",
      aiPrompt:
        "One short line of context for the task. Return an empty string if the email adds no useful context.",
      llmDescription:
        "The Todoist task description. Leave empty unless the user asked for specific wording, and the AI writes one line of context from each matching email.",
    },
    {
      key: "projectId",
      label: "项目",
      control: {
        type: "remote-select",
        optionsTool: "find-projects",
        parseOptions: parseTodoistProjects,
        fallbackOptions: [TODOIST_INBOX_PROJECT],
      },
      defaultValue: TODOIST_INBOX_PROJECT.value,
      defaultDisplayValue: TODOIST_INBOX_PROJECT.label,
      displayValueKey: "projectName",
    },
    {
      key: "dueString",
      label: "截止日期",
      control: { type: "select", options: TODOIST_DUE_DATE_OPTIONS },
      defaultValue: TODOIST_DUE_DATE_AI_VALUE,
      aiValue: TODOIST_DUE_DATE_AI_VALUE,
      aiPrompt:
        "The due date the email asks for, in natural language such as 'tomorrow' or 'next Friday'. Return an empty string if the email doesn't mention one.",
      llmDescription:
        "The task due date, e.g. 'today', 'tomorrow' or 'in 7 days'. Leave empty unless the user asked for a specific due date, and the AI takes the due date from each matching email.",
    },
  ],
  buildPayload: (resolved) => {
    const content = resolved.content?.trim() ?? "";
    const description = resolved.description?.trim() ?? "";
    const projectId = resolved.projectId?.trim() ?? "";
    const dueString = resolveSelectPayloadValue(
      TODOIST_DUE_DATE_OPTIONS,
      resolved.dueString,
    );

    // Todoist 接受批量；规则动作始终只创建一个任务。
    return {
      tasks: [
        {
          content,
          ...(description && { description }),
          ...(dueString && { dueString }),
          ...(projectId && { projectId }),
        },
      ],
    };
  },
};

export const INTEGRATION_TOOL_SPECS: readonly IntegrationToolSpec[] = [
  todoistAddTasksSpec,
];

export function getIntegrationToolSpec(
  integration: string | null | undefined,
  tool: string | null | undefined,
): IntegrationToolSpec | undefined {
  if (!integration || !tool) return;
  return INTEGRATION_TOOL_SPECS.find(
    (spec) => spec.integration === integration && spec.tool === tool,
  );
}

/**
 * 当动作未指明其集成和工具时假定的规格（AI 和 API 编写的动作只携带扁平字段）。
 * 一旦存在第二个写工具就返回 undefined，从而在新增工具时强制调用方显式指定，
 * 而不是默默选择恰好排在最前面的那个规格。
 */
export function getOnlyIntegrationToolSpec(): IntegrationToolSpec | undefined {
  return INTEGRATION_TOOL_SPECS.length === 1
    ? INTEGRATION_TOOL_SPECS[0]
    : undefined;
}

const GENERIC_INTEGRATION_ACTION_LABEL = "添加到集成";

/**
 * 以动作调用的工具为其命名。仅凭 `ActionType` 无法说明动作针对哪个集成，
 * 因此拥有该动作的调用方应把它传入。
 */
export function getIntegrationActionLabel(action?: {
  integrationName?: string | null;
  integrationToolName?: string | null;
}): string {
  // 仅在动作完全未指明工具时才进行猜测。指明了未知工具的动作不得借用其他集成的
  // 标签，否则预览和历史会描述错误的动作。
  const namesTool = !!action?.integrationName || !!action?.integrationToolName;
  const spec = namesTool
    ? getIntegrationToolSpec(
        action?.integrationName,
        action?.integrationToolName,
      )
    : getOnlyIntegrationToolSpec();

  return spec?.actionLabel ?? GENERIC_INTEGRATION_ACTION_LABEL;
}

export function getIntegrationActionDisplayValue(action: {
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: unknown;
}): string | null {
  const namesTool = !!action.integrationName || !!action.integrationToolName;
  const spec = namesTool
    ? getIntegrationToolSpec(action.integrationName, action.integrationToolName)
    : getOnlyIntegrationToolSpec();
  if (!spec?.displayArgKey) return null;

  const args = action.integrationArgs;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;

  const value = (args as Record<string, unknown>)[spec.displayArgKey];
  return typeof value === "string" ? value.trim() || null : null;
}

/** 应用直接调用来填充远程选择的读取工具。 */
export function getIntegrationRemoteSelectTools(integration: string): string[] {
  return INTEGRATION_TOOL_SPECS.filter(
    (spec) => spec.integration === integration,
  ).flatMap((spec) =>
    spec.args.flatMap((arg) =>
      arg.control.type === "remote-select" ? [arg.control.optionsTool] : [],
    ),
  );
}

/** 从不可信的请求参数中解析远程选择参数。 */
export function getRemoteSelectArg({
  integration,
  tool,
  argKey,
}: {
  integration: string | null | undefined;
  tool: string | null | undefined;
  argKey: string | null | undefined;
}) {
  const spec = getIntegrationToolSpec(integration, tool);
  if (!spec) return;

  const arg = spec.args.find((candidate) => candidate.key === argKey);
  if (arg?.control.type !== "remote-select") return;

  return { spec, control: arg.control };
}

/**
 * AI 是否在执行时填入该参数：空文本参数，或停留在其“AI 决定”选项上的选择参数。
 */
export function isAiFilledArgValue(
  arg: IntegrationArgSpec | undefined,
  value: string | null | undefined,
): boolean {
  if (!arg?.aiPrompt) return false;

  const trimmed = value?.trim() ?? "";
  if (arg.control.type === "select") return trimmed === arg.aiValue;
  return trimmed === "";
}

/** 新增动作按规格声明的默认值开始时的参数。 */
export function buildDefaultIntegrationArgs(
  spec: IntegrationToolSpec,
): Record<string, string> {
  const args: Record<string, string> = {};

  for (const arg of spec.args) {
    if (arg.defaultValue !== undefined) args[arg.key] = arg.defaultValue;
    if (arg.displayValueKey && arg.defaultDisplayValue !== undefined) {
      args[arg.displayValueKey] = arg.defaultDisplayValue;
    }
  }

  return args;
}

/**
 * 把宽松指定的选择值（例如 AI 编写的规则里的 "in 7 days"）映射到我们存储的
 * 选项值，以便编辑器展示该选择。
 */
export function normalizeSelectArgValue(
  arg: IntegrationArgSpec,
  value: string | null | undefined,
): string | undefined {
  if (arg.control.type !== "select") return value?.trim() || undefined;

  const trimmed = value?.trim() ?? "";
  if (!trimmed) return arg.defaultValue;

  const match = arg.control.options.find(
    (option) => option.value === trimmed || option.payloadValue === trimmed,
  );
  return match?.value ?? trimmed;
}

/** 保证能匹配该参数某个选项的选择值。 */
export function getSelectArgOptionLabel(
  arg: IntegrationArgSpec,
  value: string | null | undefined,
): string | undefined {
  if (arg.control.type !== "select") return;
  const trimmed = value?.trim();
  if (!trimmed) return;
  // 预设之外的值是自定义值（例如用户或 AI 写的截止日期）；按原样展示，
  // 而不是把它藏在预设标签后面。
  return (
    arg.control.options.find((option) => option.value === trimmed)?.label ??
    trimmed
  );
}

/** 该规格拥有的键，包括仅用于展示的伴生键。 */
export function getIntegrationArgKeys(spec: IntegrationToolSpec): string[] {
  return spec.args.flatMap((arg) =>
    arg.displayValueKey ? [arg.key, arg.displayValueKey] : [arg.key],
  );
}

/** 将 Todoist 的 `find-projects` 响应读取为可选项。 */
function parseTodoistProjects(content: unknown): IntegrationArgOption[] {
  if (!Array.isArray(content)) return [];

  const options: IntegrationArgOption[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (!("text" in item) || typeof item.text !== "string") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      continue;
    }

    for (const candidate of extractTodoistProjectArray(parsed)) {
      if (
        candidate &&
        typeof candidate === "object" &&
        "id" in candidate &&
        "name" in candidate &&
        typeof candidate.name === "string"
      ) {
        options.push({ value: String(candidate.id), label: candidate.name });
      }
    }
  }

  return options;
}

function extractTodoistProjectArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  if ("results" in parsed && Array.isArray(parsed.results)) {
    return parsed.results;
  }
  if ("projects" in parsed && Array.isArray(parsed.projects)) {
    return parsed.projects;
  }
  return [];
}

function resolveSelectPayloadValue(
  options: readonly IntegrationArgOption[],
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";

  const option = options.find((candidate) => candidate.value === trimmed);
  // 未知值来自 AI 填充，它会返回自然语言。
  return option ? (option.payloadValue ?? "") : trimmed;
}
