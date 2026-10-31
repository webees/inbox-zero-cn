#!/usr/bin/env node
// 汇总 `codex exec --json` 事件流里的 token 用量。
//
// 用法：
//   node .github/scripts/i18n-token-metrics.mjs <codex.jsonl> [...]
//   node .github/scripts/i18n-token-metrics.mjs --summary <codex.jsonl> [...]
//   node .github/scripts/i18n-token-metrics.mjs --append <metrics.jsonl> \
//     --label "area=utils batch=1" --files 8 --changed 3 <codex.jsonl>
//   node .github/scripts/i18n-token-metrics.mjs --aggregate <metrics-dir> --summary
//
// codex CLI 会在 JSONL 流里输出 `token_count` 事件，其中
// `info.total_token_usage` 是会话累计值，`info.last_token_usage` 是单轮增量。
// 这里以最后一个累计值为准（缺失时回退到增量求和），并保留各字段明细。
import fs from "node:fs";

const USAGE_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

function emptyUsage() {
  return Object.fromEntries(USAGE_KEYS.map((key) => [key, 0]));
}

function addUsage(target, source) {
  for (const key of USAGE_KEYS) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) target[key] += value;
  }
}

// 不同 CLI 版本的 JSONL 结构不一样：老版本是 `token_count` 事件 + info.total_token_usage，
// 新版本用 `turn.completed` 之类的事件携带 usage。这里递归找出任意带用量字段的对象。
function findUsage(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (USAGE_KEYS.some((key) => Number.isFinite(Number(node[key])))) return node;
  for (const value of Object.values(node)) {
    const found = findUsage(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function readTokenUsage(file) {
  const sum = emptyUsage();
  let lastTotal = null;
  let tokenCountEvents = 0;
  let lastAgentMessage = null;
  const errorItems = [];
  const rawSample = [];
  const tailSample = [];
  let lines = 0;

  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ...emptyUsage(), token_count_events: 0, parsed_lines: 0, file };
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines += 1;
    if (rawSample.length < 3) rawSample.push(line.slice(0, 200));
    tailSample.push(line.slice(0, 200));
    if (tailSample.length > 5) tailSample.shift();
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "token_count") {
      tokenCountEvents += 1;
      const info = event.info ?? {};
      if (info.last_token_usage) addUsage(sum, info.last_token_usage);
      if (info.total_token_usage) lastTotal = info.total_token_usage;
    } else {
      const usage = findUsage(event);
      if (usage) {
        tokenCountEvents += 1;
        addUsage(sum, usage);
        lastTotal = usage;
      }
    }
    // 0 改动时把模型最后一段话带出来，方便排查"为什么什么都没改"
    if (event?.type === "agent_message" && typeof event.message === "string") {
      lastAgentMessage = event.message;
    }
    // codex 退出码非 0 时，真正的报错通常在 item.completed(type=error) 里
    if (
      event?.type === "item.completed" &&
      event.item?.type === "error" &&
      typeof event.item.message === "string"
    ) {
      errorItems.push(event.item.message);
    }
  }

  const usage = lastTotal ? { ...emptyUsage(), ...lastTotal } : sum;
  // 有些 provider 只给 input/output，不给 total_tokens，这里补一个有效总数
  if (!usage.total_tokens) {
    usage.total_tokens = usage.input_tokens + usage.output_tokens;
  }
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    ...usage,
    token_count_events: tokenCountEvents,
    last_agent_message: lastAgentMessage,
    raw_sample: rawSample,
    tail_sample: tailSample,
    error_items: errorItems,
    log_bytes: bytes,
    parsed_lines: lines,
    file,
  };
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    append: null,
    aggregate: null,
    label: null,
    summary: false,
    filesProcessed: null,
    filesChanged: null,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    let consumed = 1;
    if (arg === "--append") {
      options.append = argv[i + 1];
      consumed = 2;
    } else if (arg === "--aggregate") {
      options.aggregate = argv[i + 1];
      consumed = 2;
    } else if (arg === "--label") {
      options.label = argv[i + 1];
      consumed = 2;
    } else if (arg === "--files") {
      options.filesProcessed = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--changed") {
      options.filesChanged = Number(argv[i + 1]);
      consumed = 2;
    } else if (arg === "--summary") {
      options.summary = true;
    } else {
      options.inputs.push(arg);
    }
    i += consumed;
  }
  return options;
}

// 按运行分文件记录（.github/i18n-metrics/<run_id>.jsonl）后，这里把目录里的记录汇总成一张对比表。
function aggregate(dir) {
  const groups = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return groups;
  }
  for (const name of files) {
    const text = fs.readFileSync(`${dir}/${name}`, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const area = /area=([a-z-]+)/u.exec(record.label ?? "")?.[1] ?? "unknown";
      const cfg = /cfg=([a-z0-9-]+)/u.exec(record.label ?? "")?.[1] ?? "-";
      const key = `${area}|${cfg}`;
      const current = groups.get(key) ?? {
        area,
        cfg,
        batches: 0,
        files: 0,
        changed: 0,
        tokens: 0,
        logBytes: 0,
      };
      current.batches += 1;
      current.files += record.files ?? 0;
      current.changed += record.files_changed ?? 0;
      current.tokens += record.tokens?.total_tokens ?? 0;
      current.logBytes += record.log_bytes ?? 0;
      groups.set(key, current);
    }
  }
  return groups;
}

