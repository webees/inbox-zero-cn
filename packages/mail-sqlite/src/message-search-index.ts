import type { MessageKey } from "@inboxzero/mail-core/identities";
import type { SqlTransaction, SqlValue } from "./driver";
import { decodeMessageBody, type MessageBodyCodec } from "./message-body-codec";
import { searchableBody, searchableText } from "./search-text";

const BACKLOG_BATCH_ROWS = 100;

// contentless_delete（SQLite 3.43+）让行可以按 rowid 替换和删除，
// 而索引无需保留它分词后的文本。
const MESSAGE_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  subject,
  preview,
  from_address,
  body,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61'
);
`;

// 只要索引存储的内容发生变化，就把它清空重建：0006 去掉了索引里每封邮件
// 文本的副本，0007 用可见文本替换了原始 HTML 正文，并把无空格的文字
// 拆成单个字符。删除很快；indexSearchBacklog 会按引擎节奏分批重新添加行，
// 因此打开邮箱时不必等待完整重建。
export async function migrateMessageSearchIndex(tx: SqlTransaction) {
  const applied = await tx.query(
    "SELECT 1 FROM schema_migrations WHERE id = 7",
  );
  if (applied.length) return;
  const rebuilt = await withSearchIndex(tx, "rebuild_fts", async () => {
    await tx.exec("DROP TABLE IF EXISTS message_fts");
    await tx.exec(MESSAGE_FTS_SQL);
    await tx.execute("DELETE FROM message_fts_keys");
    await markSearchIndexIncomplete(tx);
  });
  if (!rebuilt) return;
  await tx.execute(
    "INSERT INTO schema_migrations(id, name) VALUES (7, '0007-clean-text-message-search')",
  );
}

export async function indexMessageContent(
  tx: SqlTransaction,
  key: MessageKey,
  content: MessageBody,
) {
  const indexed = await withSearchIndex(tx, "index_content", () =>
    writeSearchRow(tx, key, content),
  );
  if (!indexed) await abandonSearchRow(tx, key);
}

// 按 key 顺序在 `after` 之后，为下一批还没有搜索行的已存储正文建立索引，
// 例如重建后遗留的正文。返回该批次的最后一个 key，若一个都没有则返回 null。
export async function indexSearchBacklog(
  tx: SqlTransaction,
  codec: MessageBodyCodec,
  after: MessageKey | null,
): Promise<BacklogBatch> {
  let last: MessageKey | null = null;
  const indexed = await withSearchIndex(tx, "index_backlog", async () => {
    const batch = await tx.query(
      `SELECT c.account_id, c.message_id, c.text, c.html,
              m.subject, m.preview, m.from_address
       FROM message_content c
       JOIN messages m ON m.account_id = c.account_id AND m.message_id = c.message_id
       WHERE (c.account_id, c.message_id) > (?, ?)
         AND NOT EXISTS (
           SELECT 1 FROM message_fts_keys k
           WHERE k.account_id = c.account_id AND k.message_id = c.message_id
         )
       ORDER BY c.account_id, c.message_id
       LIMIT ?`,
      [after?.accountId ?? "", after?.messageId ?? "", BACKLOG_BATCH_ROWS],
    );
    const bodies = await Promise.all(
      batch.map(async (row) => ({
        text: await decodeMessageBody(codec, row.text),
        html: await decodeMessageBody(codec, row.html),
      })),
    );
    last = await insertSearchRows(tx, batch, bodies);
  });
  return indexed ? { indexed: true, last } : { indexed: false };
}

// 重新索引主题、预览或发件人有变动或新增的邮件。没有存储正文时直接为其
// 元数据建立索引；有正文时则删除该行，交由正文待办随文本一起重建，
// 在此之前搜索依赖子串回退。
export async function indexMessageMetadata(
  tx: SqlTransaction,
  key: MessageKey,
) {
  const [stored] = await tx.query(
    "SELECT 1 FROM message_content WHERE account_id = ? AND message_id = ?",
    [key.accountId, key.messageId],
  );
  const indexed = await withSearchIndex(tx, "index_metadata", () =>
    stored
      ? dropSearchRow(tx, key)
      : writeSearchRow(tx, key, { text: null, html: null }),
  );
  if (!indexed) await abandonSearchRow(tx, key);
  else if (stored) await markSearchIndexIncomplete(tx);
}

// 在正文待办处理完后，为下一批仍没有搜索行的邮件建立元数据索引，
// 例如在元数据建立索引前就同步进来、但还没有正文的邮件。已存储正文的
// 邮件留给正文待办处理。返回结果与 indexSearchBacklog 相同。
export async function indexMetadataBacklog(
  tx: SqlTransaction,
  after: MessageKey | null,
): Promise<BacklogBatch> {
  let last: MessageKey | null = null;
  const indexed = await withSearchIndex(
    tx,
    "index_metadata_backlog",
    async () => {
      const batch = await tx.query(
        `SELECT m.account_id, m.message_id, m.subject, m.preview, m.from_address
         FROM messages m
         WHERE (m.account_id, m.message_id) > (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM message_fts_keys k
             WHERE k.account_id = m.account_id AND k.message_id = m.message_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM message_content c
             WHERE c.account_id = m.account_id AND c.message_id = m.message_id
           )
         ORDER BY m.account_id, m.message_id
         LIMIT ?`,
        [after?.accountId ?? "", after?.messageId ?? "", BACKLOG_BATCH_ROWS],
      );
      last = await insertSearchRows(
        tx,
        batch,
        batch.map(() => ({ text: null, html: null })),
      );
    },
  );
  return indexed ? { indexed: true, last } : { indexed: false };
}

// 当每封邮件都有搜索行后，将索引标记为完成，这样搜索就能从索引匹配开始。
// 返回索引是否已完成。
export async function completeSearchIndexIfFull(tx: SqlTransaction) {
  const [missing] = await tx.query(
    `SELECT 1 FROM messages m
     WHERE NOT EXISTS (
       SELECT 1 FROM message_fts_keys k
       WHERE k.account_id = m.account_id AND k.message_id = m.message_id
     )
     LIMIT 1`,
  );
  if (missing) return false;
  await tx.execute(
    "INSERT OR REPLACE INTO search_index_state(id, complete) VALUES (1, 1)",
  );
  return true;
}

export async function readSearchIndexComplete(tx: SqlTransaction) {
  const [state] = await tx.query(
    "SELECT complete FROM search_index_state WHERE id = 1",
  );
  return Number(state?.complete) === 1;
}

export async function deleteAccountSearchIndex(
  tx: SqlTransaction,
  accountId: string,
) {
  const purged = await withSearchIndex(tx, "purge_fts", () =>
    tx.execute(
      "DELETE FROM message_fts WHERE rowid IN (SELECT fts_rowid FROM message_fts_keys WHERE account_id = ?)",
      [accountId],
    ),
  );
  // 这些 key 是找回失败删除所遗留行的唯一途径。
  if (!purged) return;
  await tx.execute("DELETE FROM message_fts_keys WHERE account_id = ?", [
    accountId,
  ]);
}

export async function clearSearchIndex(tx: SqlTransaction) {
  const cleared = await withSearchIndex(tx, "clear_fts", () =>
    tx.execute("INSERT INTO message_fts(message_fts) VALUES ('delete-all')"),
  );
  if (!cleared) return;
  await tx.execute("DELETE FROM message_fts_keys");
  await markSearchIndexIncomplete(tx);
}

type MessageBody = { text: string | null; html: string | null };

type BacklogBatch =
  | { indexed: false }
  | { indexed: true; last: MessageKey | null };

async function writeSearchRow(
  tx: SqlTransaction,
  key: MessageKey,
  content: MessageBody,
) {
  const [existing] = await tx.query(
    "SELECT fts_rowid FROM message_fts_keys WHERE account_id = ? AND message_id = ?",
    [key.accountId, key.messageId],
  );
  if (existing) {
    await tx.execute("DELETE FROM message_fts WHERE rowid = ?", [
      existing.fts_rowid,
    ]);
  }
  const [message] = await tx.query(
    "SELECT subject, preview, from_address FROM messages WHERE account_id = ? AND message_id = ?",
    [key.accountId, key.messageId],
  );
  if (!message) {
    await deleteKey(tx, key);
    return;
  }
  await tx.execute(
    "INSERT INTO message_fts(subject, preview, from_address, body) VALUES (?, ?, ?, ?)",
    searchColumns(message, content),
  );
  const [row] = await tx.query("SELECT last_insert_rowid() AS id");
  await tx.execute(
    `INSERT INTO message_fts_keys(account_id, message_id, fts_rowid) VALUES (?, ?, ?)
     ON CONFLICT(account_id, message_id) DO UPDATE SET fts_rowid = excluded.fts_rowid`,
    [key.accountId, key.messageId, row?.id],
  );
}

// 预先在当前最大值之上分配 rowid，让整批数据通过一次多行 INSERT 建立索引；
// 逐行插入经过驱动时慢好几倍。返回该批次的最后一个 key。
async function insertSearchRows(
  tx: SqlTransaction,
  batch: Array<Record<string, SqlValue>>,
  bodies: MessageBody[],
): Promise<MessageKey | null> {
  const tail = batch.at(-1);
  if (!tail) return null;
  const [top] = await tx.query(
    "SELECT rowid FROM message_fts ORDER BY rowid DESC LIMIT 1",
  );
  const base = Number(top?.rowid ?? 0);
  await tx.execute(
    `INSERT INTO message_fts(rowid, subject, preview, from_address, body)
     VALUES ${batch.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
    batch.flatMap((row, index) => [
      base + index + 1,
      ...searchColumns(row, bodies[index]),
    ]),
  );
  await tx.execute(
    `INSERT INTO message_fts_keys(account_id, message_id, fts_rowid)
     VALUES ${batch.map(() => "(?, ?, ?)").join(", ")}`,
    batch.flatMap((row, index) => [
      row.account_id,
      row.message_id,
      base + index + 1,
    ]),
  );
  return {
    accountId: String(tail.account_id),
    messageId: String(tail.message_id),
  };
}

