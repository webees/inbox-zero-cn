#!/usr/bin/env node

import { program } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { ApiClient, buildApiUrl } from "./client";
import {
  CONFIG_PATH,
  DEFAULT_BASE_URL,
  loadConfig,
  resolveRuntimeConfig,
  updateConfig,
} from "./config";
import type {
  NullableRuleResponse,
  ResponseTimeResponse,
  RuleResponse,
  RulesResponse,
  StatsByPeriodResponse,
  UnsubscribeSenderResponse,
} from "./api-types";
import { readJsonInput } from "./io";
import {
  printJson,
  printResponseTime,
  printRulesTable,
  printStatsByPeriod,
} from "./output";

type ProgramOptions = {
  apiKey?: string;
  baseUrl?: string;
};

async function main() {
  program
    .name("inbox-zero-api")
    .description(
      "CLI tool for managing Inbox Zero through the external API.\n\n" +
        "This binary is intended for bots, automation, and API-driven workflows.\n" +
        "For self-hosting and Docker setup, use `inbox-zero` instead.",
    )
    .version(packageJson.version, "-v, --version")
    .option("-k, --api-key <key>", "Inbox Zero API key")
    .option(
      "-b, --base-url <url>",
      "Optional override for self-hosted or custom API deployments",
    );

  addConfigCommands();
  addOpenApiCommand();
  addRuleCommands();
  addStatsCommands();
  addSenderCommands();

  await program.parseAsync(process.argv);
}

function addConfigCommands() {
  const config = program.command("config").description("管理本地 CLI 配置");

  config
    .command("list")
    .description("显示已存储的配置路径与值")
    .action(() => {
      const current = loadConfig();
      printJson({
        configPath: CONFIG_PATH,
        values: {
          apiKey: current.apiKey ? "(已配置)" : "(未配置)",
          baseUrl: current.baseUrl || `${DEFAULT_BASE_URL}（默认）`,
        },
      });
    });

  config
    .command("get <key>")
    .description("获取已存储的配置值")
    .action((key: string) => {
      const current = loadConfig();
      const value = getConfigValue(current, key);
      if (key === "api-key") {
        process.stdout.write(value ? "(已配置)\n" : "(未配置)\n");
        return;
      }

      process.stdout.write(`${value || "(未配置)"}\n`);
    });

  config
    .command("set <key> <value>")
    .description("设置已存储的配置值")
    .action((key: string, value: string) => {
      const partial = toConfigUpdate(key, value);
      updateConfig(partial);
      process.stdout.write(`已更新 ${key}（${CONFIG_PATH}）\n`);
    });
}

function addOpenApiCommand() {
  program
    .command("openapi")
    .description("获取实时 OpenAPI 文档")
    .option("--json", "输出 JSON")
    .action(async (options) => {
      const response = await getOpenApiDocument(
        program.optsWithGlobals() as ProgramOptions,
      );

      if (options.json) {
        printJson(response);
        return;
      }

      const title = getStringField(response, "info", "title");
      const version = getStringField(response, "info", "version");
      const paths = Object.keys(getObjectField(response, "paths"));

      process.stdout.write(`${title} (${version})\n`);
      for (const path of paths) {
        process.stdout.write(`${path}\n`);
      }
    });
}

function addRuleCommands() {
  const rules = program.command("rules").description("Manage automation rules");

  rules
    .command("list")
    .description("List rules for the scoped inbox account")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const response = await client.get<RulesResponse>("/rules");

      if (options.json) {
        printJson(response);
        return;
      }

      printRulesTable(response.rules);
    });

  rules
    .command("get <id>")
    .description("Get a rule by ID")
    .option("--json", "Print JSON output")
    .action(async (id: string, options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const response = await client.get<RuleResponse>(`/rules/${id}`);

      if (options.json) {
        printJson(response);
        return;
      }

      printJson(response.rule);
    });

  rules
    .command("create")
    .description("Create a rule from a JSON file or stdin")
    .requiredOption("-f, --file <path>", "Path to JSON file, or - for stdin")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const body = await readJsonInput(options.file);
      const response = await client.post<RuleResponse>(
        "/rules",
        JSON.stringify(body),
      );

      if (options.json) {
        printJson(response);
        return;
      }

      process.stdout.write(`已创建规则 ${response.rule.id}\n`);
    });

  rules
    .command("update <id>")
    .description("从 JSON 文件或标准输入替换规则")
    .requiredOption("-f, --file <path>", "JSON 文件路径，或使用 - 表示标准输入")
    .option("--json", "输出 JSON")
    .action(async (id: string, options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const body = await readJsonInput(options.file);
      const response = await client.put<NullableRuleResponse>(
        `/rules/${id}`,
        JSON.stringify(body),
      );

      if (options.json) {
        printJson(response);
        return;
      }

      if (!response.rule) {
        throw new Error(`无法重新加载已更新的规则 ${id}`);
      }

      process.stdout.write(`已更新规则 ${response.rule.id}\n`);
    });

  rules
    .command("delete <id>")
    .description("按 ID 删除规则")
    .action(async (id: string) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      await client.delete(`/rules/${id}`);
      process.stdout.write(`已删除规则 ${id}\n`);
    });
}

