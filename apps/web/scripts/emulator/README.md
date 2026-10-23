# 本地模拟器

使用 Google 和 Microsoft 模拟器以及一次性的 Postgres 和 Redis 运行真实的 Web 后端。用于本地开发、代理以及任何客户端。
这里不会与生产环境通信。

Playwright 的 `webServer` 会为每个测试规范启动一个服务商进程然后退出。这个栈会一直运行，直到你停止它。

## 集成测试模式

`node scripts/emulator/stack.mjs up --integration-tests --owner-token <token>`
会添加确定性的服务商测试数据、本地模型服务和响应丢失代理。任何 HTTP 客户端都可以使用此模式，它不依赖于移动应用。
返回的 `controlUrl` 在 `/__test-control` 下提供测试控制接口。

`node scripts/emulator/stack.mjs reset` 会在场景之间重置所属的集成栈。用以下命令停止：

```sh
node scripts/emulator/stack.mjs down --owner-token <token>
```

## 运行

Docker 必须正在运行。在此仓库的克隆目录中：

```sh
pnpm install
pnpm -F inbox-zero-ai emulator:up
```

该命令会输出：

```text
BASE_URL=http://127.0.0.1:<port>
GOOGLE_BASE_URL=http://127.0.0.1:<port>
MICROSOFT_BASE_URL=http://127.0.0.1:<port>
```

让客户端指向 `BASE_URL`。

停止它，包括数据库卷：

```sh
pnpm -F inbox-zero-ai emulator:down
```

当 `DATABASE_URL`、`GOOGLE_BASE_URL`、`MICROSOFT_BASE_URL` 或 `NEXT_PUBLIC_BASE_URL`
已经指向非回环地址时，`up` 会拒绝启动。Next 进程只会收到本地 URL 和模拟器客户端 ID
（`emulate-google-client.apps.googleusercontent.com` /
`emulate-microsoft-client-id`）。这些不是生产凭据。

`up --foreground` 会保持前台运行，并在按下 Ctrl-C 时拆除整个栈。

## 种子数据

`up` 会写入现有的双服务商种子数据，并为每个服务商额外创建一个空邮箱，以便两个用户可以登录：

| 服务商 | 邮箱 | 内容 |
| --- | --- | --- |
| Google | `developer@example.com` | 来自 `scripts/emulate-seed.ts` 的演示收件箱 |
| Google | `teammate@example.com` | 空邮箱 |
| Microsoft | `developer@outlook.test` | 空邮箱 |
| Microsoft | `teammate@outlook.test` | 空邮箱 |

在 `down` 之后再次执行 `up` 会迁移全新的数据库并重新加载该种子数据。

## 定时发送与草稿

调用这些接口时请使用 Better Auth 会话 Cookie 和 `X-Email-Account-ID` 请求头。
同一个 Next.js 应用仍会提供 Web 撰写器使用的服务器操作。

该栈会设置一个本地 `CRON_SECRET`，并每隔几秒使用 `Authorization: Bearer $CRON_SECRET` 轮询 `GET /api/cron/scheduled-actions`。
未来的 `sendAt` 由该定时器投递。没有 QStash 进程。

安排发送。`sendAt` 和 `remindAt` 是 ISO 时间戳或 `null`。`sendAt` 为 `null` 时会立即发送。

```sh
curl -X POST "$BASE_URL/api/user/scheduled-emails" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID" \
  -d '{
    "clientMutationId": "827f1b38-2032-4bfd-bc2c-cbba02746b04",
    "threadId": null,
    "messageIds": [],
    "email": {
      "to": "teammate@example.com",
      "subject": "Later",
      "messageHtml": "<p>Hello</p>"
    },
    "sendAt": "2026-10-06T09:00:00.000Z",
    "remindAt": null
  }'
```

使用相同的 `clientMutationId` 和请求负载重复该请求会返回原始 ID。同一个 ID 使用不同负载会被拒绝。

```sh
curl -X DELETE "$BASE_URL/api/user/scheduled-emails/$SCHEDULED_EMAIL_ID" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"

curl -X POST "$BASE_URL/api/user/scheduled-emails/$SCHEDULED_EMAIL_ID/retry" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"

curl -X DELETE "$BASE_URL/api/user/scheduled-emails/$SCHEDULED_EMAIL_ID/reminder" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"
```

创建、更新和丢弃服务商草稿。响应为 `{draftId, messageId, threadId}`。

```sh
curl -X POST "$BASE_URL/api/user/drafts" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID" \
  -d '{
    "content": {
      "to": "teammate@example.com",
      "subject": "Draft",
      "messageHtml": "<p>Hello</p>"
    }
  }'

curl -X PUT "$BASE_URL/api/user/drafts/$DRAFT_ID" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID" \
  -d '{
    "content": {
      "to": "teammate@example.com",
      "subject": "Draft",
      "messageHtml": "<p>Updated</p>"
    }
  }'

curl -X DELETE "$BASE_URL/api/user/drafts/$DRAFT_ID" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"
```