function searchColumns(
  message: Record<string, SqlValue>,
  content: MessageBody,
): string[] {
  return [
    searchableText(String(message.subject ?? "")),
    searchableText(String(message.preview ?? "")),
    searchableText(String(message.from_address ?? "")),
    searchableBody(content),
  ];
}

async function dropSearchRow(tx: SqlTransaction, key: MessageKey) {
  await tx.execute(
    "DELETE FROM message_fts WHERE rowid IN (SELECT fts_rowid FROM message_fts_keys WHERE account_id = ? AND message_id = ?)",
    [key.accountId, key.messageId],
  );
  await deleteKey(tx, key);
}

// 写入失败会保留邮件原来的行，因此删除它的 key：随后待办会重建该行，
// 在此期间由子串回退兜底。没有 key 的孤立 FTS 行永远不会匹配到邮件。
async function abandonSearchRow(tx: SqlTransaction, key: MessageKey) {
  await deleteKey(tx, key);
  await markSearchIndexIncomplete(tx);
}

function markSearchIndexIncomplete(tx: SqlTransaction) {
  return tx.execute(
    "INSERT OR REPLACE INTO search_index_state(id, complete) VALUES (1, 0)",
  );
}

function deleteKey(tx: SqlTransaction, key: MessageKey) {
  return tx.execute(
    "DELETE FROM message_fts_keys WHERE account_id = ? AND message_id = ?",
    [key.accountId, key.messageId],
  );
}

// 运行时的 SQLite 构建可能省略 FTS，此时 FTS 是可选的；失败不能中断
// 外层写入。返回索引操作是否成功。
async function withSearchIndex(
  tx: SqlTransaction,
  savepoint: string,
  run: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await tx.exec(`SAVEPOINT ${savepoint}`);
    await run();
    await tx.exec(`RELEASE ${savepoint}`);
    return true;
  } catch {
    try {
      await tx.exec(`ROLLBACK TO ${savepoint}`);
      await tx.exec(`RELEASE ${savepoint}`);
    } catch {
      // 缺少 savepoint
    }
    return false;
  }
}