const options = parseArgs(process.argv.slice(2));

if (options.aggregate) {
  const groups = aggregate(options.aggregate);
  const rows = [...groups.values()].sort((a, b) => b.tokens - a.tokens);
  for (const row of rows) {
    const perChanged = row.changed
      ? Math.round(row.tokens / row.changed)
      : null;
    process.stdout.write(
      `${row.area} cfg=${row.cfg}: batches=${row.batches} files=${row.files} changed=${row.changed} ` +
        `tokens=${row.tokens} tokens/changed-file=${perChanged ?? "-"} ` +
        // changed 可能大于 files（同步测试文件），waste 下限取 0
        `waste=${row.files ? Math.max(0, 1 - row.changed / row.files).toFixed(3) : "-"} log_bytes=${row.logBytes}\n`,
    );
  }
  if (rows.length === 0) process.stdout.write("（暂无指标记录）\n");
  process.exit(0);
}

const perFile = options.inputs.map(readTokenUsage);
const total = emptyUsage();
for (const usage of perFile) addUsage(total, usage);

const filesProcessed = Number.isFinite(options.filesProcessed)
  ? options.filesProcessed
  : null;
const filesChanged = Number.isFinite(options.filesChanged)
  ? options.filesChanged
  : null;
const record = {
  label: options.label,
  recorded_at: new Date().toISOString(),
  files: filesProcessed,
  files_changed: filesChanged,
  tokens: total,
  tokens_per_file:
    filesProcessed && filesProcessed > 0
      ? Math.round(total.total_tokens / filesProcessed)
      : null,
  tokens_per_changed_file:
    filesChanged && filesChanged > 0
      ? Math.round(total.total_tokens / filesChanged)
      : null,
  // 1.0 表示这一批一个文件都没改动（纯浪费），0 表示全部命中。
  waste_ratio:
    filesProcessed && filesProcessed > 0 && filesChanged != null
      ? Number(
          Math.max(0, 1 - filesChanged / filesProcessed).toFixed(3),
        )
      : null,
  token_count_events: perFile.reduce((n, u) => n + u.token_count_events, 0),
  // provider 不返回 usage 时的兜底代理指标：事件流体积 / 4，用于横向比较不同配置
  log_bytes: perFile.reduce((n, u) => n + u.log_bytes, 0),
  estimated_tokens_from_log: Math.ceil(
    perFile.reduce((n, u) => n + u.log_bytes, 0) / 4,
  ),
  last_agent_message:
    perFile.map((u) => u.last_agent_message).filter(Boolean).at(-1) ?? null,
  error_items: perFile.flatMap((u) => u.error_items).slice(0, 5),
};

if (options.append) {
  fs.appendFileSync(options.append, `${JSON.stringify(record)}\n`);
  // 只保留最近 500 条，避免指标文件无限增长
  const lines = fs
    .readFileSync(options.append, "utf8")
    .split("\n")
    .filter(Boolean);
  if (lines.length > 500) {
    fs.writeFileSync(
      options.append,
      `${lines.slice(-500).join("\n")}\n`,
    );
  }
}

if (options.summary) {
  const warn =
    record.token_count_events === 0
      ? "（未收到 token_count 事件，可能是 CLI 版本或 provider 不支持）"
      : "";
  process.stdout.write(
    `tokens: total=${total.total_tokens} input=${total.input_tokens} ` +
      `cached=${total.cached_input_tokens} output=${total.output_tokens} ` +
      `reasoning=${total.reasoning_output_tokens}` +
      (record.tokens_per_file ? ` tokens/file=${record.tokens_per_file}` : "") +
      (record.tokens_per_changed_file
        ? ` tokens/changed-file=${record.tokens_per_changed_file}`
        : "") +
      (record.waste_ratio != null ? ` waste=${record.waste_ratio}` : "") +
      ` log_bytes=${record.log_bytes} est_tokens_from_log=${record.estimated_tokens_from_log}` +
      `${warn}\n`,
  );
  if (record.waste_ratio === 1 && record.last_agent_message) {
    process.stdout.write(
      `last agent message: ${record.last_agent_message.slice(0, 300)}\n`,
    );
  }
  // 采集不到 token 事件时，把原始事件样例打出来，便于判断是 CLI 版本还是 provider 不返回 usage
  if (record.token_count_events === 0) {
    for (const sample of perFile.flatMap((u) => u.raw_sample).slice(0, 3)) {
      process.stdout.write(`raw event sample: ${sample}\n`);
    }
  }
  if (record.error_items.length > 0) {
    for (const sample of perFile.flatMap((u) => u.tail_sample).slice(-5)) {
      process.stdout.write(`tail event: ${sample}\n`);
    }
  }
  for (const message of record.error_items) {
    process.stdout.write(`codex error: ${message.slice(0, 300)}\n`);
  }
} else {
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}