通过提交一个 `mail/v1` 发送操作来发送已保存的草稿，该操作的意图中包含设置为 `draftId` 的 `providerDraftId`。
执行器会通过 `sendEmailBody.providerDraftId` 使用的同一套持久化发送流程传递它，该流程会更新服务商草稿并发送。
`queuedAtMs` 是当前时间（毫秒）。`notBeforeMs` 仅用于撤销发送和离线等待，因此不会安排此次发送。

```sh
curl -X PUT "$BASE_URL/api/mail/v1/accounts/$EMAIL_ACCOUNT_ID/operations/$OPERATION_ID" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID" \
  -d '{
    "protocolVersion": 1,
    "requestId": "send-draft",
    "session": { "accountId": "'"$EMAIL_ACCOUNT_ID"'", "generation": "local" },
    "attemptId": "attempt-1",
    "operation": {
      "key": {
        "accountId": "'"$EMAIL_ACCOUNT_ID"'",
        "operationId": "'"$OPERATION_ID"'"
      },
      "session": { "accountId": "'"$EMAIL_ACCOUNT_ID"'", "generation": "local" },
      "authority": "client",
      "payloadHash": "local",
      "intent": {
        "kind": "send",
        "frozenDraftId": "local-draft",
        "frozenDraftRevision": 1,
        "to": ["teammate@example.com"],
        "cc": [],
        "bcc": [],
        "subject": "Draft",
        "html": "<p>Hello</p>",
        "quotedHtml": "",
        "attachmentIds": [],
        "providerDraftId": "'"$DRAFT_ID"'",
        "replyToMessageId": null,
        "replyToConversationId": null,
        "queuedAtMs": 1790358000000
      }
    }
  }'
```

当客户端未使用 `mail/v1` 时，`POST /api/messages/send` 会在 `sendEmailBody.providerDraftId` 上接受相同的 ID。

## 账号、订阅和推送路由

这些路由使用相同的会话 Cookie。标记需要邮箱账号请求头的路由还要求提供 `X-Email-Account-ID`。

该栈启用了本地 Apple 签名交易校验（`APPLE_IAP_LOCAL_TESTING=true`）和伪造的 APNs 传输
（`APNS_TRANSPORT=fake`）。它不会设置 App Store Server API 或 APNs `.p8` 密钥。

删除已登录用户。响应 `{ "deleted": true }`。该用户的会话会被移除。归属冲突会返回 `400`
`{ "error": "...", "isKnownError": true }`。

```sh
curl -X DELETE "$BASE_URL/api/user/account" \
  -H "cookie: $SESSION_COOKIE"
```

移除一个已连接的邮箱。拒绝移除唯一邮箱会返回 `400` 和 `isKnownError: true`。响应 `{ "deleted": true }`。

```sh
curl -X DELETE "$BASE_URL/api/user/email-accounts/$EMAIL_ACCOUNT_ID" \
  -H "cookie: $SESSION_COOKIE"
```

同步 StoreKit 2 JWS。响应 `{ "premium": { ... } }`。在此栈中，JWS 必须使用本地测试密钥签名。
没有 `signedTransaction` 的 `transactionId` 仍会调用 Apple，并在此处返回 `503`。

```sh
curl -X POST "$BASE_URL/api/apple/subscription/sync" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -d '{ "signedTransaction": "<jws>" }'
```

注册 APNs 设备令牌，然后通过伪造传输发送。测试路由返回 `{ "sends": [...] }`，除非 `APNS_TRANSPORT=fake`，否则返回 `404`。

```sh
curl -X POST "$BASE_URL/api/mobile/push-token" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -d '{
    "token": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "platform": "ios",
    "tokenType": "apns"
  }'

curl -X POST "$BASE_URL/api/mobile/push/test" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -d '{ "title": "Hello", "body": "From the emulator" }'
```

列出、暂停和恢复会话。`snoozedUntil` 必须至少提前一分钟。列表响应
`{ "threads": [{ "id", "threadId", "scheduledFor", "status" }] }`。

```sh
curl "$BASE_URL/api/user/snoozed-threads" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"

curl -X POST "$BASE_URL/api/user/snoozed-threads" \
  -H "content-type: application/json" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID" \
  -d '{ "threadIds": ["THREAD_ID"], "snoozedUntil": "2026-10-06T09:00:00.000Z" }'
```

列出收件箱分类和用户分区。

```sh
curl "$BASE_URL/api/user/mail-splits" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"
```

`GET /api/threads?inboxSection=newsletters` 和 `?category=promotions` 会被接受。范围限定为垃圾邮件或回收站的搜索会包含这些文件夹：

```sh
curl "$BASE_URL/api/threads?type=spam&q=invoice" \
  -H "cookie: $SESSION_COOKIE" \
  -H "X-Email-Account-ID: $EMAIL_ACCOUNT_ID"
```

运行失败时的日志会保存在 `apps/web/.tmp/emulator/` 下。