function addStatsCommands() {
  const stats = program.command("stats").description("读取账号分析数据");

  stats
    .command("by-period")
    .description("获取按周期分组的邮件统计")
    .option("--period <period>", "时间桶：day、week、month 或 year")
    .option("--from-date <timestamp>", "Unix 时间戳（毫秒）")
    .option("--to-date <timestamp>", "Unix 时间戳（毫秒）")
    .option("--json", "输出 JSON")
    .action(async (options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const response = await client.get<StatsByPeriodResponse>(
        "/stats/by-period",
        {
          period: options.period,
          fromDate: options.fromDate,
          toDate: options.toDate,
        },
      );

      if (options.json) {
        printJson(response);
        return;
      }

      printStatsByPeriod(response);
    });

  stats
    .command("response-time")
    .description("Get response time statistics")
    .option("--from-date <timestamp>", "Unix timestamp in milliseconds")
    .option("--to-date <timestamp>", "Unix timestamp in milliseconds")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const response = await client.get<ResponseTimeResponse>(
        "/stats/response-time",
        {
          fromDate: options.fromDate,
          toDate: options.toDate,
        },
      );

      if (options.json) {
        printJson(response);
        return;
      }

      printResponseTime(response);
    });
}

function addSenderCommands() {
  const senders = program
    .command("senders")
    .description("Manage senders for the scoped inbox account");

  senders
    .command("unsubscribe <email>")
    .description("Unsubscribe from a sender")
    .option("--json", "Print JSON output")
    .action(async (senderEmail: string, options) => {
      const client = createClient(program.optsWithGlobals() as ProgramOptions);
      const response = await client.post<UnsubscribeSenderResponse>(
        "/senders/unsubscribe",
        JSON.stringify({ senderEmail }),
      );

      if (options.json) {
        printJson(response);
      } else if (response.unsubscribe.success) {
        process.stdout.write(`Unsubscribed ${response.senderEmail}\n`);
      } else {
        process.stderr.write(
          `Could not unsubscribe ${response.senderEmail}` +
            (response.unsubscribe.reason
              ? ` (${response.unsubscribe.reason})`
              : "") +
            "\n",
        );
      }
      if (!response.unsubscribe.success) process.exitCode = 1;
    });
}

function createClient(options: ProgramOptions) {
  const config = resolveRuntimeConfig(options);
  return new ApiClient(config);
}

async function getOpenApiDocument(options: ProgramOptions) {
  const url = buildApiUrl(resolveBaseUrl(options), "/openapi");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

function getConfigValue(
  config: {
    apiKey?: string;
    baseUrl?: string;
  },
  key: string,
) {
  if (key === "api-key") return config.apiKey;
  if (key === "base-url") return config.baseUrl;

  throw new Error(`Unsupported config key: ${key}`);
}

function getObjectField(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};

  const field = (value as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") return {};

  return field as Record<string, unknown>;
}

function getStringField(value: unknown, objectKey: string, key: string) {
  const object = getObjectField(value, objectKey);
  const field = object[key];

  return typeof field === "string" ? field : "";
}

function resolveBaseUrl(options: ProgramOptions) {
  const storedConfig = loadConfig();

  return (
    options.baseUrl ||
    process.env.INBOX_ZERO_BASE_URL ||
    storedConfig.baseUrl ||
    DEFAULT_BASE_URL
  );
}

function toConfigUpdate(key: string, value: string) {
  if (key === "api-key") return { apiKey: value };
  if (key === "base-url") return { baseUrl: value };

  throw new Error(`Unsupported config key: ${key}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
