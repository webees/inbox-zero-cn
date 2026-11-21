#!/usr/bin/env node
// 汉化账本：按「文件内容哈希」记住每个文件的处理结论，避免反复把同一个文件
// 交给模型。取代旧的 .github/i18n-skipped.txt（首次运行会自动迁移）。
//
// 记录格式（.github/i18n-ledger.jsonl，按路径排序，一行一条）：
//   {"path":"apps/web/foo.tsx","hash":"sha256","status":"clean|skipped|residual","hits":3,"updatedAt":"..."}
//
//   clean    —— 机械扫描已确认该文件没有残留英文（翻干净了）
//   skipped  —— 模型看过并判定不需要改（品牌名、代码串等误报）
//   residual —— 模型处理过但机械扫描仍命中（只翻了一部分），下一轮优先
//
// 用法：
//   node .github/scripts/i18n-ledger.mjs queue --candidates <文件列表> --hits <命中行文件> --out <输出队列> [--limit N]
//   node .github/scripts/i18n-ledger.mjs record --status clean|skipped|residual --files <文件列表>
//   node .github/scripts/i18n-ledger.mjs stats
//
// 所有命令都接受 --ledger <路径> 覆盖账本位置。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LEDGER = ".github/i18n-ledger.jsonl";
const LEGACY_SKIP_LIST = ".github/i18n-skipped.txt";
const STATUSES = new Set(["clean", "skipped", "residual"]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, ledger: DEFAULT_LEDGER };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];
    switch (key) {
      case "--ledger":
        options.ledger = requireValue(key, value);
        i += 1;
        break;
      case "--candidates":
        options.candidates = requireValue(key, value);
        i += 1;
        break;
      case "--hits":
        options.hits = requireValue(key, value);
        i += 1;
        break;
      case "--out":
        options.out = requireValue(key, value);
        i += 1;
        break;
      case "--files":
        options.files = requireValue(key, value);
        i += 1;
        break;
      case "--status":
        options.status = requireValue(key, value);
        i += 1;
        break;
      case "--limit":
        options.limit = Number(requireValue(key, value));
        i += 1;
        break;
      default:
        throw new Error(`未知参数：${key}`);
    }
  }
  return options;
}

function requireValue(key, value) {
  if (!value || value.startsWith("--")) throw new Error(`${key} 需要一个值`);
  return value;
}

/** 扫描器输出可能带 ./ 前缀，统一成仓库相对路径，账本键才稳定。 */
function normalizePath(value) {
  return value.trim().replace(/^\.\//, "");
}

function readLines(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hashFile(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function readLedger(file) {
  const entries = new Map();
  if (!fs.existsSync(file)) return entries;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.path) entries.set(entry.path, entry);
    } catch {
      // 坏行直接忽略：账本是缓存，丢了只会多扫一遍，不会漏译
    }
  }
  return entries;
}

/** 首次运行时把旧的跳过名单迁移成账本，避免已有结论被丢掉。 */
function migrateLegacySkipList(ledgerFile, entries) {
  if (fs.existsSync(ledgerFile) || !fs.existsSync(LEGACY_SKIP_LIST)) return false;
  for (const line of readLines(LEGACY_SKIP_LIST)) {
    const [hash, ...rest] = line.split(" ");
    const file = normalizePath(rest.join(" "));
    if (!hash || !file) continue;
    entries.set(file, {
      path: file,
      hash,
      status: "skipped",
      hits: 0,
      updatedAt: new Date().toISOString(),
    });
  }
  return true;
}

