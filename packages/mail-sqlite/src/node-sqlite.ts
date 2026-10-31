import { rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { HostRuntime } from "@inboxzero/mail-core/ports/runtime";
import type { SqlTransaction, SqlValue, SqliteDriver } from "./driver";
import type { MessageBodyCodec } from "./message-body-codec";

export function nodeMailCrypto(): Pick<HostRuntime, "randomId" | "sha256"> {
  return {
    randomId: () => randomUUID(),
    async sha256(bytes) {
      return new Uint8Array(createHash("sha256").update(bytes).digest());
    },
  };
}

// The engine process owns this connection and node:sqlite is synchronous, so
// inline zlib avoids a threadpool hop per message without blocking any UI.
export const nodeBodyCodec: MessageBodyCodec = {
  deflate: async (bytes) => deflateRawSync(bytes),
  inflate: async (bytes) => inflateRawSync(bytes),
};

export function createNodeSqliteDriver(path = ":memory:"): SqliteDriver {
  const writer = new DatabaseSync(path);
  // An in-memory database is private to its connection, so it reads through
  // the writer.
  let reader = writer;
  try {
    writer.exec("PRAGMA foreign_keys=ON");
    if (path !== ":memory:") {
      writer.exec("PRAGMA journal_mode=WAL");
      writer.exec("PRAGMA synchronous=NORMAL");
      // WAL 允许第二个连接在写事务打开时读取最后一次提交的状态，
      // 因此读取永远不会排在写入之后。
      reader = new DatabaseSync(path, { readOnly: true });
    }
  } catch (error) {
    writer.close();
    throw error;
  }
  const writes = createTransactionQueue(writer);
  const reads = reader === writer ? writes : createTransactionQueue(reader);
  let closed = false;

  function run<T>(
    queue: TransactionQueue,
    work: (tx: SqlTransaction) => Promise<T>,
    begin: string,
  ) {
    if (closed) return Promise.reject(new Error("sqlite 驱动已关闭"));
    return queue.run(work, begin);
  }

  return {
    read: (work) => run(reads, work, "BEGIN"),
    write: (work) => run(writes, work, "BEGIN IMMEDIATE"),
    async close() {
      closed = true;
      await Promise.all([reads.idle(), writes.idle()]);
      // 最后关闭写入方，以执行检查点并移除 WAL。
      if (reader !== writer) reader.close();
      writer.close();
    },
  };
}

export async function openOrQuarantineNodeMailbox(path: string): Promise<{
  driver: SqliteDriver;
  quarantinedPaths: string[];
}> {
  if (path === ":memory:") {
    return { driver: createNodeSqliteDriver(path), quarantinedPaths: [] };
  }
  let driver: SqliteDriver | null = null;
  try {
    driver = createNodeSqliteDriver(path);
    await assertReadableMailbox(driver);
    return { driver, quarantinedPaths: [] };
  } catch (error) {
    if (driver) {
      await driver.close().catch(() => undefined);
    }
    if (!isCorruptSqliteError(error)) throw error;
    const quarantinedPaths = await quarantineMailboxFiles(path);
    return {
      driver: createNodeSqliteDriver(path),
      quarantinedPaths,
    };
  }
}

export async function wipeNodeMailbox(path: string): Promise<void> {
  if (path === ":memory:") return;
  await Promise.all(
    mailboxSidecars(path).map((file) => rm(file, { force: true })),
  );
}

type TransactionQueue = ReturnType<typeof createTransactionQueue>;

// 每个连接同一时间只能持有一个事务，且语句之间会等待工作完成，
// 因此每个连接会依次执行其事务。
function createTransactionQueue(database: DatabaseSync) {
  let tail = Promise.resolve();
  return {
    run<T>(work: (tx: SqlTransaction) => Promise<T>, begin: string) {
      const run = tail.then(async () => {
        database.exec(begin);
        try {
          const result = await work(createTransaction(database));
          database.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            database.exec("ROLLBACK");
          } catch {
            // 已经回滚
          }
          throw error;
        }
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    idle: () => tail,
  };
}

function createTransaction(database: DatabaseSync): SqlTransaction {
  return {
    async exec(sql) {
      database.exec(sql);
    },
    async query(sql, bindings = []) {
      const statement = database.prepare(sql);
      const rows = statement.all(...bindings) as Array<
        Record<string, SqlValue>
      >;
      return rows;
    },
    async execute(sql, bindings = []) {
      const statement = database.prepare(sql);
      const result = statement.run(...bindings) as { changes?: number };
      return { changedRows: Number(result.changes ?? 0) };
    },
  };
}

async function assertReadableMailbox(driver: SqliteDriver): Promise<void> {
  await driver.read((tx) => tx.query("SELECT name FROM sqlite_master LIMIT 1"));
}

async function quarantineMailboxFiles(path: string): Promise<string[]> {
  const stamp = Date.now();
  const moved: string[] = [];
  for (const source of mailboxSidecars(path)) {
    if (!(await pathExists(source))) continue;
    const destination = `${source}.corrupt-${stamp}`;
    await rename(source, destination);
    moved.push(destination);
  }
  return moved;
}

function mailboxSidecars(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isCorruptSqliteError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errcode = "errcode" in error ? Number(error.errcode) : Number.NaN;
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return (
    errcode === 11 ||
    errcode === 26 ||
    message.includes("not a database") ||
    message.includes("database disk image is malformed") ||
    message.includes("file is encrypted or is not a database")
  );
}
