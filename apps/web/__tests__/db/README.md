# 数据库测试

针对真实 Postgres 而非模拟 Prisma 客户端运行的测试。

当被测行为**就是**数据库时使用这一层：唯一约束、带条件的 `updateMany` 计数保护、`onDelete` 行为、部分索引语义。模拟的 Prisma 只能确认 mock 符合你对 Postgres 的心智模型，而这些 bug 恰恰藏在那个假设里。

其他测试应放在单元测试（使用 mock）或集成测试（由模拟器支持）中。参见 `.claude/skills/testing/`。

## 运行

除非设置 `RUN_DB_TESTS`，否则这些测试会被跳过，因此在有人接入 Postgres 服务之前，它们不会进入默认测试套件和 CI。

```bash
# One-time: create a throwaway database and apply migrations
createdb inboxzero_test
DATABASE_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
DIRECT_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
  pnpm exec prisma migrate deploy

# Run
DATABASE_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
  pnpm test-db
```

将 `DATABASE_URL` 指向一次性数据库。这些测试会在 `beforeEach` 中删除行，所以绝不要将它们指向你在意的数据库。

组项规范化迁移回归也应在 PostgreSQL 15 上运行。其字符串转义行为与较新版本不同，可能掩盖无效的空白规范化。

## 约定

- 在 `beforeEach` 中为测试写入所需行并再次删除，而不是依赖共享夹具。每个测试都应能单独运行。
- 模拟外部世界（机器人服务商、日历 API、队列），保持数据库真实。`fake-bot-provider.ts` 是内存版 `MeetingBotProvider`。
- 当测试重点是持久化状态转换时，应断言从数据库读回的行，而不是 mock 调用。
