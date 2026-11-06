# E2E 测试

针对真实邮件服务商 API 的 Inbox Zero AI 端到端集成测试。

## 结构

```
e2e/
├── labeling/                      # Email labeling/category operations
│   ├── microsoft-labeling.test.ts # Outlook category CRUD, apply/remove, lifecycle
│   └── google-labeling.test.ts    # Gmail label CRUD, apply/remove, lifecycle
├── gmail-operations.test.ts       # Gmail webhooks, history processing
├── outlook-operations.test.ts     # Outlook webhooks, threads, search, senders
└── README.md                      # This file
```

## 运行 E2E 测试

E2E 测试默认跳过。运行方式：

```bash
# Run all E2E tests
pnpm test-e2e

# Run specific test suite
pnpm test-e2e microsoft-labeling
pnpm test-e2e google-labeling
pnpm test-e2e gmail-operations
pnpm test-e2e outlook-operations

# Run specific test within a suite
pnpm test-e2e microsoft-labeling -t "should apply and remove label"
```

## 设置

### Microsoft/Outlook 测试

设置这些环境变量：

```bash
export TEST_OUTLOOK_EMAIL=your@outlook.com
export TEST_OUTLOOK_MESSAGE_ID=AQMkADAwATNiZmYAZS05YWEAYy1iNWY0LTAwAi0wMAoARgAAA...
export TEST_CONVERSATION_ID=AQQkADAwATNiZmYAZS05YWEAYy1iNWY0LTAwAi0wMAoAEABuo...
```

### Google/Gmail 测试

设置这些环境变量：

```bash
export TEST_GMAIL_EMAIL=your@gmail.com
export TEST_GMAIL_MESSAGE_ID=18d1c2f3e4b5a678
export TEST_GMAIL_THREAD_ID=18d1c2f3e4b5a678
```

## 测试方法

所有 E2E 测试都遵循**干净状态方法**：

1. **设置**：创建测试数据（标签等）
2. **操作**：执行被测操作
3. **验证**：检查状态是否正确
4. **清理**：移除测试数据并恢复原始状态

这确保：
- 测试幂等，可多次运行
- 测试不会污染测试账号
- 每一步的状态验证能及早发现问题

## 获取测试 ID

### Outlook

1. 运行应用并触发 webhook
2. 在日志中查找邮件 ID 和会话 ID
3. 或使用 Outlook API 资源管理器：<https://developer.microsoft.com/en-us/graph/graph-explorer>

### Gmail

1. 使用 Gmail API 资源管理器：<https://developers.google.com/gmail/api/reference/rest>
2. 或在处理邮件时查看应用日志

## 注意事项

- 这些测试使用真实 API 调用，会计入你的配额
- 由于 API 速率限制，测试可能需要 30 秒以上
- 确保测试账号具有适当权限
- **Microsoft Graph**：所有 API 请求都使用不可变 ID（`Prefer: IdType="ImmutableId"` 请求头），以确保邮件 ID 在操作之间保持稳定
