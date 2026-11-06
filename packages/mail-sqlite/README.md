# @inboxzero/mail-sqlite

共享邮箱 SQL schema、参数化查询和事务存储。
可移植入口不导入平台驱动。Node 测试和桌面宿主使用 `@inboxzero/mail-sqlite/node`。

`./driver` 中的 `SqliteDriver` 是这些宿主实现的接口。
`runSqliteDriverContract` 检查提交、回滚、串行化写入、事务读取、blob、保存点和关闭/重新打开。它不导入 `node:sqlite`。必需支持保存点和 `json_each`。如果缺少 FTS5，邮箱覆盖率会报告 `indexedContent: "not_requested"`。搜索索引是一个无内容 FTS5 表（`contentless_delete`，SQLite 3.43+），不保留邮件文本副本；`message_fts_keys` 将其 rowid 映射回邮件。

邮件正文以原始 deflate BLOB 形式存储，前置一字节格式标记，HTML 邮件不保留单独的文本部分。`MessageBodyCodec` 按运行时提供：默认使用 Compression Streams API，在 Node 宿主上使用 `nodeBodyCodec`（zlib）。压缩之前写入的正文会在存储打开时通过批量事务转换（迁移 0008）。

`@inboxzero/mail-sqlite/node` 使用 Node 文件 API。

常规测试套件包含一个 1 万会话的回归测试。更大规模的摄取/查询检查需手动启用：`SCALE_TESTS=1 pnpm -F @inboxzero/mail-sqlite test src/store.test.ts`。
如需隔离的 SQL 查询耗时数据，请在仓库根目录运行
`pnpm exec tsx packages/mail-sqlite/scripts/benchmark-queries.ts`。
`packages/mail-sqlite/scripts/benchmark-body-compression.ts` 会在合成邮箱上测量正文
存储、回填批次和会话读取。
