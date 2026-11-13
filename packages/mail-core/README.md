# @inboxzero/mail-core

可移植的邮箱 schema、查询语义、命令状态与共享引擎 API。该包不依赖
React、DOM、SQL 驱动或应用框架。

Web 与桌面端用 `MailStore`、`MailboxSource`、`OperationExecutor` 和
`HostRuntime`（`nowMs`、`randomId`、`sha256`、`storagePressure`）构建该引擎。
附件存放在服务商的邮箱草稿上，因此引擎从不持有其字节。

界面通过 `observeMailbox`、`observeMailboxWindow`、`observeConversation`
和 `observeOperation` 读取数据。它们用 `saveDraft` / `readDraft` 保存并读取
单个草稿，用 `submitSend` 排队发送。排队的发送通过 `observeOperation` 观察。

账号列表、Outlook 文件夹和 Gmail 标签仍保留在各自现有的服务端 API 上。

禁止的导入：React、DOM 全局对象、IndexedDB、Electron、Expo、Next、Prisma、
Redis 以及仅限 Node 的模块。
