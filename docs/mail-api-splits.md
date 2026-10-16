# 拆分收件箱 REST API

基础路径：`/api/mail/v1/accounts/{accountId}/splits`。

这些面向已安装客户端的路由使用与其他邮箱账号级 mail v1 路由相同的
`withEmailProvider` 中间件。请发送常规的已认证会话或
bearer 凭据以及 `X-Email-Account-ID` 请求头。请求头中的邮箱账号必须
属于已认证用户，并与 `{accountId}` 一致。仅凭路径本身
不足以授权访问。

| 方法 | 路径后缀 | JSON 请求 |
| --- | --- | --- |
| POST | (base path) | `{ "name": "Unread", "filters": [{ "kind": "UNREAD", "value": null }], "matchAll": true }` or `{ "presetId": "Receipts" }` |
| PATCH | `/{splitId}` | `{ "name": "Receipts", "filters": [{ "kind": "LABEL", "value": "provider-label-id" }], "matchAll": true }` |
| DELETE | `/{splitId}` | 无请求体 |
| POST | `/reorder` | `{ "ids": ["split-2", "split-1"] }` |
| GET | `/presets` | 无请求体 |

每个成功的变更操作都会返回 HTTP 200 以及
`{ "protocolVersion": 1, "requestId": "...", "splits": [...] }`。
每个拆分都包含 `{ id, name, order, matchAll, filters: [{ kind, value }] }`，
与 `/api/mail/settings` 返回的 `splits` 数组完全一致，其中包含为旧版账号
提供的合成“全部”标签页。使用返回的数组替换本地设置。
现有设置端点的响应保持不变。

创建和更新使用 `apps/web/utils/actions/mail-split.validation.ts` 中
现有的 Web 操作 schema。PATCH 会替换名称和
整个筛选条件列表；它不是字段级的局部补丁。其 ID 来自路径，
而不是请求体。创建和更新时 `matchAll` 都默认为 true。名称会
去除首尾空白，且必须包含 1–60 个字符。每个拆分最多有 10 个筛选条件，
每个账号最多有 14 个持久化拆分。筛选条件类型为 `LABEL`、`CATEGORY`、
`FROM`、`UNREAD`、`STARRED` 和 `OLDER_THAN`；取值要求和允许的时长
值遵循 `split-filters.ts` 和 `split-query.ts`。多个不同的发件人
或同时使用两个 Outlook 收件箱分区时，需要 `matchAll: false`。与 Web 端一样，操作
schema 允许空的筛选条件列表；这样的拆分之后无法被删除。

DELETE 使用 Web 操作的邮箱账号级删除和锁定。不含筛选条件的
拆分（包括“全部”）会被以 `Split not found or cannot be removed` 拒绝。
未知 ID 和属于另一个账号的 ID 会收到同样的错误。重新排序接受
1–14 个唯一且非空的 ID。它只会重排该账号选中的槽位，
并保留被省略拆分的原有位置；未知或外部 ID 会被忽略，与
Web 操作中的行为一致。在排列“全部”的槽位时，请包含其持久化的 ID；
合成的 `all` ID 不会被持久化。

## 预设

GET `/presets` 返回
`{ "protocolVersion": 1, "requestId": "...", "presets": [...] }`。
每个预设包含：

```json
{
  "presetId": "Receipts",
  "name": "Receipts",
  "description": "Payments, payouts and invoices.",
  "category": "General",
  "matchAll": true,
  "filters": [{ "kind": "LABEL", "value": "account-label-id" }],
  "createsSystemType": null,
  "added": true,
  "splitId": "existing-split-id"
}
```

`presetId` is the catalogue entry name; use the exact value returned by GET.
POST with `presetId` resolves the current account's labels again rather than
trusting client label IDs. Ordinary presets use the same create operation as
the web action, including duplicate-name and split-limit errors.

Availability follows web's Add from library: user labels are sorted and matched
case-insensitively by name (including hidden labels), Gmail's Important label is
added explicitly, and Starred is hidden for Microsoft. Missing-label presets
are hidden, except opt-in system-rule presets. The current catalogue has no
native-category conditions. The shared web matcher marks an ordinary preset
added only when its name, conjunction, and unordered filters match an existing
split. System-rule presets match by case-insensitive split name. `splitId` is
null when not added.

OTP has `createsSystemType: "OTP"` and may have `filters: []` before its label
exists. POST `{ "presetId": "OTP" }` calls the same shared toggle function as
`toggleRuleAction`, enabling or creating the account's OTP rule and its default
split. It does not make a separate custom split or invoke an LLM. Existing web
toggle semantics remain intact, including its best-effort default-split setup;
a successful toggle may therefore return no new split if that setup fails or
the split limit is reached. Inspect the returned split list.

DELETE removes a split using the same action as web's tab removal; it does not
disable its rule. For an existing rule, the existing
`POST /api/mobile/rules/{id}/toggle` endpoint accepts `{ "enabled": false }`
(or true). That endpoint requires the rule ID and cannot create a missing system
rule. Use create-from-preset for first-time OTP setup. Clients that also want
the rule disabled must toggle the rule separately from deleting the split.

## Errors and versioning

Send `X-Request-ID` or `?requestId=...` for correlation. The server generates an
ID if omitted. Optional `protocolVersion` in POST/PATCH JSON or in a query must
be 1; unsupported versions return HTTP 409 with `unsupported_version`.

Validation errors and safe mutation failures return HTTP 400 with the mail v1
error envelope:

```json
{
  "protocolVersion": 1,
  "requestId": "...",
  "error": { "code": "invalid", "retryable": false, "retryAfterMs": null }
}
```

Safe mutation failures additionally include `error.message` with the same
user-safe message as the web action. Account path/header mismatches and
mismatched `accountId` fields in request bodies return HTTP 403 with the same
envelope and `code: "forbidden"`. Malformed JSON is invalid. Authentication,
account ownership, provider initialization, and unexpected errors retain the
existing middleware responses (for example 401
`{ "error": "Unauthorized", "isKnownError": true }`); clients must handle these
as well as protocol envelopes. No migrations or schema changes are required.
