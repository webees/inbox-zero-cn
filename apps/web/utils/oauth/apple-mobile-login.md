# Apple 移动端登录

此配置仅用于官方 Inbox Zero 移动应用。自托管的 Web 部署无需这些值。

后端通过 Better Auth 接受来自移动应用的原生 Sign in with Apple ID 令牌。仅在为移动应用提供服务的托管环境中配置这些环境变量：

```sh
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APPLE_APP_BUNDLE_IDENTIFIER=com.getinboxzero.app
MOBILE_AUTH_ORIGIN=inboxzero://
ANDROID_APP_CERT_SHA256_FINGERPRINTS=
```

- `APPLE_CLIENT_ID` 是用于 Web OAuth 回退的 Apple Services ID。
- `APPLE_TEAM_ID` 是 Apple Developer 团队 ID。
- `APPLE_KEY_ID` 是 Sign in with Apple 的密钥 ID。
- `APPLE_PRIVATE_KEY` 是 `.p8` 密钥内容。支持转义的 `\n` 换行。
- `APPLE_APP_BUNDLE_IDENTIFIER` 必须与 iOS 应用 bundle ID 匹配。
- `MOBILE_AUTH_ORIGIN` 是移动端 Better Auth 请求信任的深度链接来源，仅用于本地非 HTTPS 回调重定向。
- `ANDROID_APP_CERT_SHA256_FINGERPRINTS` 是由 `/.well-known/assetlinks.json` 提供的、以逗号分隔的 Android 应用签名证书 SHA-256 指纹列表。

Apple 客户端密钥在运行时根据团队 ID、密钥 ID、私钥和客户端 ID 生成。不要添加静态的 `APPLE_CLIENT_SECRET`。

移动端浏览器 OAuth 必须使用后端交接流程：

1. 原生应用生成随机的 PKCE verifier，在本地保留，并将其 S256 `codeChallenge` 发送到 `POST /api/mobile-auth/start`。
2. 服务商回调后，Better Auth 重定向到 `/api/mobile-auth/callback?state=...`。
3. 回调路由存储一个短期有效的一次性 code，并重定向到 `/auth-callback?code=...&state=...`。
4. 原生应用通过 `POST /api/mobile-auth/exchange-code` 兑换该 code，同时发送 `code`、`state` 及其保留的 `codeVerifier`。

会话 cookie 不得放入移动端回调 URL 中。

服务器要求服务商成功完成且匹配，并且是同一新签发的浏览器会话，才会创建交接 code。未签发、已过期、待处理或已被消费的 state 都会被拒绝。code 在五分钟后过期，且只能使用发起客户端的 verifier 兑换一次。

S256 challenge 是 verifier 的 SHA-256 的无填充 base64url 编码。每次尝试都从至少 32 个随机字节生成新的 verifier（RFC 7636 规定的 43–128 个字符）。绝不要在授权 URL 或应用回调中发送它。请将其与预期的 state 一起保留，直到兑换成功或尝试被放弃，并拒绝不同 state 的回调。

桌面客户端在 `/api/mobile-auth/browser-start` 查询中发送 `codeChallenge`，在兑换时发送 `codeVerifier`。桌面进程将 verifier 保留在内存中；如果它在登录期间退出，请重新开始一次新的尝试。

请随更新后的原生客户端一起部署此契约。省略 challenge 或 verifier 的客户端会被拒绝；没有旧版 bearer code 回退。来自旧服务器版本的进行中流程必须重新开始。原生 Apple ID 令牌直接登录不使用这些交接端点。
