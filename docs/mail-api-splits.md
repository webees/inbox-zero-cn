# 拆分收件箱 REST API

基础路径：`/api/mail/v1/accounts/{accountId}/splits`。

这些已安装客户端路由使用与其他账号范围的邮件 v1 路由相同的
`withEmailProvider` 中间件。请发送常规的已认证会话或 Bearer 凭据，以及
`X-Email-Account-ID` 请求头。请求头中的账号必须属于已认证用户，并与
`{accountId}` 匹配。仅凭路径并不能授权访问。

| 方法 | 路径后缀 | JSON 请求 |
| --- | --- | --- |
| POST | (base path) | `{ "name": "Unread", "filters": [{ "kind": "UNREAD", "value": null }], "matchAll": true }` or `{ "presetId": "Receipts" }` |
| PATCH | `/{splitId}` | `{ "name": "Receipts", "filters": [{ "kind": "LABEL", "value": "provider-label-id" }], "matchAll": true }` |
| DELETE | `/{splitId}` | 无请求体 |
| POST | `/reorder` | `{ "ids": ["split-2", "split-1"] }` |
| GET | `/presets` | 无请求体 |

每次成功的变更操作都会返回 HTTP 200，内容为
`{ "protocolVersion": 1, "requestId": "...", "splits": [...] }`。
每个分区具有 `{ id, name, order, matchAll, filters: [{ kind, value }] }` 结构，
与 `/api/mail/settings` 中的 `splits` 数组完全一致，包括为旧账号生成的合成
“全部”标签页。请使用返回的数组替换本地设置。现有设置端点的响应保持不变。

创建和更新使用 `apps/web/utils/actions/mail-split.validation.ts` 中现有的 Web
操作 schema。PATCH 会替换名称和整个筛选条件列表；它不是字段级的部分更新。
其 ID 来自路径，而不是请求体。创建和更新时 `matchAll` 均默认为 true。名称
会被去除首尾空白，且必须包含 1–60 个字符。每个分区最多 25 个筛选条件，每个
账号最多 14 个持久化分区。筛选条件类型为 `LABEL`、`CATEGORY`、`FROM`、
`TO`（收件人或抄送中的收件人地址或 `@domain`）、`UNREAD`、`STARRED` 和
`OLDER_THAN`；取值要求与允许的时长值参见 `split-filters.ts` 和
`split-query.ts`。存在多个不同发件人、多个不同收件人，或同时包含两个
Outlook 收件箱分区时，需要 `matchAll: false`。与 Web 端一样，操作 schema
允许空的筛选条件列表；此类分区之后无法删除。

DELETE 使用 Web 操作中按账号范围进行的删除和锁定。无筛选条件的分区（包括
“全部”）会被拒绝，并返回 `Split not found or cannot be removed`。未知 ID
和属于其他账号的 ID 也会收到同样的错误。重新排序接受 1–14 个唯一且非空的
ID。它只会重排该账号已选中的位置，未包含的分区保持原位置；未知或外部 ID
会像在 Web 操作中一样被忽略。重排“全部”的位置时请包含持久化的“全部”ID；
合成的 `all` ID 不会持久化。

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

`presetId` 是目录条目的名称；请使用 GET 返回的精确值。使用 `presetId` 的
POST 会重新解析当前账号的标签，而不是信任客户端提供的标签 ID。普通预设使用
与 Web 操作相同的创建操作，包括重名和分区数量上限错误。

可用性遵循 Web 端的“从库中添加”：用户标签会排序并按名称不区分大小写匹配
（包括隐藏标签），Gmail 的“重要”标签会显式添加，Microsoft 则隐藏“已加星标”。
缺少标签的预设会被隐藏，选择启用的系统规则预设除外。当前目录中没有原生分类
条件。共享的 Web 匹配器只有在普通预设的名称、连接方式和无序筛选条件均与
现有分区匹配时，才会将其标记为已添加。系统规则预设按不区分大小写的分区名称
匹配。未添加时 `splitId` 为 null。

OTP 具有 `createsSystemType: "OTP"`，在其标签存在之前可能有 `filters: []`。
POST `{ "presetId": "OTP" }` 会调用与 `toggleRuleAction` 相同的共享切换函数，
启用或创建该账号的 OTP 规则及其默认分区。它不会单独创建自定义分区，也不会
调用 LLM。现有 Web 端的切换语义保持不变，包括尽力而为的默认分区设置；因此
如果该设置失败或达到分区数量上限，成功的切换可能不会返回新分区。请检查返回
的分区列表。

DELETE 使用与 Web 端移除标签页相同的操作删除分区；它不会停用对应的规则。
对于现有规则，现有的
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
