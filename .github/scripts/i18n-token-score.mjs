#!/usr/bin/env node
// 汉化流程的"token 成本评分"：用可离线复现的方式估算一轮区域汉化要花多少 token，
// 这样优化前后可以直接对比，而不是凭感觉。
//
// 用法：
//   node .github/scripts/i18n-token-score.mjs
//   node .github/scripts/i18n-token-score.mjs --candidates 48
//   node .github/scripts/i18n-token-score.mjs --prompt /tmp/old-prompt.md --json
//
// 评分模型（估算值，单位 token）：
//   prompt_tokens_per_call  每条 codex 调用重复注入的指令长度
//   calls_per_area_run      本轮区域会发起多少次 codex 调用
//   files_per_area_run      本轮区域会处理多少个候选文件
//   fixed_tokens            prompt_tokens_per_call × calls_per_area_run
//   variable_tokens         files_per_area_run × file_tokens（经验值，默认 3000）
//   tokens_per_file         (fixed_tokens + variable_tokens) / files_per_area_run
//
// tokens_per_file 是核心指标：它把"多批调用重复注入提示词"的浪费直接暴露出来。
import fs from "node:fs";

const DEFAULTS = {
  prompt: ".github/codex/localize-zh.prompt.md",
  workflow: ".github/workflows/localize-zh.yml",
  candidates: null,
  batches: null,
  batchSize: null,
  fileTokens: 3000,
  json: false,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    let consumed = 1;
    if (arg === "--prompt") {
      options.prompt = argv[i + 1];
      consumed = 2;
    } else if (arg === "--workflow") {
      options.workflow = argv[i + 1];
      consumed = 2;
    } else if (arg === "--candidates") {
      options.candidates = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--batches") {
      options.batches = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--batch-size") {
      options.batchSize = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--file-tokens") {
      options.fileTokens = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--json") {
      options.json = true;
    }
    i += consumed;
  }
  return options;
}

// 中英混排估算：CJK/全角字符按 1 token，其余按 4 字节/token。
export function estimateTokens(text) {
  const cjkPattern = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/g;
  const cjk = text.match(cjkPattern)?.length ?? 0;
  const rest = text.replace(cjkPattern, "");
  return Math.ceil(cjk + rest.length / 4);
}

function readDefault(workflow, variable, fallback) {
  const pattern = new RegExp(
    `vars\\.${variable}\\s*\\|\\|\\s*'([0-9]+)'`,
    "u",
  );
  return Number(workflow.match(pattern)?.[1] ?? fallback);
}

const options = parseArgs(process.argv.slice(2));
const prompt = fs.readFileSync(options.prompt, "utf8");
const workflow = fs.readFileSync(options.workflow, "utf8");

const batches = options.batches ?? readDefault(workflow, "CODEX_BATCHES", 4);
const batchSize =
  options.batchSize ?? readDefault(workflow, "QUEUE_BATCH_SIZE", 8);
const promptTokensPerCall = estimateTokens(prompt);

const candidates = options.candidates;
const callsPerAreaRun =
  candidates == null
    ? batches
    : Math.min(batches, Math.ceil(candidates / batchSize));
const filesPerAreaRun =
  candidates == null ? batches * batchSize : Math.min(candidates, batches * batchSize);

const fixedTokens = promptTokensPerCall * callsPerAreaRun;
const variableTokens = filesPerAreaRun * options.fileTokens;
const tokensPerFile =
  filesPerAreaRun > 0
    ? Math.round((fixedTokens + variableTokens) / filesPerAreaRun)
    : null;

const report = {
  prompt: options.prompt,
  prompt_bytes: Buffer.byteLength(prompt, "utf8"),
  prompt_tokens_per_call: promptTokensPerCall,
  batches,
  batch_size: batchSize,
  candidates,
  calls_per_area_run: callsPerAreaRun,
  files_per_area_run: filesPerAreaRun,
  fixed_tokens: fixedTokens,
  variable_tokens: variableTokens,
  file_tokens_estimate: options.fileTokens,
  tokens_per_file: tokensPerFile,
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `${[
      `prompt_bytes=${report.prompt_bytes} prompt_tokens/call=${report.prompt_tokens_per_call}`,
      `batches=${report.batches} batch_size=${report.batch_size} calls=${report.calls_per_area_run} files=${report.files_per_area_run}`,
      `fixed=${report.fixed_tokens} variable=${report.variable_tokens} tokens/file=${report.tokens_per_file}`,
    ].join("\n")}\n`,
  );
}