function writeLedger(file, entries) {
  const lines = [...entries.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) =>
      JSON.stringify({
        path: entry.path,
        hash: entry.hash,
        status: entry.status,
        hits: entry.hits ?? 0,
        updatedAt: entry.updatedAt,
      }),
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function countHits(hitsFile) {
  const counts = new Map();
  for (const line of readLines(hitsFile)) {
    const file = normalizePath(line.replace(/:\d+$/, ""));
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

function commandQueue(options) {
  if (!options.candidates || !options.out)
    throw new Error("queue 需要 --candidates 与 --out");

  const ledgerExists = fs.existsSync(options.ledger);
  const entries = readLedger(options.ledger);
  const migrated = migrateLegacySkipList(options.ledger, entries);
  // 迁移结果落盘，否则每次 queue 都要重放一遍旧名单
  if (!ledgerExists && migrated) writeLedger(options.ledger, entries);
  const hits = countHits(options.hits);

  const queue = [];
  let skippedByLedger = 0;
  let changedSinceDecision = 0;
  let residual = 0;
  let unseen = 0;

  for (const raw of new Set(readLines(options.candidates).map(normalizePath))) {
    const hash = hashFile(raw);
    if (!hash) continue;
    const entry = entries.get(raw);
    const sameContent = entry?.hash === hash;

    if (sameContent && (entry.status === "clean" || entry.status === "skipped")) {
      skippedByLedger += 1;
      continue;
    }

    if (entry && !sameContent) changedSinceDecision += 1;
    if (sameContent && entry.status === "residual") residual += 1;
    if (!entry) unseen += 1;

    queue.push({
      path: raw,
      hits: hits.get(raw) ?? 0,
      // 上一轮没翻干净的排最前；其余按命中数从多到少
      priority: sameContent && entry.status === "residual" ? 0 : 1,
    });
  }

  queue.sort(
    (a, b) =>
      a.priority - b.priority || b.hits - a.hits || a.path.localeCompare(b.path),
  );

  const limited =
    Number.isFinite(options.limit) && options.limit > 0
      ? queue.slice(0, options.limit)
      : queue;

  fs.writeFileSync(options.out, limited.map((item) => item.path).join("\n") + (limited.length ? "\n" : ""));

  const summary = {
    candidates: skippedByLedger + queue.length,
    queued: limited.length,
    queuedTotal: queue.length,
    skippedByLedger,
    residual,
    changedSinceDecision,
    unseen,
    hits: limited.reduce((sum, item) => sum + item.hits, 0),
    ledgerEntries: entries.size,
  };
  console.log(JSON.stringify(summary));
}

function commandRecord(options) {
  if (!options.files) throw new Error("record 需要 --files");
  if (!STATUSES.has(options.status))
    throw new Error(`record 的 --status 只能是 ${[...STATUSES].join("/")}`);

  const entries = readLedger(options.ledger);
  migrateLegacySkipList(options.ledger, entries);
  const hits = countHits(options.hits);
  const now = new Date().toISOString();

  let recorded = 0;
  for (const raw of new Set(readLines(options.files).map(normalizePath))) {
    const hash = hashFile(raw);
    if (!hash) continue;
    entries.set(raw, {
      path: raw,
      hash,
      status: options.status,
      hits: hits.get(raw) ?? 0,
      updatedAt: now,
    });
    recorded += 1;
  }

  let pruned = 0;
  for (const key of [...entries.keys()]) {
    if (!fs.existsSync(key)) {
      entries.delete(key);
      pruned += 1;
    }
  }

  writeLedger(options.ledger, entries);
  console.log(
    JSON.stringify({ recorded, pruned, ledgerEntries: entries.size, status: options.status }),
  );
}

function commandStats(options) {
  const entries = readLedger(options.ledger);
  const byStatus = { clean: 0, skipped: 0, residual: 0 };
  for (const entry of entries.values()) {
    if (byStatus[entry.status] !== undefined) byStatus[entry.status] += 1;
  }
  console.log(
    JSON.stringify({ ledgerEntries: entries.size, byStatus }),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case "queue":
      commandQueue(options);
      break;
    case "record":
      commandRecord(options);
      break;
    case "stats":
      commandStats(options);
      break;
    default:
      throw new Error(
        "用法：i18n-ledger.mjs queue|record|stats（详见脚本头部注释）",
      );
  }
}

main();
