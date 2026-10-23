import { isStepCount, type ToolSet } from "ai";
import { createGenerateText } from "@/utils/llms";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { createMcpToolsForAgent } from "@/utils/ai/mcp/mcp-tools";
import { createDocsTools } from "@/utils/ai/mcp/docs-tools";
import prisma from "@/utils/prisma";
import { getModelForUseCase, LlmUseCase } from "@/utils/llms/use-cases";
import type { EmailForLLM } from "@/utils/types";
import { getEmailListPrompt, getUserInfoPrompt } from "@/utils/ai/helpers";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("mcp-agent");

type McpAgentOptions = {
  emailAccount: EmailAccountWithAI;
  messages: EmailForLLM[];
};

type McpAgentResponse = {
  response: string | null;
  getToolCalls: () => Array<{
    toolName: string;
    arguments: Record<string, unknown>;
    result: string;
  }>;
};

const NO_RELEVANT_INFO_FOUND = "NO_RELEVANT_INFO_FOUND";

async function runMcpAgent(
  options: McpAgentOptions,
  mcpTools: ToolSet,
): Promise<McpAgentResponse> {
  const { emailAccount, messages } = options;

  const system = `你是一名研究助手。使用你的工具搜索与邮件发件人和主题相关的信息。

搜索内容：
- 在 CRM/客户数据库中查找发件人的姓名、邮箱和公司
- 如果是技术问题，查找技术文档
- 如果涉及付款/订阅，查找账单信息
- 如果涉及功能/服务，查找产品信息

输出规则：
- 如果找到有用信息：简明扼要地总结主要发现
- 如果没有找到有用信息：可以简要说明你搜索了什么，然后以 "${NO_RELEVANT_INFO_FOUND}" 恰好结尾
- 不要请求更多工具或能力
- 保持简洁和事实性

立即开始搜索。`;

  const prompt = `${getUserInfoPrompt({ emailAccount })}

会话中最近的邮件如下：

<thread>
${getEmailListPrompt({ messages, messageMaxLength: 1000, maxMessages: 5 })}
</thread>`;

  const modelOptions = getModelForUseCase(
    emailAccount.user,
    LlmUseCase.McpAgent,
  );

  const generateText = createGenerateText({
    emailAccount,
    label: "MCP Agent",
    modelOptions,
    promptHardening: { trust: "untrusted", level: "full" },
  });

  const result = await generateText({
    ...modelOptions,
    tools: mcpTools,
    instructions: system,
    prompt,
    stopWhen: isStepCount(10),
    onStepEnd: async ({ text, toolCalls }) => {
      logger.trace("步骤完成", { text, toolCalls });
    },
  });

  const hasNoRelevantInfo = result.text.includes(NO_RELEVANT_INFO_FOUND);

  if (hasNoRelevantInfo) {
    logger.trace("未找到相关信息", {
      explanation: result.text.replace(NO_RELEVANT_INFO_FOUND, "").trim(),
    });
  }

  return {
    response: hasNoRelevantInfo ? null : result.text,
    getToolCalls: () => {
      // 从所有步骤中提取工具调用和结果
      const allToolCallsWithResults = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => {
          const toolResult = step.toolResults?.find(
            (result) => result.toolCallId === call.toolCallId,
          );
          return {
            toolName: call.toolName,
            arguments: call.input as Record<string, unknown>,
            result: toolResult?.output
              ? `${JSON.stringify(toolResult.output).slice(0, 200)}...`
              : "No result",
          };
        }),
      );
      return allToolCallsWithResults;
    },
  };
}

export async function mcpAgent(
  options: McpAgentOptions,
): Promise<McpAgentResponse | null> {
  const { emailAccount, messages } = options;

  if (!messages || messages.length === 0) return null;

  const docsSettings = await prisma.emailAccount.findUnique({
    where: { id: emailAccount.id },
    select: { draftDocsUrls: true },
  });
  const docsTools = createDocsTools(
    docsSettings?.draftDocsUrls ?? [],
    logger.with({ emailAccountId: emailAccount.id }),
  );
  const { tools: mcpTools, cleanup } = await createMcpToolsForAgent(
    emailAccount.id,
    { reservedToolNames: Object.keys(docsTools) },
  );
  const tools: ToolSet = { ...(mcpTools as ToolSet), ...docsTools };

  try {
    if (Object.keys(tools).length === 0) return null;
    return await runMcpAgent(options, tools);
  } finally {
    await cleanup();
  }
}
