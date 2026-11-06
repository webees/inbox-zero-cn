import { assertCanUseDigestsIfNeeded } from "@/utils/premium/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getStatsByPeriod } from "@/app/api/user/stats/by-period/controller";
import { getResponseTimeStats } from "@/utils/stats/response-time/controller";
import { toRuleWriteInput } from "@/app/api/v1/rules/request";
import { apiRuleSelect, serializeRule } from "@/app/api/v1/rules/serializers";
import { ruleRequestBodySchema } from "@/app/api/v1/rules/validation";
import { BRAND_NAME } from "@/utils/branding";
import { createEmailProvider } from "@/utils/email/provider";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { createRule, deleteRule, updateRule } from "@/utils/rule/rule";
import {
  listMcpEmailAccounts,
  resolveMcpEmailAccount,
} from "@/utils/mcp/account-selection";
import type { MCP_SCOPES } from "@/utils/mcp/config";
import { isMcpServerEnabledForUser } from "@/utils/mcp/access";
import {
  registerMailClient,
  getMailPermissions,
} from "@/utils/mcp/mail-client-ui";
import {
  createDraftForMcp,
  createDraftInputShape,
  mcpAccountSelectorShape,
  readThreadForMcp,
  readThreadInputShape,
  searchInboxForMcp,
  searchInboxInputShape,
} from "@/utils/mcp/email-tools";

const logger = createScopedLogger("mcp-server");
type ToolResultData = Record<string, unknown>;
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const ruleWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};
const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};
const mailboxReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};
const mailboxWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

