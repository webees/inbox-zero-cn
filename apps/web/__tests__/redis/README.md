# 一次性 Redis 回归测试

这些可选启用的测试会在隔离的 `redis:7` Docker 容器中执行本地邮件配额 Lua。它们不使用已配置的 Redis URL、凭证或现有容器。测试套件会创建一个唯一命名且不发布端口的容器，并在清理阶段移除它。

要求：Docker 正在运行，且已完成 `pnpm install`。

在仓库根目录运行：

```sh
RUN_INTEGRATION_TESTS=true pnpm --filter inbox-zero-ai exec vitest --run __tests__/redis/local-mail-sync-budget.test.ts
```

请直接通过应用过滤器运行 Vitest：根目录的 Turbo 测试任务不会转发此可选标志。普通单元运行会跳过这些测试，模拟器集成测试套件仍独立于 Docker。

覆盖范围包括原子令牌拒绝、为当前工作预留余量、应用级容量、按 Redis 时间补充、自适应恢复、账号/应用并发、归属租约释放，以及另一调用方读取持久化的服务商 Retry-After。仅替换 Redis 传输层；生产 Lua 和共享冷却解析均原样执行。

如果测试运行器在清理前被强制终止，只移除该次运行中 Docker inspection 打印的名为 `local-mail-budget-test-<UUID>` 的容器。