export async function handleMcpServerRequest(
  request: Request,
  session: { userId: string; scopes: string[]; clientId?: string },
) {
  const userId = session.userId;
  if (!userId) {
    return new Response(null, { status: 401 });
  }

  if (!(await isMcpServerEnabledForUser(userId))) {
    return new Response(null, { status: 403 });
  }

  const toolLogger = logger.with({
    userId,
    ...(session.clientId ? { clientId: session.clientId } : {}),
  });

  const server = new McpServer(
    { name: `${BRAND_NAME} MCP`, version: "1.0.0" },
    {
      instructions:
        "针对特定收件箱时使用 list_email_accounts。搜索和读取工具返回邮件；create_draft 只保存邮箱草稿，绝不发送。规则和统计工具接受 emailAccountId 或 emailAddress，默认使用第一个已关联的账号。",
    },
  );

  const runTool =
    (
      name: string,
      required: (typeof MCP_SCOPES)[number],
      handler: (args: Record<string, unknown>) => Promise<ToolResultData>,
    ) =>
    async (args: Record<string, unknown>) => {
      try {
        assertMcpScope(session.scopes, required);
        const data = await handler(args);
        toolLogger.info("MCP 工具调用", {
          tool: name,
          ...emailAccountLogFields(data),
        });
        return createToolResult(data);
      } catch (error) {
        toolLogger.warn("MCP 工具执行失败", {
          tool: name,
          error: error instanceof Error ? error.message : error,
        });
        throw error;
      }
    };

  server.registerTool(
    "list_email_accounts",
    {
      title: "列出邮箱账号",
      description: "列出与已认证用户关联的收件箱账号。",
      annotations: { ...readOnlyAnnotations, title: "列出邮箱账号" },
    },
    runTool("list_email_accounts", "mcp:read", async () => ({
      accounts: await listMcpEmailAccounts(userId),
      permissions: getMailPermissions(session.scopes),
    })),
  );

  server.registerTool(
    "search_inbox",
    {
      title: "搜索收件箱",
      description:
        "搜索一个收件箱并返回邮件元数据和片段。不返回完整邮件正文、不发送邮件、不更改邮件。",
      inputSchema: searchInboxInputShape,
      annotations: { ...mailboxReadAnnotations, title: "搜索收件箱" },
    },
    runTool("search_inbox", "mcp:read", async (args) =>
      searchInboxForMcp({
        userId,
        query: String(args.query),
        maxResults:
          typeof args.maxResults === "number" ? args.maxResults : undefined,
        pageToken:
          typeof args.pageToken === "string" ? args.pageToken : undefined,
        emailAccountId:
          typeof args.emailAccountId === "string"
            ? args.emailAccountId
            : undefined,
        emailAddress:
          typeof args.emailAddress === "string" ? args.emailAddress : undefined,
        logger: toolLogger,
      }),
    ),
  );

  server.registerTool(
    "read_thread",
    {
      title: "读取会话",
      description:
        "按会话 ID 读取某个收件箱会话中的邮件。返回按邮件截断的纯文本正文。",
      inputSchema: readThreadInputShape,
      annotations: { ...mailboxReadAnnotations, title: "读取会话" },
    },
    runTool("read_thread", "mcp:read", async (args) =>
      readThreadForMcp({
        userId,
        threadId: String(args.threadId),
        maxMessages:
          typeof args.maxMessages === "number" ? args.maxMessages : undefined,
        emailAccountId:
          typeof args.emailAccountId === "string"
            ? args.emailAccountId
            : undefined,
        emailAddress:
          typeof args.emailAddress === "string" ? args.emailAddress : undefined,
        logger: toolLogger,
      }),
    ),
  );

  server.registerTool(
    "create_draft",
    {
      title: "创建草稿",
      description:
        "创建包含收件人、主题和正文的邮箱草稿。保存草稿以供审核，不发送邮件。",
      inputSchema: createDraftInputShape,
      annotations: { ...mailboxWriteAnnotations, title: "创建草稿" },
    },
    runTool("create_draft", "mcp:write", async (args) =>
      createDraftForMcp({
        userId,
        to: String(args.to),
        subject: String(args.subject),
        body: String(args.body),
        emailAccountId:
          typeof args.emailAccountId === "string"
            ? args.emailAccountId
            : undefined,
        emailAddress:
          typeof args.emailAddress === "string" ? args.emailAddress : undefined,
        logger: toolLogger,
      }),
    ),
  );

  server.registerTool(
    "list_rules",
    {
      title: "列出规则",
      description: "列出某个收件箱账号的自动化规则。",
      inputSchema: mcpAccountSelectorShape,
      annotations: { ...readOnlyAnnotations, title: "列出规则" },
    },
    runTool("list_rules", "mcp:read", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const rules = await prisma.rule.findMany({
        where: { emailAccountId: emailAccount.id },
        select: apiRuleSelect,
        orderBy: { createdAt: "asc" },
      });

      return {
        emailAccount,
        rules: rules.map(serializeRule),
      };
    }),
  );

  server.registerTool(
    "get_rule",
    {
      title: "获取规则",
      description: "按 ID 获取某个收件箱账号的一条自动化规则。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        id: z.string(),
      },
      annotations: { ...readOnlyAnnotations, title: "获取规则" },
    },
    runTool("get_rule", "mcp:read", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const rule = await prisma.rule.findFirst({
        where: { id: String(args.id), emailAccountId: emailAccount.id },
        select: apiRuleSelect,
      });

      if (!rule) {
        throw new Error("所选邮箱账号中未找到该规则。");
      }

      return {
        emailAccount,
        rule: serializeRule(rule),
      };
    }),
  );

  server.registerTool(
    "create_rule",
    {
      title: "创建规则",
      description: "为某个收件箱账号创建一条自动化规则。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        rule: ruleRequestBodySchema,
      },
      annotations: { ...ruleWriteAnnotations, title: "创建规则" },
    },
    runTool("create_rule", "mcp:write", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const ruleInput = toRuleWriteInput(
        ruleRequestBodySchema.parse(args.rule),
      );
      const scopedLogger = toolLogger.with({
        emailAccountId: emailAccount.id,
      });

      await assertCanUseDigestsIfNeeded(userId, ruleInput.actions);

      const createdRule = await createRule({
        result: {
          name: ruleInput.name,
          condition: ruleInput.condition,
          actions: ruleInput.actions,
        },
        emailAccountId: emailAccount.id,
        provider: emailAccount.provider,
        runOnThreads: ruleInput.runOnThreads,
        logger: scopedLogger,
      });

      const storedRule = await prisma.rule.findUnique({
        where: { id: createdRule.id },
        select: apiRuleSelect,
      });

      if (!storedRule) {
        throw new Error("无法加载已创建的规则。");
      }

      return {
        emailAccount,
        rule: serializeRule(storedRule),
      };
    }),
  );

  server.registerTool(
    "update_rule",
    {
      title: "更新规则",
      description: "替换某个收件箱账号的一条自动化规则。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        id: z.string(),
        rule: ruleRequestBodySchema,
      },
      annotations: { ...ruleWriteAnnotations, title: "更新规则" },
    },
    runTool("update_rule", "mcp:write", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const existingRule = await prisma.rule.findFirst({
        where: { id: String(args.id), emailAccountId: emailAccount.id },
        select: { id: true, actions: { select: { type: true } } },
      });

      if (!existingRule) {
        throw new Error("所选邮箱账号中未找到该规则。");
      }

      const ruleInput = toRuleWriteInput(
        ruleRequestBodySchema.parse(args.rule),
      );
      const scopedLogger = toolLogger.with({
        emailAccountId: emailAccount.id,
        ruleId: String(args.id),
      });

      await assertCanUseDigestsIfNeeded(
        userId,
        ruleInput.actions,
        existingRule.actions,
      );

      await updateRule({
        ruleId: String(args.id),
        result: {
          name: ruleInput.name,
          condition: ruleInput.condition,
          actions: ruleInput.actions,
        },
        emailAccountId: emailAccount.id,
        provider: emailAccount.provider,
        logger: scopedLogger,
        runOnThreads: ruleInput.runOnThreads,
      });

      const updatedRule = await prisma.rule.findFirst({
        where: { id: String(args.id), emailAccountId: emailAccount.id },
        select: apiRuleSelect,
      });

      if (!updatedRule) {
        throw new Error("无法加载已更新的规则。");
      }

      return {
        emailAccount,
        rule: serializeRule(updatedRule),
      };
    }),
  );

  server.registerTool(
    "delete_rule",
    {
      title: "删除规则",
      description: "删除某个收件箱账号的一条自动化规则。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        id: z.string(),
      },
      annotations: { ...destructiveAnnotations, title: "删除规则" },
    },
    runTool("delete_rule", "mcp:write", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const existingRule = await prisma.rule.findFirst({
        where: { id: String(args.id), emailAccountId: emailAccount.id },
        select: { groupId: true },
      });

      if (!existingRule) {
        throw new Error("所选邮箱账号中未找到该规则。");
      }

      await deleteRule({
        emailAccountId: emailAccount.id,
        ruleId: String(args.id),
        groupId: existingRule.groupId,
      });

      return {
        deleted: true,
        emailAccount,
        id: String(args.id),
      };
    }),
  );

  server.registerTool(
    "get_stats_by_period",
    {
      title: "按周期获取统计",
      description: "获取按日、周、月或年分组的邮件统计。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        period: z.enum(["day", "week", "month", "year"]).optional(),
        fromDate: z.number().int().optional(),
        toDate: z.number().int().optional(),
      },
      annotations: { ...readOnlyAnnotations, title: "按周期获取统计" },
    },
    runTool("get_stats_by_period", "mcp:read", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const result = await getStatsByPeriod({
        period:
          args.period === "day" ||
          args.period === "week" ||
          args.period === "month" ||
          args.period === "year"
            ? args.period
            : "week",
        fromDate: typeof args.fromDate === "number" ? args.fromDate : undefined,
        toDate: typeof args.toDate === "number" ? args.toDate : undefined,
        emailAccountId: emailAccount.id,
      });

      return {
        emailAccount,
        ...result,
      };
    }),
  );

  server.registerTool(
    "get_response_time_stats",
    {
      title: "获取响应时间统计",
      description: "获取某个收件箱账号的响应时间分析。",
      inputSchema: {
        ...mcpAccountSelectorShape,
        fromDate: z.number().int().optional(),
        toDate: z.number().int().optional(),
      },
      annotations: { ...readOnlyAnnotations, title: "获取响应时间统计" },
    },
    runTool("get_response_time_stats", "mcp:read", async (args) => {
      const emailAccount = await resolveMcpEmailAccount({
        userId,
        ...accountSelector(args),
      });
      const scopedLogger = toolLogger.with({
        emailAccountId: emailAccount.id,
      });
      const emailProvider = await createEmailProvider({
        emailAccountId: emailAccount.id,
        provider: emailAccount.provider,
        logger: scopedLogger,
      });
      const result = await getResponseTimeStats({
        fromDate: typeof args.fromDate === "number" ? args.fromDate : undefined,
        toDate: typeof args.toDate === "number" ? args.toDate : undefined,
        emailAccountId: emailAccount.id,
        emailProvider,
        logger: scopedLogger,
      });

      return {
        emailAccount,
        ...serializeResponseTimeStats(result),
      };
    }),
  );

  registerMailClient(server, session, toolLogger);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  return transport.handleRequest(request);
}

function createToolResult(data: ToolResultData) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function serializeResponseTimeStats(
  result: Awaited<ReturnType<typeof getResponseTimeStats>>,
) {
  return {
    ...result,
    trend: result.trend.map((entry) => ({
      ...entry,
      periodDate: entry.periodDate.toISOString(),
    })),
  };
}

function assertMcpScope(
  scopes: string[],
  required: (typeof MCP_SCOPES)[number],
) {
  if (!scopes.includes(required))
    throw new Error(`Missing required permission: ${required}`);
}

function accountSelector(args: Record<string, unknown>) {
  return {
    emailAccountId:
      typeof args.emailAccountId === "string" ? args.emailAccountId : undefined,
    emailAddress:
      typeof args.emailAddress === "string" ? args.emailAddress : undefined,
  };
}

function emailAccountLogFields(data: ToolResultData) {
  const emailAccount = data.emailAccount;
  if (
    !emailAccount ||
    typeof emailAccount !== "object" ||
    !("id" in emailAccount) ||
    typeof emailAccount.id !== "string"
  ) {
    return {};
  }
  return { emailAccountId: emailAccount.id };
}
